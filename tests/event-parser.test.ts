import { describe, it, expect } from "vitest";
import { parseDecodedMessage } from "../src/engine/event-parser.js";
import type { DecodedMessage } from "../src/types.js";

function makeMsg(overrides: Partial<DecodedMessage> = {}): DecodedMessage {
  return {
    senderUid: 50n,
    peerType: 1,
    peerId: 100n,
    rid: 999n,
    date: 1778401706519n,
    preview: "Hello there",
    messageType: "text",
    ...overrides,
  };
}

describe("parseDecodedMessage", () => {
  it("parses a private chat message", () => {
    const msg = makeMsg({ peerType: 1 });
    const event = parseDecodedMessage(msg);
    expect(event.type).toBe("message");
    expect(event.source).toBe("Private Chat");
    expect(event.preview).toBe("Hello there");
    expect(event.timestamp).toEqual(new Date(Number(msg.date)));
  });

  it("labels group messages", () => {
    const msg = makeMsg({ peerType: 2 });
    const event = parseDecodedMessage(msg);
    expect(event.source).toBe("Group");
  });

  it("labels channel messages", () => {
    const msg = makeMsg({ peerType: 5 });
    const event = parseDecodedMessage(msg);
    expect(event.source).toBe("Channel");
  });

  it("constructs chat URL from peer id", () => {
    const msg = makeMsg({ peerId: 12345n });
    const event = parseDecodedMessage(msg);
    expect(event.chatUrl).toBe("https://web.bale.ai/contacts?uid=12345");
  });
});
