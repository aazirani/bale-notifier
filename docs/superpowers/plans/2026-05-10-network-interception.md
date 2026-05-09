# Network-Level Message Interception Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace DOM-based message detection with WebSocket binary frame interception and protobuf decoding.

**Architecture:** Intercept Bale's WebSocket binary frames via a Puppeteer-injected hook. Decode protobuf using programmatic schema definitions (protobufjs). Filter for new messages, deduplicate by message ID, and resolve sender/chat names via Bale's Redux store. Call detection stays DOM-based via a lightweight MutationObserver.

**Tech Stack:** protobufjs (programmatic proto schemas), Puppeteer (page.evaluateOnNewDocument, exposeFunction), TypeScript, vitest

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/engine/protobuf/schemas.ts` | Create | protobufjs schema definitions for Bale's protocol |
| `src/engine/protobuf/index.ts` | Create | Re-exports |
| `src/engine/ws-hook.ts` | Create | WebSocket override script injected before page loads |
| `src/engine/decoder.ts` | Create | Binary frame → DecodedMessage (proto decode + dedup + filter) |
| `src/engine/call-detector.ts` | Create | Minimal DOM-based call detection (MutationObserver for call modals) |
| `src/engine/monitor.ts` | Modify | Replace DOM monitoring with WS hook + decoder + call detector |
| `src/engine/event-parser.ts` | Modify | Convert DecodedMessage → BaleEvent (replaces DomNotification → BaleEvent) |
| `src/types.ts` | Modify | Remove DomNotification, add DecodedMessage |
| `src/constants.ts` | Modify | Remove BADGE_SCAN_INTERVAL_MS, add decoder constants |
| `src/engine/ws-interceptor.ts` | Delete | Old DOM MutationObserver code (replaced by call-detector + ws-hook) |
| `tests/protobuf-schemas.test.ts` | Create | Proto encode/decode roundtrip tests |
| `tests/decoder.test.ts` | Create | Decoder unit tests (dedup, filter, message type mapping) |
| `tests/call-detector.test.ts` | Create | Call detector DOM tests |
| `tests/event-parser.test.ts` | Modify | Update tests for new DecodedMessage input |
| `tests/ws-interceptor.test.ts` | Delete | Old DOM monitoring tests |

---

### Task 1: Install protobufjs and Create Proto Schemas

**Files:**
- Create: `src/engine/protobuf/schemas.ts`
- Create: `src/engine/protobuf/index.ts`
- Create: `tests/protobuf-schemas.test.ts`

- [ ] **Step 1: Install protobufjs**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npm install protobufjs`

- [ ] **Step 2: Write the failing test**

Create `tests/protobuf-schemas.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { schemas } from "../src/engine/protobuf/index.js";

describe("Protobuf schemas", () => {
  it("encodes and decodes a Peer", () => {
    const Peer = schemas.Peer;
    const original = Peer.create({ type: 1, id: 12345, accessHash: 67890n });
    const encoded = Peer.encode(original).finish();
    const decoded = Peer.decode(encoded);
    expect(decoded.type).toBe(1);
    expect(decoded.id).toBe(12345);
    expect(decoded.accessHash).toBe(67890n);
  });

  it("encodes and decodes a TextMessage", () => {
    const TextMessage = schemas.TextMessage;
    const original = TextMessage.create({ text: "Hello world" });
    const encoded = TextMessage.encode(original).finish();
    const decoded = TextMessage.decode(encoded);
    expect(decoded.text).toBe("Hello world");
  });

  it("encodes and decodes a ServerEnvelope with a Dialog update", () => {
    const { ServerEnvelope, Update, Dialog, Peer, TextMessage, MessageContent } = schemas;

    const peer = Peer.create({ type: 1, id: 100, accessHash: 200n });
    const textMsg = TextMessage.create({ text: "Test message" });
    const content = MessageContent.create({ textMessage: textMsg });
    const dialog = Dialog.create({
      peer,
      unreadCount: 3,
      sortDate: 1700000000n,
      senderUid: 50n,
      rid: 999n,
      date: 1700000000n,
      message: content,
    });

    const dialogBytes = Dialog.encode(dialog).finish();
    const update = Update.create({ update: dialogBytes });
    const envelope = ServerEnvelope.create({ update });

    const encoded = ServerEnvelope.encode(envelope).finish();
    const decoded = ServerEnvelope.decode(encoded);

    expect(decoded.update).toBeDefined();

    const decodedDialog = Dialog.decode(decoded.update.update);
    expect(decodedDialog.unreadCount).toBe(3);
    expect(decodedDialog.rid).toBe(999n);
    expect(decodedDialog.senderUid).toBe(50n);

    const decodedContent = MessageContent.decode(decodedDialog.message);
    expect(decodedContent.textMessage.text).toBe("Test message");
  });

  it("encodes and decodes a ServerEnvelope without update (pong)", () => {
    const { ServerEnvelope } = schemas;
    const envelope = ServerEnvelope.create({ pong: new Uint8Array(0) });
    const encoded = ServerEnvelope.encode(envelope).finish();
    const decoded = ServerEnvelope.decode(encoded);
    expect(decoded.update).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run tests/protobuf-schemas.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Create `src/engine/protobuf/schemas.ts`**

```typescript
import protobuf from "protobufjs";

