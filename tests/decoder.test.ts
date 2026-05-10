import { describe, it, expect } from "vitest";
import { schemas } from "../src/engine/protobuf/index.js";
import { FrameDecoder } from "../src/engine/decoder.js";

function makeContentBytes(opts: { text?: string; type?: "text" | "document" | "deleted" | "empty" | "none" }): Uint8Array {
  const { MessageContent, TextMessage } = schemas;
  const t = opts.type ?? "text";

  if (t === "text" && opts.text !== undefined) {
    return MessageContent.encode(MessageContent.create({ textMessage: TextMessage.create({ text: opts.text }) })).finish();
  }
  if (t === "document") {
    return MessageContent.encode(MessageContent.create({ documentMessage: new Uint8Array([1, 2, 3]) })).finish();
  }
  if (t === "deleted") {
    return MessageContent.encode(MessageContent.create({ deletedMessage: new Uint8Array([1]) })).finish();
  }
  if (t === "empty") {
    return MessageContent.encode(MessageContent.create({ emptyMessage: new Uint8Array([1]) })).finish();
  }
  return MessageContent.encode(MessageContent.create({})).finish();
}

function makeNewMessageBytes(opts: {
  fromType?: number;
  fromId?: number;
  toId?: number;
  rid?: number;
  date?: number;
  text?: string;
  contentType?: "text" | "document" | "deleted" | "empty" | "none";
  includeMessage?: boolean;
}): Uint8Array {
  const { NewMessage, Peer } = schemas;

  const from = Peer.create({ type: opts.fromType ?? 1, id: opts.fromId ?? 100 });
  const to = Peer.create({ type: 1, id: opts.toId ?? 200 });

  const message = opts.includeMessage !== false
    ? makeContentBytes({ text: opts.text, type: opts.contentType ?? (opts.text !== undefined ? "text" : "none") })
    : undefined;

  const newMsg = NewMessage.create({
    from,
    senderUid: String(opts.fromId ?? 100),
    date: String(opts.date ?? 1778401706519),
    rid: String(opts.rid ?? 999),
    message,
    to,
  });

  return NewMessage.encode(newMsg).finish();
}

function makeEnvelopeBytes(newMessageBytes: Uint8Array): Uint8Array {
  const { ServerEnvelope, Update, UpdatePayload, NewMessageUpdate } = schemas;
  // Inner: NewMessageUpdate with field 55 = newMessage bytes
  const innerBytes = NewMessageUpdate.encode(NewMessageUpdate.create({ newMessage: newMessageBytes })).finish();
  // Outer: UpdatePayload with field 1 = inner bytes
  const payloadBytes = UpdatePayload.encode(UpdatePayload.create({ content: innerBytes })).finish();
  const update = Update.create({ update: payloadBytes });
  const envelope = ServerEnvelope.create({ update });
  return ServerEnvelope.encode(envelope).finish();
}

function makePongEnvelopeBytes(): Uint8Array {
  const { ServerEnvelope } = schemas;
  return ServerEnvelope.encode(ServerEnvelope.create({ pong: new Uint8Array(0) })).finish();
}

describe("FrameDecoder", () => {
  it("decodes a NewMessage update from a ServerEnvelope", () => {
    const decoder = new FrameDecoder();
    const msgBytes = makeNewMessageBytes({ text: "Hello", rid: 1001, date: 1778401706519 });
    const result = decoder.decode(makeEnvelopeBytes(msgBytes));
    expect(result).not.toBeNull();
    expect(result!.preview).toBe("Hello");
    expect(result!.rid).toBe(1001n);
    expect(result!.messageType).toBe("text");
    expect(result!.senderUid).toBe(100n);
    expect(result!.peerId).toBe(200n);
  });

  it("returns null for non-update envelopes (pong)", () => {
    const decoder = new FrameDecoder();
    const result = decoder.decode(makePongEnvelopeBytes());
    expect(result).toBeNull();
  });

  it("returns null for updates without newMessage (field 55)", () => {
    const decoder = new FrameDecoder();
    const { ServerEnvelope, Update, UpdatePayload } = schemas;
    const payloadBytes = UpdatePayload.encode(UpdatePayload.create({})).finish();
    const envelope = ServerEnvelope.create({ update: Update.create({ update: payloadBytes }) });
    const result = decoder.decode(ServerEnvelope.encode(envelope).finish());
    expect(result).toBeNull();
  });

  it("deduplicates by rid", () => {
    const decoder = new FrameDecoder();
    const envelopeBytes = makeEnvelopeBytes(makeNewMessageBytes({ text: "Hello", rid: 42 }));
    expect(decoder.decode(envelopeBytes)).not.toBeNull();
    expect(decoder.decode(envelopeBytes)).toBeNull();
  });

  it("handles different rid values without dedup", () => {
    const decoder = new FrameDecoder();
    const result1 = decoder.decode(makeEnvelopeBytes(makeNewMessageBytes({ text: "First", rid: 100 })));
    const result2 = decoder.decode(makeEnvelopeBytes(makeNewMessageBytes({ text: "Second", rid: 101 })));
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.rid).toBe(100n);
    expect(result2!.rid).toBe(101n);
  });

  it("truncates long text previews to 100 characters", () => {
    const decoder = new FrameDecoder();
    const result = decoder.decode(makeEnvelopeBytes(makeNewMessageBytes({ text: "A".repeat(200), rid: 200 })));
    expect(result).not.toBeNull();
    expect(result!.preview.length).toBe(100);
  });

  it("returns 'unknown' messageType for unrecognized content", () => {
    const decoder = new FrameDecoder();
    const result = decoder.decode(makeEnvelopeBytes(makeNewMessageBytes({ contentType: "none", rid: 300 })));
    expect(result).not.toBeNull();
    expect(result!.messageType).toBe("unknown");
    expect(result!.preview).toBe("[Message]");
  });

  it("returns 'document' messageType for document messages", () => {
    const decoder = new FrameDecoder();
    const result = decoder.decode(makeEnvelopeBytes(makeNewMessageBytes({ contentType: "document", rid: 400 })));
    expect(result).not.toBeNull();
    expect(result!.messageType).toBe("document");
    expect(result!.preview).toBe("[File]");
  });

  it("skips deleted messages", () => {
    const decoder = new FrameDecoder();
    const result = decoder.decode(makeEnvelopeBytes(makeNewMessageBytes({ contentType: "deleted", rid: 500 })));
    expect(result).toBeNull();
  });

  it("gracefully handles undecodable frames", () => {
    const decoder = new FrameDecoder();
    expect(decoder.decode(new Uint8Array([0xFF, 0xFF, 0xFF]))).toBeNull();
  });

  it("evicts old rids when buffer is full", () => {
    const decoder = new FrameDecoder();
    for (let i = 0; i < 100; i++) {
      decoder.decode(makeEnvelopeBytes(makeNewMessageBytes({ text: `msg${i}`, rid: 1000 + i })));
    }
    decoder.decode(makeEnvelopeBytes(makeNewMessageBytes({ text: "msg100", rid: 1100 })));
    const result = decoder.decode(makeEnvelopeBytes(makeNewMessageBytes({ text: "reseen", rid: 1000 })));
    expect(result).not.toBeNull();
  });
});
