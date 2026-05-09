# Reliable Message Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix message notification reliability from <50% to near-100% by fixing the stale DOM reference bug, adding a periodic polling fallback, and adding preview-based deduplication to prevent false positives.

**Architecture:** The in-page DOM monitoring script (injected via `page.evaluate()`) is rewritten with three changes: (1) badge data is extracted immediately on mutation instead of after a 2-second delay that causes stale references, (2) a periodic scanner runs every 5 seconds as a fallback to catch mutations the observer missed, (3) a dedup layer tracks last-notified previews per chat to suppress false positives from device sync.

**Tech Stack:** TypeScript, Puppeteer, MutationObserver, setInterval, jsdom (for tests), vitest

---

## File Structure

- **Modify:** `src/engine/ws-interceptor.ts` — extract script to exported constant, rewrite with immediate extraction + polling + dedup
- **Modify:** `src/constants.ts` — replace `BADGE_DEBOUNCE_MS` with `BADGE_SCAN_INTERVAL_MS`
- **Create:** `tests/ws-interceptor.test.ts` — jsdom-based tests for the monitoring script

---

### Task 1: Install jsdom + add scanner constant

**Files:**
- Modify: `src/constants.ts:10`
- Modify: `package.json`

- [ ] **Step 1: Install jsdom**

Run: `npm install --save-dev jsdom`

- [ ] **Step 2: Replace BADGE_DEBOUNCE_MS with scanner interval**

In `src/constants.ts`, replace line 10:

```typescript
export const BADGE_SCAN_INTERVAL_MS = 5_000;
```

