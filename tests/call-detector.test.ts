/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { CALL_DETECTOR_SCRIPT } from "../src/engine/call-detector.js";

describe("Call detector script", () => {
  let callNotifications: { callerName: string }[];

  beforeEach(() => {
    callNotifications = [];
    document.body.innerHTML = "";
    (window as any).__baleOnCall = (data: { callerName: string }) => {
      callNotifications.push(data);
    };
  });

  afterEach(() => {
    if ((window as any).__baleCallObserver) {
      (window as any).__baleCallObserver.disconnect();
    }
  });

  function injectCallDetector() {
    eval(CALL_DETECTOR_SCRIPT);
  }

  it("detects incoming call modal", async () => {
    injectCallDetector();

    const modal = document.createElement("div");
    modal.className = "ReactModal__Overlay";
    modal.innerHTML = `
      <div class="CallModal">
        <span class="HOE2x2">Sara</span>
        <button>Answer</button>
        <button>Decline</button>
      </div>
    `;
    document.body.appendChild(modal);

    await new Promise((r) => setTimeout(r, 50));

    expect(callNotifications.length).toBe(1);
    expect(callNotifications[0].callerName).toBe("Sara");
  });

  it("ignores non-call modals", async () => {
    injectCallDetector();

    const modal = document.createElement("div");
    modal.className = "ReactModal__Overlay";
    modal.innerHTML = "<p>Some other content</p>";
    document.body.appendChild(modal);

    await new Promise((r) => setTimeout(r, 50));

    expect(callNotifications).toHaveLength(0);
  });
});
