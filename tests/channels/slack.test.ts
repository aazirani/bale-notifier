import { describe, it, expect, vi, beforeEach } from "vitest";
import { SlackChannel } from "../../src/channels/slack.js";
import type { BaleEvent } from "../../src/types.js";

describe("SlackChannel", () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
  });

  function createChannel() {
    return new SlackChannel({ webhookUrl: "https://hooks.slack.com/services/T/B/X" });
  }

  it("sends a message event as Slack block", async () => {
    const channel = createChannel();
    const event: BaleEvent = {
      type: "message",
      timestamp: new Date("2026-05-08T10:00:00Z"),
      sender: "Ali Rezaei",
      chatName: "Work Group",
      preview: "Hey, are you coming?",
    };

    await channel.send(event);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://hooks.slack.com/services/T/B/X",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("Ali Rezaei");
    expect(body.text).toContain("Work Group");
  });

  it("sends a call event", async () => {
    const channel = createChannel();
    const event: BaleEvent = {
      type: "call",
      timestamp: new Date("2026-05-08T10:00:00Z"),
      sender: "Sara Ahmadi",
      chatName: "Direct",
      callType: "voice",
    };

    await channel.send(event);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toContain("Voice Call");
  });

  it("validateConfig returns true with valid URL", async () => {
    const channel = createChannel();
    mockFetch.mockResolvedValueOnce({ ok: true });
    expect(await channel.validateConfig()).toBe(true);
  });
});