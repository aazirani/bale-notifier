import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiscordChannel } from "../../src/channels/discord.js";
import type { BaleEvent } from "../../src/types.js";

describe("DiscordChannel", () => {
  const mockFetch = vi.fn().mockResolvedValue({ ok: true });

  beforeEach(() => {
    mockFetch.mockClear();
    vi.stubGlobal("fetch", mockFetch);
  });

  function createChannel() {
    return new DiscordChannel({ webhookUrl: "https://discord.com/api/webhooks/123/token" });
  }

  it("sends a message event as a Discord embed", async () => {
    const channel = createChannel();
    const event: BaleEvent = {
      type: "message",
      timestamp: new Date("2026-05-08T10:00:00Z"),
      source: "Group",
      preview: "Hey, are you coming?",
    };

    await channel.send(event);

    expect(mockFetch).toHaveBeenCalledWith(
      "https://discord.com/api/webhooks/123/token",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.embeds[0].title).toBe("New Bale Message");
    expect(body.embeds[0].fields[0].value).toBe("Group");
  });

  it("sends a call event as a Discord embed", async () => {
    const channel = createChannel();
    const event: BaleEvent = {
      type: "call",
      timestamp: new Date("2026-05-08T10:00:00Z"),
      source: "Call from Sara",
      callType: "video",
    };

    await channel.send(event);

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.embeds[0].title).toBe("Video Call from Bale");
  });

  it("validateConfig returns true with valid URL", async () => {
    const channel = createChannel();
    mockFetch.mockResolvedValueOnce({ ok: true });
    expect(await channel.validateConfig()).toBe(true);
  });
});
