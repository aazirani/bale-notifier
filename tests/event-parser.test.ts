import { describe, it, expect } from "vitest";
import { parseDecodedMessage } from "../src/engine/event-parser.js";
import type { DecodedMessage } from "../src/types.js";

describe("parseDecodedMessage", () => {
  it("parses a text message from a decoded proto", () => {
    const msg: DecodedMessage = {
      senderUid: 50n,
      peerType: 1,
      peerId: 100n,
      rid: 999n,
      date: 1700000000n,
      unreadCount: 2,
      preview: "Hello there",
      messageType: "text",
    };

    const event = parseDecodedMessage(msg, { "50": "Amin" }, { "100": "Amin" });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message");
    expect(event!.sender).toBe("Amin");
    expect(event!.chatName).toBe("Amin");
    expect(event!.preview).toBe("Hello there");
    expect(event!.timestamp).toEqual(new Date(Number(msg.date) * 1000));
  });

  it("falls back to Unknown when sender not in cache", () => {
    const msg: DecodedMessage = {
      senderUid: 999n,
      peerType: 1,
      peerId: 888n,
      rid: 1000n,
      date: 1700000000n,
      unreadCount: 1,
      preview: "Test",
      messageType: "text",
    };

    const event = parseDecodedMessage(msg, {}, {});
    expect(event!.sender).toBe("Unknown");
    expect(event!.chatName).toBe("Unknown Chat");
  });

  it("uses group name from chat cache for group peers", () => {
    const msg: DecodedMessage = {
      senderUid: 50n,
      peerType: 2,
      peerId: 300n,
      rid: 1001n,
      date: 1700000000n,
      unreadCount: 3,
      preview: "Group message",
      messageType: "text",
    };

    const event = parseDecodedMessage(msg, { "50": "Amin" }, { "300": "Work Group" });
    expect(event!.chatName).toBe("Work Group");
    expect(event!.sender).toBe("Amin");
  });

  it("constructs chat URL from peer id", () => {
    const msg: DecodedMessage = {
      senderUid: 50n,
      peerType: 1,
      peerId: 12345n,
      rid: 1002n,
      date: 1700000000n,
      unreadCount: 1,
      preview: "Hi",
      messageType: "text",
    };

    const event = parseDecodedMessage(msg, { "50": "Bob" }, { "12345": "Bob" });
    expect(event!.chatUrl).toBe("https://web.bale.ai/contacts?uid=12345");
  });
});