// Bale uses protobuf over WebSocket. These schemas are extracted from Bale's
// web app JS bundle. Field numbers are approximate and validated via roundtrip
// testing against captured binary frames.

const root = new protobuf.Root();

const Peer = new protobuf.Type("Peer")
  .add(new protobuf.Field("type", 1, "int32"))
  .add(new protobuf.Field("id", 2, "int64"))
  .add(new protobuf.Field("accessHash", 3, "int64"));
root.add(Peer);

const TextMessage = new protobuf.Type("TextMessage")
  .add(new protobuf.Field("text", 1, "string"));
root.add(TextMessage);

const MessageContent = new protobuf.Type("MessageContent");
MessageContent.add(new protobuf.Field("textMessage", 14, "TextMessage"))
  .add(new protobuf.Field("documentMessage", 4, "bytes"))
  .add(new protobuf.Field("stickerMessage", 11, "bytes"))
  .add(new protobuf.Field("animatedStickerMessage", 22, "bytes"))
  .add(new protobuf.Field("pollMessage", 27, "bytes"))
  .add(new protobuf.Field("deletedMessage", 3, "bytes"))
  .add(new protobuf.Field("emptyMessage", 5, "bytes"))
  .add(new protobuf.Field("longTextMessage", 28, "TextMessage"));
root.add(MessageContent);

const Dialog = new protobuf.Type("Dialog")
  .add(new protobuf.Field("peer", 1, "Peer"))
  .add(new protobuf.Field("unreadCount", 2, "int32"))
  .add(new protobuf.Field("sortDate", 3, "int64"))
  .add(new protobuf.Field("senderUid", 4, "int64"))
  .add(new protobuf.Field("rid", 5, "int64"))
  .add(new protobuf.Field("date", 6, "int64"))
  .add(new protobuf.Field("message", 7, "MessageContent"))
  .add(new protobuf.Field("state", 8, "int32"))
  .add(new protobuf.Field("markedAsUnread", 9, "bool"))
  .add(new protobuf.Field("isMute", 10, "bool"));
root.add(Dialog);

const Update = new protobuf.Type("Update")
  .add(new protobuf.Field("update", 1, "bytes"));
root.add(Update);

const Response = new protobuf.Type("Response")
  .add(new protobuf.Field("index", 1, "int32"))
  .add(new protobuf.Field("payload", 5, "bytes"));
root.add(Response);

const ServerEnvelope = new protobuf.Type("ServerEnvelope")
  .add(new protobuf.Field("response", 1, "Response"))
  .add(new protobuf.Field("update", 2, "Update"))
  .add(new protobuf.Field("terminateSession", 3, "bytes"))
  .add(new protobuf.Field("pong", 4, "bytes"))
  .add(new protobuf.Field("handshakeResponse", 5, "bytes"));
root.add(ServerEnvelope);

export const schemas = {
  Peer,
  TextMessage,
  MessageContent,
  Dialog,
  Update,
  Response,
  ServerEnvelope,
};
```

- [ ] **Step 5: Create `src/engine/protobuf/index.ts`**

```typescript
export { schemas } from "./schemas.js";
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run tests/protobuf-schemas.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project"
git add src/engine/protobuf/schemas.ts src/engine/protobuf/index.ts tests/protobuf-schemas.test.ts package.json package-lock.json
git commit -m "feat: add protobuf schema definitions for Bale's WebSocket protocol"
```

---

### Task 2: Create WebSocket Hook Script

**Files:**
- Create: `src/engine/ws-hook.ts`
- Create: `tests/ws-hook.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/ws-hook.test.ts`:

```typescript
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
    (window as any).__baleOnFrame = (bytes: Uint8Array) => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run tests/ws-hook.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/engine/ws-hook.ts`**

```typescript
// This script is injected via page.evaluateOnNewDocument() before Bale's JS loads.
// It replaces the global WebSocket constructor to intercept binary frames.
// Each frame is forwarded to window.__baleOnFrame (exposed via page.exposeFunction)
// AND passed through to Bale's original handlers unchanged.

