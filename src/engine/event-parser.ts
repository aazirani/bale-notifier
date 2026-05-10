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
