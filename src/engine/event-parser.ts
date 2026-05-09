import type { BaleEvent, DomNotification } from "../types.js";

export function parseDomNotification(notification: DomNotification): BaleEvent | null {
  switch (notification.type) {
    case "incoming_call":
      return {
        type: "call",
        timestamp: new Date(),
        sender: notification.callerName,
        chatName: notification.callerName ?? "Unknown",
      };

    case "unread_badge_change":
      return {
        type: "message",
        timestamp: new Date(),
        sender: notification.chatName ?? "Unknown",
        chatName: notification.chatName ?? "Unknown",
        preview: notification.messagePreview ?? undefined,
        chatUrl: notification.chatUrl ?? undefined,
      };

    default:
      return null;
  }
}
