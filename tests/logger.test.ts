import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { logger, setLogLevel } from "../src/logger.js";

describe("logger", () => {
  const origLevel = process.env.LOG_LEVEL;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (origLevel !== undefined) {
      process.env.LOG_LEVEL = origLevel;
    } else {
      delete process.env.LOG_LEVEL;
    }
    setLogLevel(process.env.LOG_LEVEL);
  });

  it("logs info messages with [info] prefix", () => {
    logger.info("test message");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("[info]"),
      "test message",
    );
  });

  it("logs error messages to stderr", () => {
    logger.error("something failed");
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("[error]"),
      "something failed",
    );
  });

  it("logs warn messages to stderr", () => {
    logger.warn("caution");
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("[warn]"),
      "caution",
    );
  });

  it("suppresses debug messages by default", () => {
    logger.debug("hidden");
    expect(console.log).not.toHaveBeenCalled();
  });

  it("shows debug messages when LOG_LEVEL=debug", () => {
    process.env.LOG_LEVEL = "debug";
    setLogLevel("debug");
    logger.debug("visible");
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("[debug]"),
      "visible",
    );
  });

  it("includes ISO timestamp in output", () => {
    logger.info("ts test");
    const call = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call).toMatch(/^\[(info|debug|warn|error)\] \d{4}-\d{2}-\d{2}T/);
  });
});
