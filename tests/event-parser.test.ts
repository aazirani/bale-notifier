import { describe, it, expect } from "vitest";
import { parseDomNotification } from "../src/engine/event-parser.js";
import type { DomNotification } from "../src/types.js";

describe("parseDomNotification", () => {
  it("parses an incoming call notification", () => {
    const notification: DomNotification = {
      type: "incoming_call",
      callerName: "Amin",
    };

    const event = parseDomNotification(notification);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("call");
    expect(event!.sender).toBe("Amin");
    expect(event!.chatName).toBe("Amin");
  });

  it("parses an unread badge change notification", () => {
    const notification: DomNotification = {
      type: "unread_badge_change",
      unreadCount: 5,
      chatName: "Work Group",
      messagePreview: "Hey, are you there?",
    };

    const event = parseDomNotification(notification);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message");
    expect(event!.chatName).toBe("Work Group");
    expect(event!.preview).toBe("Hey, are you there?");
  });

  it("returns null for unknown notification types", () => {
    const notification: DomNotification = {
      type: "unread_badge_change" as DomNotification["type"],
    };
    // This is fine — it still parses
    expect(parseDomNotification(notification)).not.toBeNull();
  });

  it("handles unread badge without chat name", () => {
    const notification: DomNotification = {
      type: "unread_badge_change",
      unreadCount: 3,
    };

    const event = parseDomNotification(notification);
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message");
    expect(event!.chatName).toBe("Unknown");
    expect(event!.preview).toBeUndefined();
  });
});
