import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Mock puppeteer before importing anything that uses it
const mockContext = {
  newPage: vi.fn(() => ({
    setViewport: vi.fn(),
    evaluateOnNewDocument: vi.fn(),
    exposeFunction: vi.fn(),
    goto: vi.fn(),
    evaluate: vi.fn(() => "logged in content"),
    url: vi.fn(() => "https://web.bale.ai/chats"),
    cookies: vi.fn(() => []),
    setCookie: vi.fn(),
    on: vi.fn(),
    waitForFunction: vi.fn(),
  })),
  close: vi.fn(),
  on: vi.fn(),
};

const mockBrowser = {
  createBrowserContext: vi.fn(() => Promise.resolve(mockContext)),
  close: vi.fn(),
  newPage: vi.fn(),
};

vi.mock("puppeteer", () => ({
  default: {
    launch: vi.fn(() => Promise.resolve(mockBrowser)),
  },
}));

// Mock the cookies module
vi.mock("../src/cookies.js", () => ({
  saveCookies: vi.fn(),
  loadCookies: vi.fn(() => Promise.resolve([])),
}));

let tmpDir: string;
let usersDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bale-orch-test-"));
  usersDir = path.join(tmpDir, "users");
  fs.mkdirSync(usersDir, { recursive: true });
  vi.clearAllMocks();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeUserConfig(userId: string) {
  const dir = path.join(usersDir, userId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      bale: { sessionDir: path.join(dir, "session"), noVncUrl: "" },
      channel: { type: "telegram", telegram: { botToken: "t", chatId: 1 } },
      notifications: { messages: true, calls: true, groups: true },
    }),
  );
}

describe("Orchestrator", () => {
  it("discovers users from the users directory", async () => {
    writeUserConfig("alice");
    writeUserConfig("bob");
    const { Orchestrator } = await import("../src/orchestrator.js");
    const orch = new Orchestrator(tmpDir);
    const users = orch.listUsers();
    expect(users.sort()).toEqual(["alice", "bob"]);
  });

  it("removes a user and their data", async () => {
    writeUserConfig("alice");
    const { Orchestrator } = await import("../src/orchestrator.js");
    const orch = new Orchestrator(tmpDir);
    await orch.removeUser("alice");
    expect(fs.existsSync(path.join(usersDir, "alice", "config.json"))).toBe(false);
    expect(orch.listUsers()).toEqual([]);
  });

  it("saves state to state.json", async () => {
    writeUserConfig("alice");
    const { Orchestrator } = await import("../src/orchestrator.js");
    const orch = new Orchestrator(tmpDir);
    await orch.saveState();
    const statePath = path.join(tmpDir, "state.json");
    expect(fs.existsSync(statePath)).toBe(true);
  });
});
