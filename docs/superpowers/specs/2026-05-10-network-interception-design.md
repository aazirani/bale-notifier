# Network-Level Message Interception Design

Replace DOM-based message detection with WebSocket binary frame interception and protobuf decoding.

## Problem

The current DOM monitoring approach (MutationObserver + polling) is fundamentally flawed for message detection:

- False positives: typing indicators, read receipts, and other UI changes trigger as "new messages"
- Stale DOM references: React re-renders can invalidate DOM nodes between detection and extraction
- Fragile: any Bale UI redesign breaks selectors
- Noisy: any visual change in the chat list triggers the observer

## Solution

Intercept Bale's WebSocket traffic at the binary level and decode protobuf messages directly. Bale uses `@bufbuild/protobuf` with gRPC-style request/response over WebSocket (`wss://next-ws.bale.ai/ws/`). All proto schemas are embedded in the web app's JS bundle.

## Architecture

```
Bale WebSocket (wss://next-ws.bale.ai/ws/)
    |
    v
WebSocket Hook (page.evaluateOnNewDocument)
    | captures binary frames, passes through to Bale's JS unchanged
    v
Protobuf Decoder (@bufbuild/protobuf)
    | decodes ServerEnvelope -> Update -> Dialog/Message
    v
Message Filter
    | extracts only new messages (ignores typing, read receipts, pings)
    v
Notification Pipeline (unchanged)
    | BaleEvent -> channels (Telegram/Discord/Slack)
    v
```

## Proto Schema Definitions

Bale uses `@bufbuild/protobuf` with these key message types (field numbers extracted from JS bundle analysis):

### ServerEnvelope (server-to-client wrapper)

```
field 1: Response          // RPC response (matched by request index)
field 2: Update            // Server push (new messages arrive here)
field 3: TerminateSession  // Force disconnect
field 4: Pong              // Keep-alive response
field 5: HandshakeResponse // Connection handshake
```

### Update

```
field 1: bytes update      // Raw serialized inner proto
```

The inner bytes are decoded using a context-specific proto type. The update type depends on which subscription produced it. Since we intercept all frames without knowing the subscription context, we try decoding as Dialog first (the most common update type for message detection). If that fails or produces no meaningful data, we skip the frame. This can be refined as we discover additional update types through testing.

### Dialog (chat list entry)

```
field 1:  Peer peer              // User/group/channel reference
field 2:  int32 unreadCount      // Number of unread messages
field 3:  int64 sortDate         // Sort timestamp
field 4:  int64 senderUid        // Last message sender
field 5:  int64 rid              // Last message random ID
field 6:  int64 date             // Last message timestamp
field 7:  MessageContent message // Last message content (oneof)
field 8:  int32 state            // Message state enum
field 9:  bool markedAsUnread
field 10: bool isMute
```

Note: Field numbers above are approximate based on JS bundle analysis. Exact field numbers will be validated during implementation by encoding/decoding test fixtures against Bale's own protobuf decoder.

### Peer (conversation reference)

```
type: int32                // Peer type (1=user, 2=group, 3=channel)
id: int64                  // Peer ID
accessHash: int64          // Access hash
```

### Message

```
senderUid: int64
rid: int64                 // Message random ID (unique per message)
date: int64                // Timestamp
message: MessageContent    // Content (oneof)
state: int32               // Message state
quotedMessage: Message     // Reply-to (optional)
editedAt: int64            // Edit timestamp (optional)
```

### MessageContent (oneof union)

```
field 3:  deletedMessage
field 4:  documentMessage       // Files, images, videos
field 5:  emptyMessage
field 11: stickerMessage
field 14: textMessage           // Plain text messages
field 22: animatedStickerMessage
field 27: pollMessage
field 28: longTextMessage
// ... other types
```

### TextMessage

```
text: string
mentions: repeated Mention
```

## WebSocket Hook

Injected via `page.evaluateOnNewDocument()` before Bale's JS loads. Replaces the global `WebSocket` constructor with a wrapper that:

1. Creates the real WebSocket (original constructor)
2. Intercepts `addEventListener('message', ...)` and direct `onmessage` assignments
3. For each binary frame, calls `window.__baleOnFrame(new Uint8Array(event.data))`
4. Passes the original event through to Bale's handlers unchanged

The hook persists across Bale's automatic reconnections because it replaces `window.WebSocket` globally.

Bridge to Node.js: `page.exposeFunction('__baleOnFrame', handler)` receives the raw bytes in Node.js context.