export const WS_HOOK_SCRIPT = `
(function() {
  var OriginalWebSocket = window.WebSocket;

  window.WebSocket = function(url, protocols) {
    var ws = protocols ? new OriginalWebSocket(url, protocols) : new OriginalWebSocket(url);

    ws.addEventListener('message', function(event) {
      if (event.data instanceof ArrayBuffer) {
        try {
          window.__baleOnFrame(Array.from(new Uint8Array(event.data)));
        } catch (e) {
          // __baleOnFrame might not be ready yet during handshake
        }
      }
    });

    return ws;
  };

  // Copy static properties
  window.WebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
  window.WebSocket.OPEN = OriginalWebSocket.OPEN;
  window.WebSocket.CLOSING = OriginalWebSocket.CLOSING;
  window.WebSocket.CLOSED = OriginalWebSocket.CLOSED;
  window.WebSocket.prototype = OriginalWebSocket.prototype;
})();
`;
```

Note: The hook sends `Array.from(new Uint8Array(event.data))` instead of `new Uint8Array(...)` because Puppeteer's `exposeFunction` serializes arguments as JSON. Typed arrays don't survive JSON serialization, but plain arrays do.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run tests/ws-hook.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project"
git add src/engine/ws-hook.ts tests/ws-hook.test.ts
git commit -m "feat: add WebSocket hook script for intercepting binary frames"
```

---

### Task 3: Create the Decoder

**Files:**
- Create: `src/engine/decoder.ts`
- Create: `tests/decoder.test.ts`
- Modify: `src/types.ts` (add DecodedMessage)
- Modify: `src/constants.ts` (add decoder constants)

- [ ] **Step 1: Add DecodedMessage type to `src/types.ts`**

Remove the entire `// --- DOM Notification Types ---` section (the `DomNotificationType` type alias and `DomNotification` interface, lines 60-70). In its place, add:

```typescript
// --- Decoded Message Types (from protobuf) ---

export interface DecodedMessage {
  senderUid: bigint;
  peerType: number;
  peerId: bigint;
  rid: bigint;
  date: bigint;
  unreadCount: number;
  preview: string;
  messageType: "text" | "document" | "sticker" | "animated_sticker" | "poll" | "deleted" | "empty" | "long_text" | "unknown";
}
```

- [ ] **Step 2: Update `src/constants.ts`**

Remove the line `export const BADGE_SCAN_INTERVAL_MS = 5_000;`. Add these constants:

```typescript
// Decoder
export const DEDUP_BUFFER_SIZE = 100;
export const PREVIEW_MAX_LENGTH = 100;
```

- [ ] **Step 3: Write the failing test**

