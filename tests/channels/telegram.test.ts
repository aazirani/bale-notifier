import { describe, it, expect, vi, beforeEach } from "vitest";
import { TelegramChannel } from "../../src/channels/telegram.js";
import type { BaleEvent } from "../../src/types.js";

describe("TelegramChannel", () => {
  const mockSendMessage = vi.fn().mockResolvedValue({ message_id: 1 });

  beforeEach(() => {
    mockSendMessage.mockClear();
  });

  function createChannel() {
    const channel = new TelegramChannel({ botToken: "123:ABC", chatId: 999 });
    // Inject mock bot instead of creating real one
    channel["bot"] = {
      sendMessage: mockSendMessage,
      getMe: vi.fn().mockResolvedValue({ id: 123, username: "testbot" })
    } as never;
    return channel;
  }

  it("formats a message event correctly", async () => {
    const channel = createChannel();
    const event: BaleEvent = {
      type: "message",
      timestamp: new Date("2026-05-08T10:00:00Z"),
      sender: "Ali Rezaei",
      chatName: "Work Group",
      preview: "Hey, are you coming?",
    };

    await channel.send(event);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text, options] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe(999);
    expect(text).toContain("Ali Rezaei");
    expect(text).toContain("Hey, are you coming?");
    expect(options).toEqual({ disable_web_page_preview: true });
  });

  it("formats a call event correctly", async () => {
    const channel = createChannel();
    const event: BaleEvent = {
      type: "call",
      timestamp: new Date("2026-05-08T10:00:00Z"),
      sender: "Sara Ahmadi",
      chatName: "Direct",
      callType: "voice",
    };

    await channel.send(event);

    expect(mockSendMessage).toHaveBeenCalledTimes(1);
    const [chatId, text] = mockSendMessage.mock.calls[0];
    expect(chatId).toBe(999);
    expect(text).toContain("Voice Call");
    expect(text).toContain("Sara Ahmadi");
  });

  it("validateConfig returns true with valid config", async () => {
    const channel = createChannel();
    expect(await channel.validateConfig()).toBe(true);
  });
});