import { describe, it, expect } from "vitest";
import { validateConfig } from "../src/config.js";
import type { AppConfig } from "../src/types.js";

describe("validateConfig edge cases", () => {
  it("rejects empty bot token", () => {
    const config: AppConfig = {
      bale: { sessionDir: "/data/bale-session" },
      channel: {
        type: "telegram",
        telegram: { botToken: "", chatId: 999 },
      },
      notifications: { messages: true, calls: true, groups: true },
    };
    const errors = validateConfig(config);
    expect(errors).toContain("channel.telegram.botToken is required");
  });

  it("rejects empty webhook URL for Discord", () => {
    const config: AppConfig = {
      bale: { sessionDir: "/data/bale-session" },
      channel: {
        type: "discord",
        discord: { webhookUrl: "" },
      },
      notifications: { messages: true, calls: true, groups: true },
    };
    const errors = validateConfig(config);
    expect(errors).toContain("channel.discord.webhookUrl is required");
  });

  it("rejects empty webhook URL for Slack", () => {
    const config: AppConfig = {
      bale: { sessionDir: "/data/bale-session" },
      channel: {
        type: "slack",
        slack: { webhookUrl: "" },
      },
      notifications: { messages: true, calls: true, groups: true },
    };
    const errors = validateConfig(config);
    expect(errors).toContain("channel.slack.webhookUrl is required");
  });

  it("rejects invalid Discord webhook URL format", () => {
    const config: AppConfig = {
      bale: { sessionDir: "/data/bale-session" },
      channel: {
        type: "discord",
        discord: { webhookUrl: "not-a-url" },
      },
      notifications: { messages: true, calls: true, groups: true },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("webhookUrl"))).toBe(true);
  });

  it("rejects invalid Slack webhook URL format", () => {
    const config: AppConfig = {
      bale: { sessionDir: "/data/bale-session" },
      channel: {
        type: "slack",
        slack: { webhookUrl: "ftp://bad" },
      },
      notifications: { messages: true, calls: true, groups: true },
    };
    const errors = validateConfig(config);
    expect(errors.some((e) => e.includes("webhookUrl"))).toBe(true);
  });

  it("rejects missing session dir", () => {
    const config: AppConfig = {
      bale: { sessionDir: "" },
      channel: {
        type: "telegram",
        telegram: { botToken: "123:ABC", chatId: 999 },
      },
      notifications: { messages: true, calls: true, groups: true },
    };
    const errors = validateConfig(config);
    expect(errors).toContain("bale.sessionDir is required");
  });
});
