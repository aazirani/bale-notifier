import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, saveConfig, configExists, validateConfig } from "../src/config.js";
import type { AppConfig } from "../src/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bale-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("configExists", () => {
  it("returns false when config file does not exist", () => {
    expect(configExists(path.join(tmpDir, "missing.json"))).toBe(false);
  });

  it("returns true when config file exists", () => {
    const p = path.join(tmpDir, "config.json");
    fs.writeFileSync(p, "{}");
    expect(configExists(p)).toBe(true);
  });
});

describe("saveConfig and loadConfig", () => {
  it("round-trips a valid config", () => {
    const configPath = path.join(tmpDir, "config.json");
    const config: AppConfig = {
      bale: { sessionDir: "/data/bale-session" },
      channel: {
        type: "telegram",
        telegram: { botToken: "123:ABC", chatId: 999 },
      },
      notifications: { messages: true, calls: true, groups: true },
    };

    saveConfig(configPath, config);
    const loaded = loadConfig(configPath);

    expect(loaded).toEqual(config);
  });
});

describe("validateConfig", () => {
  it("rejects config with no channel type", () => {
    const config = {
      bale: { sessionDir: "/data" },
      channel: { type: "telegram" },
      notifications: { messages: true, calls: true, groups: true },
    } as AppConfig;
    const errors = validateConfig(config);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("accepts a valid telegram config", () => {
    const config: AppConfig = {
      bale: { sessionDir: "/data/bale-session" },
      channel: {
        type: "telegram",
        telegram: { botToken: "123:ABC", chatId: 999 },
      },
      notifications: { messages: true, calls: true, groups: true },
    };
    expect(validateConfig(config)).toEqual([]);
  });

  it("accepts a valid discord config", () => {
    const config: AppConfig = {
      bale: { sessionDir: "/data/bale-session" },
      channel: {
        type: "discord",
        discord: { webhookUrl: "https://discord.com/api/webhooks/123/token" },
      },
      notifications: { messages: true, calls: true, groups: true },
    };
    expect(validateConfig(config)).toEqual([]);
  });

  it("accepts a valid slack config", () => {
    const config: AppConfig = {
      bale: { sessionDir: "/data/bale-session" },
      channel: {
        type: "slack",
        slack: { webhookUrl: "https://hooks.slack.com/services/T/B/X" },
      },
      notifications: { messages: true, calls: true, groups: true },
    };
    expect(validateConfig(config)).toEqual([]);
  });
});
