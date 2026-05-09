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

  describe("Task 3: Immediate extraction", () => {
    it("fires notification immediately on badge text change", async () => {
      const chatItem = createChatItem("Alice", "Hello there", 3);
      document.body.appendChild(chatItem);
      injectScript();

      // Simulate badge count change via characterData
      const badge = document.querySelector('[class*="eVv8xC"]') as HTMLElement;
      badge.childNodes[0].textContent = "4";

      // Wait for MutationObserver microtask
      await new Promise((r) => setTimeout(r, 50));

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toEqual({
        type: "unread_badge_change",
        unreadCount: 4,
        chatName: "Alice",
        messagePreview: "Hello there",
        chatUrl: undefined,
      });
    });

    it("fires notification when new badge element is added to DOM", async () => {
      // Start with chat item but NO badge
      const chatItem = createChatItem("Bob", "What's up?", 0);
      document.body.appendChild(chatItem);
      injectScript();

      // Add a badge element (simulates React adding it)
      const badge = document.createElement("span");
      badge.className = "eVv8xC";
      badge.textContent = "1";
      chatItem.appendChild(badge);

      await new Promise((r) => setTimeout(r, 50));

      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toEqual({
        type: "unread_badge_change",
        unreadCount: 1,
        chatName: "Bob",
        messagePreview: "What's up?",
        chatUrl: undefined,
      });
    });

    it("does not fire notification when badge count does not increase", async () => {
      const chatItem = createChatItem("Alice", "Hello", 3);
      document.body.appendChild(chatItem);
      injectScript();

      // Wait for initial state to settle
      await new Promise((r) => setTimeout(r, 50));

      // Now change text to same value
      const badge = document.querySelector('[class*="eVv8xC"]') as HTMLElement;
      badge.childNodes[0].textContent = "3";

      await new Promise((r) => setTimeout(r, 50));

      const msgNotifications = notifications.filter((n) => n.type === "unread_badge_change");
      expect(msgNotifications.length).toBeLessThanOrEqual(1);
    });
  });

  describe("Task 4: Periodic polling", () => {
    it("periodic scanner catches badge changes missed by observer", async () => {
      vi.useFakeTimers();

      const chatItem = createChatItem("Charlie", "New message", 2);
      document.body.appendChild(chatItem);
      injectScript();

      // Disconnect observer to simulate it missing a mutation
      const observer = (window as any).__baleObserver as MutationObserver;
      observer.disconnect();

      // Manually add a new chat item with badge (simulates React adding it without observer catching it)
      const newChatItem = createChatItem("Dana", "Missed msg", 3);
      document.body.appendChild(newChatItem);

      // Before scanner runs, no notification for Dana
      const before = notifications.filter(
        (n) => n.type === "unread_badge_change" && n.chatName === "Dana",
      );
      expect(before).toHaveLength(0);

      // Advance past scan interval
      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      expect(notifications.filter((n) => n.chatName === "Dana")).toHaveLength(1);
      expect(notifications.find((n) => n.chatName === "Dana")).toEqual({
        type: "unread_badge_change",
        unreadCount: 3,
        chatName: "Dana",
        messagePreview: "Missed msg",
        chatUrl: undefined,
      });
    });

    it("scanner resets chat state when badge is removed (read on phone)", async () => {
      vi.useFakeTimers();

      const chatItem = createChatItem("Eve", "Old msg", 5);
      document.body.appendChild(chatItem);
      injectScript();

      // Disconnect observer
      (window as any).__baleObserver.disconnect();

      // Remove badge (simulates reading on phone)
      const badge = chatItem.querySelector('[class*="eVv8xC"]')!;
      badge.remove();

      // Run scanner — should reset Eve's state to 0
      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      // No notification for Eve (count went down)
      const eveNotifs = notifications.filter((n) => n.chatName === "Eve");
      expect(eveNotifs.length).toBeLessThanOrEqual(1); // At most one from initial injection

      // Now add a new badge with count 1 and different preview
      chatItem.querySelector("div > div + div")!.textContent = "New msg after read";
      const newBadge = document.createElement("span");
      newBadge.className = "eVv8xC";
      newBadge.textContent = "1";
      chatItem.appendChild(newBadge);

      // Run scanner again
      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      // Should detect the new message
      const newEveNotifs = notifications.filter(
        (n) => n.chatName === "Eve" && n.type === "unread_badge_change",
      );
      expect(newEveNotifs.length).toBeGreaterThanOrEqual(1);
      const lastEve = newEveNotifs[newEveNotifs.length - 1];
      expect(lastEve.unreadCount).toBe(1);
      expect(lastEve.messagePreview).toBe("New msg after read");
    });
  });

  describe("Task 5: Preview deduplication", () => {
    it("suppresses notification when same preview was already notified", async () => {
      vi.useFakeTimers();

      const chatItem = createChatItem("Frank", "Same message", 2);
      document.body.appendChild(chatItem);
      injectScript();

      // Disconnect observer to control exactly what the scanner sees
      (window as any).__baleObserver.disconnect();

      // First scan picks up Frank with count 2
      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      const firstNotifs = notifications.filter(
        (n) => n.chatName === "Frank" && n.type === "unread_badge_change",
      );
      expect(firstNotifs.length).toBeGreaterThanOrEqual(1);

      // Change count to 3 but keep SAME preview
      const badge = chatItem.querySelector('[class*="eVv8xC"]')!;
      badge.textContent = "3";

      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      // Should NOT get another notification — same preview
      const allFrankNotifs = notifications.filter(
        (n) => n.chatName === "Frank" && n.type === "unread_badge_change",
      );
      expect(allFrankNotifs.length).toBe(firstNotifs.length);
    });

    it("fires notification when count increases with different preview", async () => {
      vi.useFakeTimers();

      const chatItem = createChatItem("Grace", "First message", 1);
      document.body.appendChild(chatItem);
      injectScript();

      (window as any).__baleObserver.disconnect();

      // First scan
      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      // Change count AND preview
      const badge = chatItem.querySelector('[class*="eVv8xC"]')!;
      badge.textContent = "2";
      chatItem.querySelector("div > div + div")!.textContent = "Second message";

      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      const graceNotifs = notifications.filter(
        (n) => n.chatName === "Grace" && n.type === "unread_badge_change",
      );
      expect(graceNotifs.length).toBeGreaterThanOrEqual(2);
      expect(graceNotifs[graceNotifs.length - 1].messagePreview).toBe("Second message");
      expect(graceNotifs[graceNotifs.length - 1].unreadCount).toBe(2);
    });
  });

  describe("Task 6: Read-on-phone scenario", () => {
    it("does not re-notify after read-on-phone with same last message", async () => {
      vi.useFakeTimers();

      const chatItem = createChatItem("Hank", "The message", 3);
      document.body.appendChild(chatItem);
      injectScript();

      (window as any).__baleObserver.disconnect();

      // First scan sees Hank count=3
      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      // User reads on phone — badge removed
      chatItem.querySelector('[class*="eVv8xC"]')!.remove();

      // Scanner sees badge gone → resets Hank to 0
      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      // Web syncs and re-adds badge with count=1 but SAME preview
      const newBadge = document.createElement("span");
      newBadge.className = "eVv8xC";
      newBadge.textContent = "1";
      chatItem.appendChild(newBadge);

      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      // Should NOT notify — same preview was already notified
      const hankNotifs = notifications.filter(
        (n) => n.chatName === "Hank" && n.type === "unread_badge_change",
      );
      expect(hankNotifs.length).toBe(1);
    });

    it("notifies after read-on-phone when a genuinely new message arrives", async () => {
      vi.useFakeTimers();

      const chatItem = createChatItem("Iris", "Old message", 3);
      document.body.appendChild(chatItem);
      injectScript();

      (window as any).__baleObserver.disconnect();

      // First scan
      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      // User reads on phone — badge removed
      chatItem.querySelector('[class*="eVv8xC"]')!.remove();

      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      // New message arrives — badge reappears with DIFFERENT preview
      chatItem.querySelector("div > div + div")!.textContent = "Brand new message";
      const newBadge = document.createElement("span");
      newBadge.className = "eVv8xC";
      newBadge.textContent = "1";
      chatItem.appendChild(newBadge);

      vi.advanceTimersByTime(5000);
      await vi.advanceTimersByTimeAsync(0);

      const irisNotifs = notifications.filter(
        (n) => n.chatName === "Iris" && n.type === "unread_badge_change",
      );
      expect(irisNotifs.length).toBe(2);
      expect(irisNotifs[1].messagePreview).toBe("Brand new message");
      expect(irisNotifs[1].unreadCount).toBe(1);
    });
  });
});