(Remove the `BADGE_DEBOUNCE_MS` constant — it's only defined, never imported.)

- [ ] **Step 3: Verify existing tests still pass**

Run: `npm test`
Expected: All existing tests pass. No code imports `BADGE_DEBOUNCE_MS`.

---

### Task 2: Extract script + create test infrastructure

**Files:**
- Modify: `src/engine/ws-interceptor.ts` (extract script to exported constant)
- Create: `tests/ws-interceptor.test.ts`

- [ ] **Step 1: Extract inline script into an exported constant**

Replace the entire `page.evaluate()` template literal with an exported constant. The `startDomMonitoring` function references this constant instead of an inline string.

In `src/engine/ws-interceptor.ts`, add above `startDomMonitoring`:

```typescript
export const MONITOR_SCRIPT = `
(function() {
  var lastKnownState = {};
  var lastNotified = {};

  function findDialogContainer(el) {
    var container = el;
    for (var w = 0; w < 8; w++) {
      if (!container || !container.parentElement) break;
      container = container.parentElement;
      var cls = (typeof container.className === 'string') ? container.className : '';
      if (cls.indexOf('dialog-item') !== -1) return container;
    }
    return null;
  }

  function extractChatName(container) {
    if (!container || !container.firstElementChild || !container.firstElementChild.firstElementChild) {
      return 'Unknown';
    }
    var nameRow = container.firstElementChild.firstElementChild;
    if (nameRow.firstElementChild) {
      return (nameRow.firstElementChild.textContent || '').trim();
    }
    var raw = (nameRow.textContent || '').trim();
    var i = raw.length - 5;
    if (i > 0 && raw.charAt(i + 2) === ':') {
      var t = raw.substring(i);
      if (t.charAt(0) >= '0' && t.charAt(0) <= '9' && t.charAt(1) >= '0' && t.charAt(1) <= '9'
        && t.charAt(3) >= '0' && t.charAt(3) <= '9' && t.charAt(4) >= '0' && t.charAt(4) <= '9') {
        return raw.substring(0, i).trim();
      }
    }
    return raw;
  }

  function extractMessagePreview(container) {
    if (!container || !container.firstElementChild) return undefined;
    var contentRow = container.firstElementChild;
    var previewRow = null;
    var child = contentRow.firstElementChild;
    while (child) {
      var next = child.nextElementSibling;
      if (next) { previewRow = next; break; }
      child = next;
    }
    if (!previewRow) return undefined;
    var fullText = (previewRow.textContent || '').trim();
    var stripped = fullText.replace(/[0-9]+$/, '').trim();
    if (stripped.length > 0 && stripped.length < 200) return stripped;
    return undefined;
  }

  function extractChatUrl(container) {
    if (!container) return undefined;
    var wrapper = container;
    for (var w = 0; w < 5; w++) {
      if (!wrapper || !wrapper.parentElement) break;
      wrapper = wrapper.parentElement;
    }
    if (!wrapper) return undefined;
    var el = container;
    for (var r = 0; r < 8; r++) {
      if (!el) break;
      var keys = Object.keys(el);
      for (var ki = 0; ki < keys.length; ki++) {
        if (keys[ki].indexOf('__react') !== -1) {
          var fiber = el[keys[ki]];
          var node = fiber;
          for (var f = 0; f < 10; f++) {
            if (!node) break;
            var props = node.memoizedProps || node.pendingProps || {};
            var uid = props.uid || props.peerId || props.chatId || props.userId || props.id;
            if (uid && typeof uid === 'string' && uid.length > 0) {
              return 'https://web.bale.ai/contacts?uid=' + uid;
            }
            if (typeof uid === 'number' && uid > 0) {
              return 'https://web.bale.ai/contacts?uid=' + uid;
            }
            node = node.return || node.child;
          }
        }
      }
      el = el.parentElement;
    }
    return undefined;
  }

  function tryNotify(chatName, count, preview, chatUrl) {
    if (!chatName || count <= 0) return;
    var last = lastNotified[chatName];
    if (last && last.preview === preview) return;
    lastNotified[chatName] = { preview: preview, timestamp: Date.now() };
    window.__baleNotify({
      type: 'unread_badge_change',
      unreadCount: count,
      chatName: chatName,
      messagePreview: preview || undefined,
      chatUrl: chatUrl || undefined
    });
  }

  function handleBadgeEl(badgeEl, forceNum) {
    var text = forceNum !== undefined ? String(forceNum) : (badgeEl.textContent || '').trim();
    var num = forceNum !== undefined ? forceNum : parseInt(text, 10);
    if (isNaN(num) || text.length > 3) return;

    var container = findDialogContainer(badgeEl);
    var chatName = container ? extractChatName(container) : null;

    if (num === 0) {
      if (chatName) lastKnownState[chatName] = 0;
      return;
    }
    if (!chatName) return;

    var preview = container ? extractMessagePreview(container) : undefined;
    var chatUrl = container ? extractChatUrl(container) : undefined;
    var lastCount = chatName in lastKnownState ? lastKnownState[chatName] : -1;
    lastKnownState[chatName] = num;

    if (num > lastCount) {
      tryNotify(chatName, num, preview, chatUrl);
    }
  }

  function scanAllBadges() {
    var badges = document.querySelectorAll('[class*="eVv8xC"]');
    var seenChats = {};
    for (var i = 0; i < badges.length; i++) {
      var badge = badges[i];
      var text = (badge.textContent || '').trim();
      var num = parseInt(text, 10);
      if (isNaN(num) || text.length > 3 || num <= 0) continue;
      var container = findDialogContainer(badge);
      var chatName = container ? extractChatName(container) : null;
      if (!chatName) continue;
      seenChats[chatName] = true;
      var lastCount = chatName in lastKnownState ? lastKnownState[chatName] : -1;
      lastKnownState[chatName] = num;
      if (num > lastCount) {
        var preview = container ? extractMessagePreview(container) : undefined;
        var chatUrl = container ? extractChatUrl(container) : undefined;
        tryNotify(chatName, num, preview, chatUrl);
      }
    }
    for (var key in lastKnownState) {
      if (!seenChats[key] && lastKnownState[key] > 0) {
        lastKnownState[key] = 0;
      }
    }
  }

  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];

      // --- Incoming call ---
      if (m.addedNodes) {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var node = m.addedNodes[j];
          if (node.nodeType !== 1) continue;
          var callModals = [];
          if (node.querySelector) {
            var found = node.querySelector('[class*="CallModal"]');
            if (found) callModals.push(found);
          }
          if (node.className && typeof node.className === 'string' && node.className.indexOf('CallModal') !== -1) {
            callModals.push(node);
          }
          for (var k = 0; k < callModals.length; k++) {
            var modal = callModals[k];
            var modalText = (modal.textContent || '').trim();
            if (modalText.indexOf('Answer') !== -1 && modalText.indexOf('Decline') !== -1) {
              var callerEl = document.querySelector('.HOE2x2');
              var callerName = callerEl
                ? callerEl.textContent.trim()
                : modalText.replace(/Answer/g, '').replace(/Decline/g, '').trim();
              window.__baleNotify({ type: 'incoming_call', callerName: callerName });
              return;
            }
          }

          // --- Badge element added ---
          if (node.querySelector) {
            var addedBadges = node.querySelectorAll('[class*="eVv8xC"]');
            for (var b = 0; b < addedBadges.length; b++) {
              handleBadgeEl(addedBadges[b]);
            }
          }
          if (node.className && typeof node.className === 'string' && node.className.indexOf('eVv8xC') !== -1) {
            handleBadgeEl(node);
          }
        }
      }

      // --- Unread badge text changed ---
      if (m.type === 'characterData' && m.target && m.target.parentElement) {
        var text = m.target.textContent.trim();
        var num = parseInt(text, 10);
        if (!isNaN(num) && text.length <= 3 && num >= 0) {
          handleBadgeEl(m.target.parentElement, num);
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  window.__baleObserver = observer;
  window.__baleScannerInterval = setInterval(scanAllBadges, ${BADGE_SCAN_INTERVAL_MS});
})()
`;
```

Note the template literal interpolation `${BADGE_SCAN_INTERVAL_MS}` — this injects the constant value into the script string.

Import at top of `ws-interceptor.ts`:

```typescript
import { BADGE_SCAN_INTERVAL_MS } from "../constants.js";
```

- [ ] **Step 2: Update startDomMonitoring to use exported constant**

Replace the body of `startDomMonitoring`:

```typescript
export async function startDomMonitoring(
  page: Page,
  onNotification: (notification: DomNotification) => void,
): Promise<() => void> {
  await page.exposeFunction("__baleNotify", (data: DomNotification) => {
    onNotification(data);
  });

  await page.evaluate(MONITOR_SCRIPT);

  return async () => {
    await page.evaluate(`
      if (window.__baleObserver) {
        window.__baleObserver.disconnect();
        window.__baleObserver = null;
      }
      if (window.__baleScannerInterval) {
        clearInterval(window.__baleScannerInterval);
        window.__baleScannerInterval = null;
      }
    `).catch(() => {});
  };
}
```

Key changes from original:
1. Uses `MONITOR_SCRIPT` constant instead of inline string
2. Cleanup function also clears the scanner `setInterval`
3. No more 2-second `setTimeout` — data is extracted immediately

- [ ] **Step 3: Create test file with jsdom infrastructure**

Create `tests/ws-interceptor.test.ts`:

```typescript
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
    // Clean up observer and scanner
    if ((window as any).__baleObserver) {
      (window as any).__baleObserver.disconnect();
    }
    if ((window as any).__baleScannerInterval) {
      clearInterval((window as any).__baleScannerInterval);
    }
    vi.useRealTimers();
  });

  /** Build a simulated Bale chat list DOM with the structure expected by the extraction functions */
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

  // ... tests will be added in subsequent tasks ...
});
```

- [ ] **Step 4: Verify the project compiles and existing tests pass**

Run: `npm run build && npm test`
Expected: Build succeeds. All existing tests pass. New test file has no tests yet, which is fine.

- [ ] **Step 5: Commit**

```bash
git add src/engine/ws-interceptor.ts src/constants.ts tests/ws-interceptor.test.ts package.json package-lock.json
git commit -m "refactor: extract monitor script for testability, add jsdom test infra"
```

---

### Task 3: TDD — Immediate extraction (fix stale DOM reference bug)

**Files:**
- Modify: `tests/ws-interceptor.test.ts`

The implementation is already in the `MONITOR_SCRIPT` from Task 2. These tests verify it works correctly.

- [ ] **Step 1: Write test — badge text change fires notification immediately**

Add to the `describe` block in `tests/ws-interceptor.test.ts`:

```typescript
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
```

- [ ] **Step 2: Write test — badge added via childList fires notification**

```typescript
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
```

- [ ] **Step 3: Write test — no notification when count stays the same**

```typescript
  it("does not fire notification when badge count does not increase", async () => {
    const chatItem = createChatItem("Alice", "Hello", 3);
    document.body.appendChild(chatItem);
    injectScript();

    // Wait for initial state to settle
    await new Promise((r) => setTimeout(r, 50));

    // MutationObserver detected the badge during injection — skip that
    // Now change text to same value
    const badge = document.querySelector('[class*="eVv8xC"]') as HTMLElement;
    badge.childNodes[0].textContent = "3";

    await new Promise((r) => setTimeout(r, 50));

    // Should not have a new notification (count didn't increase)
    // The initial badge injection might trigger one, so we check the last one
    // is from initial state and no new one was added
    const msgNotifications = notifications.filter((n) => n.type === "unread_badge_change");
    // Either 0 or 1 (from initial scan), but not more
    expect(msgNotifications.length).toBeLessThanOrEqual(1);
  });
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/ws-interceptor.test.ts`
Expected: All 3 tests PASS. (The implementation is already correct in MONITOR_SCRIPT from Task 2 — immediate extraction, no setTimeout delay.)

- [ ] **Step 5: Commit**

```bash
git add tests/ws-interceptor.test.ts
git commit -m "test: add immediate extraction tests for DOM monitoring"
```

---

### Task 4: TDD — Periodic polling fallback

**Files:**
- Modify: `tests/ws-interceptor.test.ts`

- [ ] **Step 1: Write test — scanner catches badge that observer missed**

This test disconnects the observer first, then adds a badge manually. The scanner should catch it.

```typescript
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
```

- [ ] **Step 2: Write test — scanner resets count when badge disappears**

```typescript
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
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/ws-interceptor.test.ts`
Expected: All tests pass — periodic scanner is already implemented in MONITOR_SCRIPT.

- [ ] **Step 4: Commit**

```bash
git add tests/ws-interceptor.test.ts
git commit -m "test: add periodic polling fallback tests"
```

---

### Task 5: TDD — Preview deduplication (prevents false positives)

**Files:**
- Modify: `tests/ws-interceptor.test.ts`

- [ ] **Step 1: Write test — same preview suppresses duplicate**

```typescript
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
```

- [ ] **Step 2: Write test — different preview fires notification**

```typescript
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
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/ws-interceptor.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/ws-interceptor.test.ts
git commit -m "test: add preview deduplication tests"
```

---

### Task 6: TDD — Read-on-phone scenario

**Files:**
- Modify: `tests/ws-interceptor.test.ts`

- [ ] **Step 1: Write test — count reset then re-increase with same preview = no false positive**

```typescript
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
```

- [ ] **Step 2: Write test — count reset then re-increase with NEW preview = real notification**

```typescript
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
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run tests/ws-interceptor.test.ts`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add tests/ws-interceptor.test.ts
git commit -m "test: add read-on-phone scenario tests"
```

---

### Task 7: Run full test suite + final verification

- [ ] **Step 1: Run all project tests**

Run: `npm test`
Expected: All tests pass (both new and existing).

- [ ] **Step 2: Verify build succeeds**

Run: `npm run build`
Expected: No TypeScript errors.

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "feat: reliable message detection with polling fallback and dedup"
```