## Decoding Pipeline

```typescript
function decodeFrame(rawBytes: Uint8Array): BaleEvent | null {
  // Step 1: Decode outer envelope
  const envelope = ServerEnvelope.decode(rawBytes);

  // Step 2: Only process server-pushed updates (field 2)
  if (!envelope.update) return null;

  // Step 3: Decode inner update bytes as Dialog update
  const dialog = Dialog.decode(envelope.update.update);

  // Step 4: Filter — only notify on unread messages
  if (dialog.unreadCount <= 0) return null;

  // Step 5: Deduplicate by message rid
  if (seenRids.has(dialog.rid)) return null;
  seenRids.add(dialog.rid);

  // Step 6: Extract message data
  return extractBaleEvent(dialog);
}
```

### Deduplication

- Circular buffer of last 100 message `rid` values
- Prevents duplicate notifications from multiple Dialog updates for the same message
- Old entries evicted when buffer is full

### Message Type Mapping

```
textMessage          -> preview: actual text (truncated 100 chars)
documentMessage      -> preview: "[File]"
stickerMessage       -> preview: "[Sticker]"
animatedStickerMessage -> preview: "[Sticker]"
pollMessage          -> preview: "[Poll]"
deletedMessage       -> skip (not a new message)
emptyMessage         -> skip
other                -> preview: "[Message]"
```

### Sender Resolution

- `senderUid` from Dialog or Message is resolved to a display name
- Resolution methods (in priority order):
  1. `page.evaluate()` to read Bale's Redux store `state.Users` map, which caches user names by UID
  2. Fallback: "Unknown" if UID can't be resolved (user not in cache)

### Chat Name Resolution

- `peer.type === 1` (user): resolved from user cache
- `peer.type === 2` (group): resolved from group cache
- `peer.type === 3` (channel): resolved from channel cache
- Fallback: "Unknown Chat"

## Error Handling

### Proto Schema Changes

If Bale updates their proto schemas (changing field numbers or adding required fields), decoding may fail. The decoder:
- Catches decode errors per-frame
- Logs a warning with the error and raw bytes length
- Continues processing subsequent frames
- A health check warns if no frames decode successfully for 30 minutes

### Missing Data

- Unknown senderUid -> "Unknown"
- Empty message content -> "[Message]"
- Unresolvable peer -> "Unknown Chat"

### WebSocket Disconnections

Bale's own reconnection logic handles this. The WebSocket hook persists across reconnects because the global constructor replacement is permanent for the page lifetime.

### Browser Crashes

Handled by existing Puppeteer lifecycle management in `src/engine/browser.ts`. Session persistence via user data directory.

## Call Detection

For the initial implementation, call detection remains DOM-based (`.ReactModal__Overlay` with "Answer"/"Decline"). The call notification proto type is not yet identified from the JS bundle analysis. This can be migrated to protobuf decoding in a follow-up.

## File Changes

### New Files

- `src/engine/protobuf/schemas.ts` — Proto schema definitions using @bufbuild/protobuf (ServerEnvelope, Update, Dialog, Message, MessageContent, Peer, TextMessage)
- `src/engine/protobuf/index.ts` — Re-exports
- `src/engine/ws-hook.ts` — WebSocket override script (injected via page.evaluateOnNewDocument)
- `src/engine/decoder.ts` — Binary frame -> BaleEvent decoder with dedup and filtering

### Modified Files

- `src/engine/monitor.ts` — Replace DOM monitoring setup with WS hook injection + decoder
- `src/engine/event-parser.ts` — Simplified for protobuf objects instead of DomNotification
- `src/types.ts` — Remove DomNotification type (no longer needed)

### Removed Files

- `src/engine/ws-interceptor.ts` — Old DOM MutationObserver code

### Unchanged Files

- `src/channels/` — All notification channels
- `src/setup/` — Setup wizard
- `src/config.ts` — Config management
- `src/engine/browser.ts` — Puppeteer lifecycle

### New Dependency

- `@bufbuild/protobuf` — BufBuild's protobuf runtime for TypeScript (same library Bale's web app uses)

## Testing Strategy

- **Unit tests**: Proto decoding with synthetic binary fixtures (encode known messages, verify decode)
- **Integration tests**: WebSocket hook injection in real browser context via Puppeteer
- **Dedup tests**: Verify rid-based dedup prevents duplicate notifications
- **Filter tests**: Verify typing indicators, pings, and responses are filtered out
- Existing channel tests remain unchanged (they test the notification pipeline independently)
