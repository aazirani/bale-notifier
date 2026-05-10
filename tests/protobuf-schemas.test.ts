import { describe, it, expect } from "vitest";
import { schemas } from "../src/engine/protobuf/index.js";
import protobuf from "protobufjs";

function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "object" && value !== null && "low" in value && "high" in value) {
    const v = value as { low: number; high: number };
    return BigInt(v.high) * BigInt(2 ** 32) + BigInt(v.low >>> 0);
  }
  return BigInt(0);
}

function bigintToLong(value: bigint | number) {
  if (typeof value === "number") return value;
  return protobuf.util.Long.fromBigInt(value);
}

describe("Protobuf schemas", () => {
  it("encodes and decodes a Peer", () => {
    const { Peer } = schemas;
    const original = Peer.create({ type: 1, id: bigintToLong(12345), accessHash: bigintToLong(67890n) });
    const encoded = Peer.encode(original).finish();
    const decoded = Peer.decode(encoded);
    expect(decoded.type).toBe(1);
    expect(toBigInt(decoded.id)).toBe(12345n);
    expect(toBigInt(decoded.accessHash)).toBe(67890n);
  });

  it("encodes and decodes a TextMessage", () => {
    const { TextMessage } = schemas;
    const original = TextMessage.create({ text: "Hello world" });
    const encoded = TextMessage.encode(original).finish();
    const decoded = TextMessage.decode(encoded);
    expect(decoded.text).toBe("Hello world");
  });

  it("encodes and decodes a NewMessage", () => {
    const { NewMessage, Peer, MessageContent, TextMessage } = schemas;

    const from = Peer.create({ type: 1, id: bigintToLong(100) });
    const to = Peer.create({ type: 1, id: bigintToLong(200) });
    const contentBytes = MessageContent.encode(
      MessageContent.create({ textMessage: TextMessage.create({ text: "Test message" }) })
    ).finish();

    const newMsg = NewMessage.create({
      from,
      senderUid: bigintToLong(100n),
      date: bigintToLong(1778401706519n),
      rid: bigintToLong(999n),
      message: contentBytes,
      to,
    });

    const encoded = NewMessage.encode(newMsg).finish();
    const decoded: any = NewMessage.decode(encoded);

    expect(toBigInt(decoded.from?.id)).toBe(100n);
    expect(toBigInt(decoded.to?.id)).toBe(200n);
    expect(toBigInt(decoded.rid)).toBe(999n);
    // message is bytes — decode separately
    const content: any = MessageContent.decode(new Uint8Array(decoded.message));
    expect(content.textMessage?.text).toBe("Test message");
  });

  it("round-trips through UpdatePayload, NewMessageUpdate, and ServerEnvelope", () => {
    const { UpdatePayload, NewMessageUpdate, NewMessage, Peer, TextMessage, MessageContent, ServerEnvelope, Update } = schemas;

    const from = Peer.create({ type: 1, id: bigintToLong(100) });
    const to = Peer.create({ type: 1, id: bigintToLong(200) });
    const contentBytes = MessageContent.encode(
      MessageContent.create({ textMessage: TextMessage.create({ text: "Hello" }) })
    ).finish();
    const newMsg = NewMessage.create({
      from, senderUid: bigintToLong(100n), date: bigintToLong(1778401706519n),
      rid: bigintToLong(42n), message: contentBytes, to,
    });
    const newMsgBytes = NewMessage.encode(newMsg).finish();

    const inner = NewMessageUpdate.create({ newMessage: newMsgBytes });
    const innerBytes = NewMessageUpdate.encode(inner).finish();
    const wrapper = UpdatePayload.create({ content: innerBytes });
    const wrapperBytes = UpdatePayload.encode(wrapper).finish();

    const update = Update.create({ update: wrapperBytes });
    const envelope = ServerEnvelope.create({ update });
    const envelopeBytes = ServerEnvelope.encode(envelope).finish();

    const decodedEnv: any = ServerEnvelope.decode(envelopeBytes);
    expect(decodedEnv.update).toBeDefined();

    const decodedWrapper: any = UpdatePayload.decode(new Uint8Array(decodedEnv.update.update));
    expect(decodedWrapper.content).toBeDefined();

    const decodedInner: any = NewMessageUpdate.decode(new Uint8Array(decodedWrapper.content));
    expect(decodedInner.newMessage).toBeDefined();

    const decodedMsg: any = NewMessage.decode(new Uint8Array(decodedInner.newMessage));
    expect(toBigInt(decodedMsg.rid)).toBe(42n);
    const decodedContent: any = MessageContent.decode(new Uint8Array(decodedMsg.message));
    expect(decodedContent.textMessage?.text).toBe("Hello");
  });

  it("encodes and decodes a ServerEnvelope without update (pong)", () => {
    const { ServerEnvelope } = schemas;
    const envelope = ServerEnvelope.create({ pong: new Uint8Array(0) });
    const encoded = ServerEnvelope.encode(envelope).finish();
    const decoded: any = ServerEnvelope.decode(encoded);
    expect(decoded.update).toBeNull();
  });

  it("correctly uses field 15 for textMessage in MessageContent", () => {
    const { MessageContent, TextMessage } = schemas;
    const content = MessageContent.create({ textMessage: TextMessage.create({ text: "test" }) });
    const encoded = MessageContent.encode(content).finish();
    const decoded: any = MessageContent.decode(encoded);
    expect(decoded.textMessage?.text).toBe("test");
  });

  it("correctly uses field 3 for index in Response", () => {
    const { Response } = schemas;
    const resp = Response.create({ index: 42 });
    const encoded = Response.encode(resp).finish();
    const decoded: any = Response.decode(encoded);
    expect(decoded.index).toBe(42);
  });
});
