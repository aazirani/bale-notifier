import type { BaleEvent, DecodedMessage } from "../types.js";

function sourceLabel(peerType: number): string {
  if (peerType === 1) return "Private Chat";
  if (peerType === 2) return "Group";
  return "Channel";
}

export function parseDecodedMessage(msg: DecodedMessage): BaleEvent {
  return {
    type: "message",
    timestamp: new Date(Number(msg.date)),
    source: sourceLabel(msg.peerType),
    preview: msg.preview || undefined,
    chatUrl: `https://web.bale.ai/contacts?uid=${msg.peerId}`,
  };
}
