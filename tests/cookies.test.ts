import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { saveCookies, loadCookies } from "../src/cookies.js";
import type { Protocol } from "puppeteer";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bale-cookies-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

const sampleCookies: Protocol.Network.Cookie[] = [
  {
    name: "session",
    value: "abc123",
    domain: ".bale.ai",
    path: "/",
    expires: -1,
    size: 15,
    httpOnly: false,
    secure: true,
    sameSite: "Lax",
  },
  {
    name: "token",
    value: "xyz789",
    domain: ".bale.ai",
    path: "/",
    expires: -1,
    size: 14,
    httpOnly: true,
    secure: true,
    sameSite: "None",
  },
];

describe("saveCookies and loadCookies", () => {
  it("round-trips cookies to disk", async () => {
    await saveCookies(sampleCookies, tmpDir);
    const loaded = await loadCookies(tmpDir);
    expect(loaded).toEqual(sampleCookies);
  });

  it("creates the directory if it does not exist", async () => {
    const cookieDir = path.join(tmpDir, "sub", "dir");
    await saveCookies(sampleCookies, cookieDir);
    const loaded = await loadCookies(cookieDir);
    expect(loaded).toEqual(sampleCookies);
  });

  it("returns empty array when no cookie file exists", async () => {
    const loaded = await loadCookies(tmpDir);
    expect(loaded).toEqual([]);
  });
});
