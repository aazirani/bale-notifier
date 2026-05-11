import { describe, it, expect, vi, beforeEach } from "vitest";

const mockProcs: Array<{
  kill: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  stderr: { on: ReturnType<typeof vi.fn>; removeAllListeners: ReturnType<typeof vi.fn> };
}> = [];

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    const proc = {
      kill: vi.fn(),
      on: vi.fn(),
      stderr: {
        on: vi.fn(),
        removeAllListeners: vi.fn(),
      },
    };
    mockProcs.push(proc);
    return proc;
  }),
}));

// Must import AFTER mock setup
const { NoVncSession } = await import("../src/setup/novnc.js");

beforeEach(() => {
  mockProcs.length = 0;
});

describe("NoVncSession", () => {
  it("starts x11vnc and websockify on the specified port", async () => {
    const session = new NoVncSession(6081, 5901);
    const url = await session.start();

    expect(url).toContain(":6081");
    expect(url).toContain("token=");
    expect(mockProcs.length).toBeGreaterThanOrEqual(2);
    session.stop();
  });

  it("returns a URL with a random token of at least 16 hex chars", async () => {
    const session = new NoVncSession(6082, 5902);
    const url = await session.start();
    const token = new URL(url).searchParams.get("token");
    expect(token).toBeTruthy();
    expect(token!.length).toBeGreaterThanOrEqual(16);
    session.stop();
  });

  it("kills x11vnc and websockify on stop", async () => {
    const session = new NoVncSession(6083, 5903);
    await session.start();
    const procsAtStart = mockProcs.length;
    session.stop();
    expect(mockProcs[procsAtStart - 2].kill).toHaveBeenCalled();
    expect(mockProcs[procsAtStart - 1].kill).toHaveBeenCalled();
  });

  it("generates different tokens for different sessions", async () => {
    const s1 = new NoVncSession(6084, 5904);
    const url1 = await s1.start();
    s1.stop();

    const s2 = new NoVncSession(6085, 5905);
    const url2 = await s2.start();
    s2.stop();

    const token1 = new URL(url1).searchParams.get("token");
    const token2 = new URL(url2).searchParams.get("token");
    expect(token1).not.toBe(token2);
  }, 10000);
});