Create `tests/decoder.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { schemas } from "../src/engine/protobuf/index.js";
import { FrameDecoder } from "../src/engine/decoder.js";

function makeDialogBytes(opts: {
  peerType?: number;
  peerId?: number;
  senderUid?: number;
  rid?: number;
  unreadCount?: number;
  date?: number;
  text?: string;
}): Uint8Array {
  const { Dialog, Peer, MessageContent, TextMessage } = schemas;

  const peer = Peer.create({
    type: opts.peerType ?? 1,
    id: opts.peerId ?? 100,
    accessHash: 200n,
  });

  const content = opts.text !== undefined
    ? MessageContent.create({ textMessage: TextMessage.create({ text: opts.text }) })
    : MessageContent.create({});

  const dialog = Dialog.create({
    peer,
    unreadCount: opts.unreadCount ?? 1,
    sortDate: BigInt(opts.date ?? 1700000000),
    senderUid: BigInt(opts.senderUid ?? 50),
    rid: BigInt(opts.rid ?? 999),
    date: BigInt(opts.date ?? 1700000000),
    message: content,
  });

  return Dialog.encode(dialog).finish();
}

function makeEnvelopeBytes(dialogBytes: Uint8Array): Uint8Array {
  const { ServerEnvelope, Update } = schemas;
  const update = Update.create({ update: dialogBytes });
  const envelope = ServerEnvelope.create({ update });
  return ServerEnvelope.encode(envelope).finish();
}

function makePongEnvelopeBytes(): Uint8Array {
  const { ServerEnvelope } = schemas;
  const envelope = ServerEnvelope.create({ pong: new Uint8Array(0) });
  return ServerEnvelope.encode(envelope).finish();
}

describe("FrameDecoder", () => {
  it("decodes a Dialog update from a ServerEnvelope", () => {
    const decoder = new FrameDecoder();
    const dialogBytes = makeDialogBytes({ text: "Hello", unreadCount: 2, rid: 1001 });
    const envelopeBytes = makeEnvelopeBytes(dialogBytes);

    const result = decoder.decode(envelopeBytes);
    expect(result).not.toBeNull();
    expect(result!.preview).toBe("Hello");
    expect(result!.unreadCount).toBe(2);
    expect(result!.rid).toBe(1001n);
    expect(result!.messageType).toBe("text");
  });

  it("returns null for non-update envelopes (pong)", () => {
    const decoder = new FrameDecoder();
    const result = decoder.decode(makePongEnvelopeBytes());
    expect(result).toBeNull();
  });

  it("returns null for dialogs with zero unread count", () => {
    const decoder = new FrameDecoder();
    const dialogBytes = makeDialogBytes({ unreadCount: 0, text: "Hi" });
    const result = decoder.decode(makeEnvelopeBytes(dialogBytes));
    expect(result).toBeNull();
  });

  it("deduplicates by rid", () => {
    const decoder = new FrameDecoder();
    const dialogBytes = makeDialogBytes({ text: "Hello", unreadCount: 1, rid: 42 });

    const result1 = decoder.decode(makeEnvelopeBytes(dialogBytes));
    expect(result1).not.toBeNull();

    const result2 = decoder.decode(makeEnvelopeBytes(dialogBytes));
    expect(result2).toBeNull();
  });

  it("handles different rid values without dedup", () => {
    const decoder = new FrameDecoder();
    const bytes1 = makeDialogBytes({ text: "First", unreadCount: 1, rid: 100 });
    const bytes2 = makeDialogBytes({ text: "Second", unreadCount: 1, rid: 101 });

    const result1 = decoder.decode(makeEnvelopeBytes(bytes1));
    const result2 = decoder.decode(makeEnvelopeBytes(bytes2));
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();
    expect(result1!.rid).toBe(100n);
    expect(result2!.rid).toBe(101n);
  });

  it("truncates long text previews to 100 characters", () => {
    const decoder = new FrameDecoder();
    const longText = "A".repeat(200);
    const dialogBytes = makeDialogBytes({ text: longText, unreadCount: 1, rid: 200 });
    const result = decoder.decode(makeEnvelopeBytes(dialogBytes));
    expect(result).not.toBeNull();
    expect(result!.preview.length).toBe(100);
  });

  it("returns 'unknown' messageType for unrecognized content", () => {
    const decoder = new FrameDecoder();
    const dialogBytes = makeDialogBytes({ text: undefined, unreadCount: 1, rid: 300 });
    const result = decoder.decode(makeEnvelopeBytes(dialogBytes));
    expect(result).not.toBeNull();
    expect(result!.messageType).toBe("unknown");
    expect(result!.preview).toBe("[Message]");
  });

  it("returns 'document' messageType for document messages", () => {
    const decoder = new FrameDecoder();
    const { Dialog, Peer, MessageContent } = schemas;
    const peer = Peer.create({ type: 1, id: 100, accessHash: 200n });
    const content = MessageContent.create({ documentMessage: new Uint8Array(0) });
    const dialog = Dialog.create({
      peer, unreadCount: 1, senderUid: 50n, rid: 400n, date: 1700000000n,
      sortDate: 1700000000n, message: content,
    });
    const dialogBytes = Dialog.encode(dialog).finish();
    const result = decoder.decode(makeEnvelopeBytes(dialogBytes));
    expect(result!.messageType).toBe("document");
    expect(result!.preview).toBe("[File]");
  });

  it("skips deleted messages", () => {
    const decoder = new FrameDecoder();
    const { Dialog, Peer, MessageContent } = schemas;
    const peer = Peer.create({ type: 1, id: 100, accessHash: 200n });
    const content = MessageContent.create({ deletedMessage: new Uint8Array(0) });
    const dialog = Dialog.create({
      peer, unreadCount: 1, senderUid: 50n, rid: 500n, date: 1700000000n,
      sortDate: 1700000000n, message: content,
    });
    const dialogBytes = Dialog.encode(dialog).finish();
    const result = decoder.decode(makeEnvelopeBytes(dialogBytes));
    expect(result).toBeNull();
  });

  it("skips empty messages", () => {
    const decoder = new FrameDecoder();
    const { Dialog, Peer, MessageContent } = schemas;
    const peer = Peer.create({ type: 1, id: 100, accessHash: 200n });
    const content = MessageContent.create({ emptyMessage: new Uint8Array(0) });
    const dialog = Dialog.create({
      peer, unreadCount: 1, senderUid: 50n, rid: 501n, date: 1700000000n,
      sortDate: 1700000000n, message: content,
    });
    const dialogBytes = Dialog.encode(dialog).finish();
    const result = decoder.decode(makeEnvelopeBytes(dialogBytes));
    expect(result).toBeNull();
  });

  it("gracefully handles undecodable frames", () => {
    const decoder = new FrameDecoder();
    const garbage = new Uint8Array([0xFF, 0xFF, 0xFF]);
    const result = decoder.decode(garbage);
    expect(result).toBeNull();
  });

  it("evicts old rids when buffer is full", () => {
    const decoder = new FrameDecoder();
    for (let i = 0; i < 100; i++) {
      const bytes = makeDialogBytes({ text: `msg${i}`, unreadCount: 1, rid: 1000 + i });
      decoder.decode(makeEnvelopeBytes(bytes));
    }

    // rid=1000 should now be evicted
    const bytes1000 = makeDialogBytes({ text: "reseen", unreadCount: 1, rid: 1000 });
    const result = decoder.decode(makeEnvelopeBytes(bytes1000));
    expect(result).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run tests/decoder.test.ts`
