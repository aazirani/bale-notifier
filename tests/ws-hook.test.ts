/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WS_HOOK_SCRIPT } from "../src/engine/ws-hook.js";

describe("WebSocket hook script", () => {
  let capturedFrames: Uint8Array[];
  let originalWebSocket: typeof WebSocket;

  beforeEach(() => {
    capturedFrames = [];
    originalWebSocket = window.WebSocket;
    (window as any).__baleOnFrame = (bytes: number[]) => {
      capturedFrames.push(new Uint8Array(bytes));
    };
  });

  afterEach(() => {
    window.WebSocket = originalWebSocket;
    delete (window as any).__baleOnFrame;
  });

  function installHook() {
    eval(WS_HOOK_SCRIPT);
  }

  it("replaces the global WebSocket constructor", () => {
    const before = window.WebSocket;
    installHook();
    expect(window.WebSocket).not.toBe(before);
  });

  it("copies static constants to new constructor", () => {
    installHook();
    expect(window.WebSocket.CONNECTING).toBe(originalWebSocket.CONNECTING);
    expect(window.WebSocket.OPEN).toBe(originalWebSocket.OPEN);
    expect(window.WebSocket.CLOSING).toBe(originalWebSocket.CLOSING);
    expect(window.WebSocket.CLOSED).toBe(originalWebSocket.CLOSED);
  });
});
