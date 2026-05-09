/**
 * @vitest-environment jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MONITOR_SCRIPT } from "../src/engine/ws-interceptor.js";

interface DomNotification {
  type: string;
  unreadCount?: number;
  chatName?: string;
  messagePreview?: string;
  chatUrl?: string;
  callerName?: string;
}

describe("DOM Monitoring Script", () => {
  let notifications: DomNotification[];

  beforeEach(() => {
    notifications = [];
    document.body.innerHTML = "";
    (window as any).__baleNotify = (data: DomNotification) => {
      notifications.push(data);
    };
  });

  afterEach(() => {
    if ((window as any).__baleObserver) {
      (window as any).__baleObserver.disconnect();
    }
    if ((window as any).__baleScannerInterval) {
      clearInterval((window as any).__baleScannerInterval);
    }
    vi.useRealTimers();
  });

  function createChatItem(name: string, preview: string, unreadCount: number): HTMLElement {
    const item = document.createElement("div");
    item.className = "dialog-item";
    item.innerHTML = `
      <div>
        <div>
          <div>${name}</div>
        </div>
        <div>${preview}</div>
      </div>
      ${unreadCount > 0 ? `<span class="eVv8xC">${unreadCount}</span>` : ""}
    `;
    return item;
  }

  function injectScript() {
    eval(MONITOR_SCRIPT);
  }

  it("should have test infrastructure ready", () => {
    expect(createChatItem).toBeDefined();
    expect(injectScript).toBeDefined();
  });
});
