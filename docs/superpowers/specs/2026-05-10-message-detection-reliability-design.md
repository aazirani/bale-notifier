# Reliable Message Detection

## Problem

Message notifications are missed >50% of the time. Calls work perfectly. The root cause is a stale DOM reference bug in the MutationObserver handler, compounded by the lack of any fallback detection mechanism.

Additionally, when the user reads messages on the Bale mobile app, the web client syncs and re-renders, which can cause false positive notifications (the system thinks a new message arrived when it's just a sync artifact).

## Root Cause

`ws-interceptor.ts:124-136`: When a badge mutation is detected, the code captures a reference to the badge DOM element (`capturedBadge`), then waits 2 seconds before extracting chat data. During those 2 seconds, React replaces the DOM subtree (standard SPA reconciliation), so the captured reference points to a detached/removed node. `findDialogContainer()` returns null, and the notification either fires with incomplete data or is silently lost.

## Design

### 1. Fix MutationObserver — Immediate Extraction

Extract ALL data (chat name, preview, URL) immediately inside the mutation handler, before React can touch the DOM. Store the extracted data in JS variables, then fire the notification using stored data after a short deduplication window.

No more stale references. The notification carries data extracted at the instant the mutation was detected.

### 2. Periodic Polling Fallback

Every 5 seconds, a scanner runs inside the browser page that:

1. Queries all visible unread badges on the page
2. For each badge, extracts chat name and current count
3. Compares with `lastKnownState` tracking object
4. If count increased AND message preview is different from last notified preview → queue notification
5. If count decreased (user read on phone) → update tracking, no notification

**Preview deduplication**: Store last message preview text per chat. If badge count increased but preview is the same text already notified, skip — this prevents false positives from device sync.

**Why 5 seconds**: Fast enough to catch missed mutations, slow enough to not waste CPU. MutationObserver still fires instantly for the common case.

**Handling "read on phone" scenario**:
- Badge 5 → 0: update tracking, no notification
- Badge 0 → 1 with NEW preview: real new message, notify
- Badge 0 → 1 with SAME preview as last notification: sync artifact, skip

### 3. Unified Notification Pipeline

Both detection paths feed into the same dedup + notification pipeline:

```
MutationObserver ──┐
                   ├──→ Dedup Queue ──→ __baleNotify() ──→ Channel
Periodic Scanner ──┘
```

**Dedup logic** (in browser page context):
- `lastKnownState`: `{ chatName → count }` — tracks current unread counts
- `lastNotified`: `{ chatName → { count, preview, timestamp } }` — tracks what was already notified
- Notification fires only if count increased AND preview text differs from last notification

### Scope

Single file change: `src/engine/ws-interceptor.ts`

No changes to `event-parser.ts`, `monitor.ts`, or `types.ts`.
