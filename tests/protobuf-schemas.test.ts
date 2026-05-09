import { describe, it, expect } from "vitest";
import { schemas } from "../src/engine/protobuf/index.js";
import protobuf from "protobufjs";

// Helper to handle protobufjs Long objects
function toBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "object" && value !== null && "low" in value && "high" in value) {
    // protobufjs Long object
    const low = (value as { low: number }).low;
    const high = (value as { high: number }).high;
    const unsigned = (value as { unsigned?: boolean }).unsigned || false;
    // Handle signed/unsigned correctly
    const result = BigInt(high) * BigInt(2 ** 32) + BigInt(low >>> 0);
    return unsigned ? result : (result >= BigInt(2 ** 63) ? result - BigInt(2 ** 64) : result);
  }
  return BigInt(0);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "object" && value !== null && "low" in value) {
    return (value as { low: number }).low;
  }
  return 0;
}

// Helper to convert BigInt to protobufjs Long for encoding
function bigintToLong(value: bigint | number) {
  if (typeof value === "number") return value;
  return protobuf.util.Long.fromBigInt(value);
}

describe("Protobuf schemas", () => {
  it("encodes and decodes a Peer", () => {
    const Peer = schemas.Peer;
    const original = Peer.create({
      type: 1,
      id: bigintToLong(12345),
      accessHash: bigintToLong(67890n)
    });
    const encoded = Peer.encode(original).finish();
    const decoded = Peer.decode(encoded);
    expect(decoded.type).toBe(1);
    expect(toNumber(decoded.id)).toBe(12345);
    expect(toBigInt(decoded.accessHash)).toBe(67890n);
  });

  it("encodes and decodes a TextMessage", () => {
    const TextMessage = schemas.TextMessage;
    const original = TextMessage.create({ text: "Hello world" });
    const encoded = TextMessage.encode(original).finish();
    const decoded = TextMessage.decode(encoded);
    expect(decoded.text).toBe("Hello world");
  });

  it("encodes and decodes a ServerEnvelope with a Dialog update", () => {
    const { ServerEnvelope, Update, Dialog, Peer, TextMessage, MessageContent } = schemas;

    const peer = Peer.create({ type: 1, id: bigintToLong(100), accessHash: bigintToLong(200n) });
    const textMsg = TextMessage.create({ text: "Test message" });
    const content = MessageContent.create({ textMessage: textMsg });
    const dialog = Dialog.create({
      peer,
      unreadCount: 3,
      sortDate: bigintToLong(1700000000n),
      senderUid: bigintToLong(50n),
      rid: bigintToLong(999n),
      date: bigintToLong(1700000000n),
      message: MessageContent.encode(content).finish(), // Encode to bytes
    });

    const dialogBytes = Dialog.encode(dialog).finish();
    const update = Update.create({ update: dialogBytes });
    const envelope = ServerEnvelope.create({ update });

    const encoded = ServerEnvelope.encode(envelope).finish();
    const decoded = ServerEnvelope.decode(encoded);

    expect(decoded.update).toBeDefined();

    const decodedDialog = Dialog.decode(decoded.update.update);
    expect(decodedDialog.unreadCount).toBe(3);
    expect(toBigInt(decodedDialog.rid)).toBe(999n);
    expect(toBigInt(decodedDialog.senderUid)).toBe(50n);

    const decodedContent = MessageContent.decode(decodedDialog.message);
    expect(decodedContent.textMessage.text).toBe("Test message");
  });

  it("encodes and decodes a ServerEnvelope without update (pong)", () => {
    const { ServerEnvelope } = schemas;
    const envelope = ServerEnvelope.create({ pong: new Uint8Array(0) });
    const encoded = ServerEnvelope.encode(envelope).finish();
    const decoded = ServerEnvelope.decode(encoded);
    // protobufjs returns null for missing oneof fields, not undefined
    expect(decoded.update).toBeNull();
  });
});
