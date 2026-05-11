import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  discoverUsers,
  loadMasterConfig,
  saveMasterConfig,
  loadUserConfig,
  saveUserConfig,
} from "../src/config.js";
import type { AppConfig, MasterConfig } from "../src/types.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bale-multi-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("discoverUsers", () => {
  it("returns empty array when users dir does not exist", () => {
    expect(discoverUsers(path.join(tmpDir, "no-such-dir"))).toEqual([]);
  });

  it("returns empty array for users dir with no configs", () => {
    const usersDir = path.join(tmpDir, "users");
    fs.mkdirSync(path.join(usersDir, "empty-dir"), { recursive: true });
    expect(discoverUsers(usersDir)).toEqual([]);
  });

  it("returns user IDs for directories with config.json", () => {
    const usersDir = path.join(tmpDir, "users");
    fs.mkdirSync(path.join(usersDir, "alice"), { recursive: true });
    fs.mkdirSync(path.join(usersDir, "bob"), { recursive: true });
    fs.writeFileSync(
      path.join(usersDir, "alice", "config.json"),
      JSON.stringify({ bale: { sessionDir: "/a" } }),
    );
    fs.writeFileSync(
      path.join(usersDir, "bob", "config.json"),
      JSON.stringify({ bale: { sessionDir: "/b" } }),
    );
    const users = discoverUsers(usersDir);
    expect(users.sort()).toEqual(["alice", "bob"]);
  });
});

describe("loadMasterConfig and saveMasterConfig", () => {
  it("round-trips a master config", () => {
    const configPath = path.join(tmpDir, "master.json");
    const config: MasterConfig = {
      serverIp: "203.0.113.10",
      novncPortRange: [6081, 6090],
      loginTimeoutMinutes: 15,
      userPorts: { alice: 6081 },
    };
    saveMasterConfig(configPath, config);
    const loaded = loadMasterConfig(configPath);
    expect(loaded).toEqual(config);
  });

  it("returns default master config when file does not exist", () => {
    const loaded = loadMasterConfig(path.join(tmpDir, "missing.json"));
    expect(loaded.serverIp).toBe("localhost");
    expect(loaded.novncPortRange).toEqual([6081, 6090]);
    expect(loaded.loginTimeoutMinutes).toBe(15);
    expect(loaded.userPorts).toEqual({});
  });
});

describe("loadUserConfig and saveUserConfig", () => {
  it("round-trips a user config", () => {
    const usersDir = path.join(tmpDir, "users");
    const config: AppConfig = {
      bale: { sessionDir: "/data/users/alice/session" },
      channel: { type: "telegram", telegram: { botToken: "123:ABC", chatId: 999 } },
      notifications: { messages: true, calls: true, groups: true },
    };
    saveUserConfig(usersDir, "alice", config);
    const loaded = loadUserConfig(usersDir, "alice");
    expect(loaded).toEqual(config);
  });
});
