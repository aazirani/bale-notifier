import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { saveLocalStorage, loadLocalStorage } from "../src/storage.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bale-storage-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("saveLocalStorage and loadLocalStorage", () => {
  it("round-trips localStorage entries to disk", async () => {
    const entries = [
      { key: "authToken", value: "abc123" },
      { key: "userId", value: "42" },
    ];
    await saveLocalStorage(entries, tmpDir);
    const loaded = await loadLocalStorage(tmpDir);
    expect(loaded).toEqual(entries);
  });

  it("creates the directory if it does not exist", async () => {
    const storageDir = path.join(tmpDir, "sub", "dir");
    const entries = [{ key: "k", value: "v" }];
    await saveLocalStorage(entries, storageDir);
    const loaded = await loadLocalStorage(storageDir);
    expect(loaded).toEqual(entries);
  });

  it("returns empty array when no file exists", async () => {
    const loaded = await loadLocalStorage(tmpDir);
    expect(loaded).toEqual([]);
  });

  it("overwrites existing data on save", async () => {
    await saveLocalStorage([{ key: "old", value: "data" }], tmpDir);
    await saveLocalStorage([{ key: "new", value: "stuff" }], tmpDir);
    const loaded = await loadLocalStorage(tmpDir);
    expect(loaded).toEqual([{ key: "new", value: "stuff" }]);
  });
});