Expected: FAIL — module not found

- [ ] **Step 5: Create `src/engine/decoder.ts`**

```typescript
import { schemas } from "./protobuf/index.js";
import type { DecodedMessage } from "../types.js";
import { DEDUP_BUFFER_SIZE, PREVIEW_MAX_LENGTH } from "../constants.js";
import { logger } from "../logger.js";

type MessageType = DecodedMessage["messageType"];

interface ContentResult {
  messageType: MessageType;
  preview: string;
  skip: boolean;
}

function classifyContent(rawMessage: Uint8Array): ContentResult {
  try {
    const content = schemas.MessageContent.decode(rawMessage);

    if (content.textMessage && (content.textMessage as any).text) {
      const text = (content.textMessage as any).text as string;
      return {
        messageType: "text",
        preview: text.length > PREVIEW_MAX_LENGTH ? text.slice(0, PREVIEW_MAX_LENGTH) : text,
        skip: false,
      };
    }

    if (content.longTextMessage && (content.longTextMessage as any).text) {
      const text = (content.longTextMessage as any).text as string;
      return {
        messageType: "long_text",
        preview: text.length > PREVIEW_MAX_LENGTH ? text.slice(0, PREVIEW_MAX_LENGTH) : text,
        skip: false,
      };
    }

    if (content.documentMessage) return { messageType: "document", preview: "[File]", skip: false };
    if (content.stickerMessage) return { messageType: "sticker", preview: "[Sticker]", skip: false };
    if (content.animatedStickerMessage) return { messageType: "animated_sticker", preview: "[Sticker]", skip: false };
    if (content.pollMessage) return { messageType: "poll", preview: "[Poll]", skip: false };
    if (content.deletedMessage) return { messageType: "deleted", preview: "", skip: true };
    if (content.emptyMessage) return { messageType: "empty", preview: "", skip: true };

    return { messageType: "unknown", preview: "[Message]", skip: false };
  } catch {
    return { messageType: "unknown", preview: "[Message]", skip: false };
  }
}

export class FrameDecoder {
  private ridBuffer: bigint[] = [];

  decode(rawBytes: Uint8Array): DecodedMessage | null {
    try {
      const envelope = schemas.ServerEnvelope.decode(rawBytes);

      if (!envelope.update) return null;

      let dialog;
      try {
        dialog = schemas.Dialog.decode(envelope.update.update);
      } catch {
        return null;
      }

      if (!dialog.unreadCount || dialog.unreadCount <= 0) return null;

      const rid = dialog.rid ?? 0n;
      if (rid === 0n) return null;
      if (this.ridBuffer.includes(rid)) return null;
      this.ridBuffer.push(rid);
      if (this.ridBuffer.length > DEDUP_BUFFER_SIZE) {
        this.ridBuffer.shift();
      }

      if (!dialog.message) {
        return {
          senderUid: dialog.senderUid ?? 0n,
          peerType: dialog.peer?.type ?? 0,
          peerId: dialog.peer?.id ?? 0n,
          rid,
          date: dialog.date ?? 0n,
          unreadCount: dialog.unreadCount,
          preview: "[Message]",
          messageType: "unknown",
        };
      }

      const content = classifyContent(dialog.message);
      if (content.skip) return null;

      return {
        senderUid: dialog.senderUid ?? 0n,
        peerType: dialog.peer?.type ?? 0,
        peerId: dialog.peer?.id ?? 0n,
        rid,
        date: dialog.date ?? 0n,
        unreadCount: dialog.unreadCount,
        preview: content.preview,
        messageType: content.messageType,
      };

    } catch (err) {
      logger.debug("Failed to decode frame:", err);
      return null;
    }
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run tests/decoder.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project"
git add src/engine/decoder.ts src/types.ts src/constants.ts tests/decoder.test.ts
git commit -m "feat: add protobuf decoder with dedup and message type classification"
```

---

### Task 4: Update Event Parser

**Files:**
- Modify: `src/engine/event-parser.ts`
- Modify: `tests/event-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the entire contents of `tests/event-parser.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseDecodedMessage } from "../src/engine/event-parser.js";
import type { DecodedMessage } from "../src/types.js";

describe("parseDecodedMessage", () => {
  it("parses a text message from a decoded proto", () => {
    const msg: DecodedMessage = {
      senderUid: 50n,
      peerType: 1,
      peerId: 100n,
      rid: 999n,
      date: 1700000000n,
      unreadCount: 2,
      preview: "Hello there",
      messageType: "text",
    };

    const event = parseDecodedMessage(msg, { "50": "Amin" }, { "100": "Amin" });
    expect(event).not.toBeNull();
    expect(event!.type).toBe("message");
    expect(event!.sender).toBe("Amin");
    expect(event!.chatName).toBe("Amin");
    expect(event!.preview).toBe("Hello there");
    expect(event!.timestamp).toEqual(new Date(Number(msg.date) * 1000));
  });

  it("falls back to Unknown when sender not in cache", () => {
    const msg: DecodedMessage = {
      senderUid: 999n,
      peerType: 1,
      peerId: 888n,
      rid: 1000n,
      date: 1700000000n,
      unreadCount: 1,
      preview: "Test",
      messageType: "text",
    };

    const event = parseDecodedMessage(msg, {}, {});
    expect(event!.sender).toBe("Unknown");
    expect(event!.chatName).toBe("Unknown Chat");
  });

  it("uses group name from chat cache for group peers", () => {
    const msg: DecodedMessage = {
      senderUid: 50n,
      peerType: 2,
      peerId: 300n,
      rid: 1001n,
      date: 1700000000n,
      unreadCount: 3,
      preview: "Group message",
      messageType: "text",
    };

    const event = parseDecodedMessage(msg, { "50": "Amin" }, { "300": "Work Group" });
    expect(event!.chatName).toBe("Work Group");
    expect(event!.sender).toBe("Amin");
  });

  it("constructs chat URL from peer id", () => {
    const msg: DecodedMessage = {
      senderUid: 50n,
      peerType: 1,
      peerId: 12345n,
      rid: 1002n,
      date: 1700000000n,
      unreadCount: 1,
      preview: "Hi",
      messageType: "text",
    };

    const event = parseDecodedMessage(msg, { "50": "Bob" }, { "12345": "Bob" });
    expect(event!.chatUrl).toBe("https://web.bale.ai/contacts?uid=12345");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run tests/event-parser.test.ts`
Expected: FAIL — parseDecodedMessage is not exported

- [ ] **Step 3: Replace `src/engine/event-parser.ts`**

```typescript
import type { BaleEvent, DecodedMessage } from "../types.js";

export interface NameCache {
  [uid: string]: string;
}

export function parseDecodedMessage(
  msg: DecodedMessage,
  userCache: NameCache,
  chatCache: NameCache,
): BaleEvent | null {
  const senderKey = String(msg.senderUid);
  const peerKey = String(msg.peerId);

  const sender = userCache[senderKey] ?? "Unknown";
  const chatName = chatCache[peerKey] ?? "Unknown Chat";
  const chatUrl = `https://web.bale.ai/contacts?uid=${msg.peerId}`;

  return {
    type: "message",
    timestamp: new Date(Number(msg.date) * 1000),
    sender,
    chatName,
    preview: msg.preview || undefined,
    chatUrl,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run tests/event-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project"
git add src/engine/event-parser.ts tests/event-parser.test.ts
git commit -m "refactor: update event parser for protobuf DecodedMessage input"
```

---

### Task 5: Create Minimal Call Detector

**Files:**
- Create: `src/engine/call-detector.ts`
- Create: `tests/call-detector.test.ts`

The spec requires call detection to remain DOM-based for now (the call protobuf update type is not yet identified). This is a lightweight MutationObserver that watches only for the call modal overlay.

- [ ] **Step 1: Write the failing test**

Create `tests/call-detector.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run tests/call-detector.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Create `src/engine/call-detector.ts`**

```typescript
import type { Page } from "puppeteer";

// Minimal MutationObserver that detects incoming call modals only.
// Kept DOM-based because the call protobuf update type is not yet identified.

export const CALL_DETECTOR_SCRIPT = `
(function() {
  var observer = new MutationObserver(function(mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var m = mutations[i];
      if (!m.addedNodes) continue;
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
            window.__baleOnCall({ callerName: callerName });
            return;
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  window.__baleCallObserver = observer;
})();
`;

export async function startCallDetection(
  page: Page,
  onCall: (callerName: string) => void,
): Promise<() => void> {
  await page.exposeFunction("__baleOnCall", (data: { callerName: string }) => {
    onCall(data.callerName);
  });

  await page.evaluate(CALL_DETECTOR_SCRIPT);

  return async () => {
    await page.evaluate(`
      if (window.__baleCallObserver) {
        window.__baleCallObserver.disconnect();
        window.__baleCallObserver = null;
      }
    `).catch(() => {});
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run tests/call-detector.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project"
git add src/engine/call-detector.ts tests/call-detector.test.ts
git commit -m "feat: add minimal DOM-based call detector for incoming calls"
```

---

### Task 6: Update Monitor to Wire Everything Together

**Files:**
- Modify: `src/engine/monitor.ts`

- [ ] **Step 1: Replace `src/engine/monitor.ts`**

```typescript
import type { AppConfig, BaleEvent, NotificationChannel, DecodedMessage } from "../types.js";
import { launchBrowser, navigateToBale } from "./browser.js";
import { WS_HOOK_SCRIPT } from "./ws-hook.js";
import { FrameDecoder } from "./decoder.js";
import { parseDecodedMessage, type NameCache } from "./event-parser.js";
import { startCallDetection } from "./call-detector.js";
import { createChannel } from "../channels/index.js";
import { logger } from "../logger.js";
import { RECONNECT_INITIAL_BACKOFF_MS, RECONNECT_MAX_BACKOFF_MS, KEEPALIVE_INTERVAL_MS, KEEPALIVE_CHECK_INTERVAL_MS, NOTIFICATION_MAX_RETRIES } from "../constants.js";
import type { Page } from "puppeteer";

const RETRY_DELAYS_MS = [1_000, 2_000, 4_000];

export class BaleMonitor {
  private channel: NotificationChannel;
  private running = false;
  private backoffMs = RECONNECT_INITIAL_BACKOFF_MS;
  private browserClose: (() => Promise<void>) | null = null;

  constructor(private config: AppConfig) {
    this.channel = createChannel(config);
  }

  async start(): Promise<void> {
    this.running = true;
    while (this.running) {
      try {
        await this.runSession();
      } catch (err) {
        logger.error(`Monitor error: ${err}`);
        logger.info(`Retrying in ${this.backoffMs}ms...`);
        await this.sleep(this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, RECONNECT_MAX_BACKOFF_MS);
      }
    }
  }

  stop(): void {
    this.running = false;
    this.browserClose?.().catch((err) => logger.debug("Browser close error:", err));
  }

  private async runSession(): Promise<void> {
    const session = await launchBrowser(this.config.bale.sessionDir);
    this.browserClose = session.close;

    try {
      // Inject WS hook BEFORE navigating to Bale
      await session.page.evaluateOnNewDocument(WS_HOOK_SCRIPT);

      // Expose the callback for the WS hook to call
      const decoder = new FrameDecoder();
      await session.page.exposeFunction("__baleOnFrame", (rawBytes: number[]) => {
        const bytes = new Uint8Array(rawBytes);
        const decoded = decoder.decode(bytes);
        if (decoded && this.config.notifications.messages) {
          this.handleDecodedMessage(session.page, decoded);
        }
      });

      await navigateToBale(session.page);

      const url = session.page.url();
      const pageText = await session.page.evaluate("document.body.textContent || ''") as string;
      const isLoginPage = url.includes("/login") ||
        pageText.includes("Choosing the option to log in") ||
        pageText.includes("login me") ||
        pageText.includes("زبان");

      if (isLoginPage) {
        throw new Error("Bale session expired — delete ./data/config.json and ./data/bale-session, then re-run setup to re-login");
      }

      // Start DOM-based call detection (call proto type not yet identified)
      const stopCallDetection = await startCallDetection(session.page, async (callerName) => {
        logger.info(`Detected: incoming call from ${callerName}`);
        if (this.config.notifications.calls) {
          const event: BaleEvent = {
            type: "call",
            timestamp: new Date(),
            sender: callerName,
            chatName: callerName,
          };
          await this.dispatch(event);
        }
      });

      logger.info("Connected to Bale. Monitoring for notifications via WebSocket...\n");

      this.backoffMs = RECONNECT_INITIAL_BACKOFF_MS;

      let keepalive: NodeJS.Timeout | null = null;
      let disconnected = false;

      keepalive = setInterval(async () => {
        if (disconnected) return;
        try {
          await session.page.evaluate("document.title");
        } catch {
          disconnected = true;
          session.browser.close().catch((err) => logger.debug("Browser close on disconnect error:", err));
        }
      }, KEEPALIVE_INTERVAL_MS);

      await new Promise<void>((resolve) => {
        session.browser.on("disconnected", () => {
          logger.info("Browser disconnected. Reconnecting...");
          if (keepalive) clearInterval(keepalive);
          resolve();
        });
        const check = setInterval(() => {
          if (!this.running) {
            clearInterval(check);
            if (keepalive) clearInterval(keepalive);
            resolve();
          }
        }, KEEPALIVE_CHECK_INTERVAL_MS);
      });

      await stopCallDetection();
    } finally {
      await session.close();
      this.browserClose = null;
    }
  }

  private async handleDecodedMessage(page: Page, msg: DecodedMessage): Promise<void> {
    try {
      const { userCache, chatCache } = await this.resolveNameCaches(page);
      const event = parseDecodedMessage(msg, userCache, chatCache);
      if (event) {
        await this.dispatch(event);
      }
    } catch (err) {
      logger.warn("Failed to resolve names or dispatch event:", err);
    }
  }

  private async resolveNameCaches(page: Page): Promise<{ userCache: NameCache; chatCache: NameCache }> {
    try {
      const caches = await page.evaluate(() => {
        const rootEl = document.getElementById("root");
        if (!rootEl) return { userCache: {}, chatCache: {} };

        const fiberKey = Object.keys(rootEl).find((k) => k.startsWith("__reactFiber"));
        if (!fiberKey) return { userCache: {}, chatCache: {} };

        let fiber = (rootEl as any)[fiberKey];
        let store: any = null;
        for (let i = 0; i < 50 && fiber && !store; i++) {
          const state = fiber.memoizedState || fiber.stateNode?.memoizedState;
          if (state?.store) store = state.store;
          if (state?.memoizedState?.store) store = state.memoizedState.store;
          fiber = fiber.return;
        }

        if (!store) return { userCache: {}, chatCache: {} };

        const state = store.getState();
        const userCache: Record<string, string> = {};
        const chatCache: Record<string, string> = {};

        if (state.Users) {
          try {
            const users = state.Users instanceof Map ? state.Users : new Map(Object.entries(state.Users));
            users.forEach((user: any, key: any) => {
              const name = user?.firstName || user?.lastName || user?.displayName;
              if (name) userCache[String(user?.userId || user?.id || key)] = name;
            });
          } catch {}
        }

        return { userCache, chatCache };
      });

      return {
        userCache: caches.userCache,
        chatCache: caches.chatCache,
      };
    } catch {
      return { userCache: {}, chatCache: {} };
    }
  }

  private async dispatch(event: BaleEvent): Promise<void> {
    for (let attempt = 1; attempt <= NOTIFICATION_MAX_RETRIES; attempt++) {
      try {
        await this.channel.send(event);
        logger.info(`[${event.timestamp.toISOString()}] Notified: ${event.type} from ${event.sender ?? event.chatName}`);
        return;
      } catch (err) {
        if (attempt < NOTIFICATION_MAX_RETRIES) {
          logger.warn(`Notification attempt ${attempt} failed, retrying in ${RETRY_DELAYS_MS[attempt - 1]}ms...`, err);
          await this.sleep(RETRY_DELAYS_MS[attempt - 1]);
        } else {
          logger.error(`Failed to send notification after ${NOTIFICATION_MAX_RETRIES} attempts:`, err);
        }
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

- [ ] **Step 2: Run all tests to verify nothing is broken**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run`
Expected: PASS for all tests except `tests/ws-interceptor.test.ts` (deleted in Task 7)

- [ ] **Step 3: Commit**

```bash
cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project"
git add src/engine/monitor.ts
git commit -m "feat: update monitor to use WS hook + protobuf decoder + DOM call detector"
```

---

### Task 7: Remove Old DOM Code and Clean Up

**Files:**
- Delete: `src/engine/ws-interceptor.ts`
- Delete: `tests/ws-interceptor.test.ts`

- [ ] **Step 1: Delete old files**

Run:
```bash
cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project"
rm src/engine/ws-interceptor.ts
rm tests/ws-interceptor.test.ts
```

- [ ] **Step 2: Run all tests**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npx vitest run`
Expected: PASS — all tests pass, no import errors

- [ ] **Step 3: Build to verify TypeScript compiles**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npm run build`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project"
git add -A
git commit -m "chore: remove old DOM-based message detection code"
```

---

### Task 8: Full Integration Verification

**Files:** None (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npm test`
Expected: All tests pass

- [ ] **Step 2: Build the project**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && npm run build`
Expected: Clean build, no errors

- [ ] **Step 3: Verify file structure**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && find src/engine -type f -name "*.ts" | sort`
Expected output:
```
src/engine/browser.ts
src/engine/call-detector.ts
src/engine/decoder.ts
src/engine/event-parser.ts
src/engine/monitor.ts
src/engine/protobuf/index.ts
src/engine/protobuf/schemas.ts
src/engine/ws-hook.ts
```

`ws-interceptor.ts` should NOT appear.

- [ ] **Step 4: Verify no references to old types**

Run: `cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project" && grep -r "DomNotification\|ws-interceptor\|BADGE_SCAN" src/ tests/ --include="*.ts" || echo "No references found"`
Expected: "No references found"

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
cd "/Users/aminazirani/Documents/Projects/Bale to Telegram Bot Project"
git add -A
git diff --cached --quiet || git commit -m "chore: final cleanup after network interception migration"
```
