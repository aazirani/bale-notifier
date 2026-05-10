import { schemas } from "./protobuf/index.js";
import type { DecodedMessage } from "../types.js";
import { DEDUP_BUFFER_SIZE, PREVIEW_MAX_LENGTH } from "../constants.js";
import { logger } from "../logger.js";
import type { Long } from "protobufjs";

type MessageType = DecodedMessage["messageType"];

interface ContentResult {
  messageType: MessageType;
  preview: string;
  skip: boolean;
}

// Convert protobufjs values to native BigInt
function toBigInt(value: any): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  // protobufjs Long object - use toBigInt() if available
  if (typeof value === "object" && typeof value.toBigInt === "function") {
    return value.toBigInt();
  }
  // Fallback for Long objects without toBigInt
  if (typeof value === "object" && "low" in value && "high" in value) {
    return (BigInt(value.high) << 32n) | BigInt(value.low >>> 0);
  }
  return 0n;
}

function classifyContent(rawMessage: Uint8Array): ContentResult {
  try {
    // If the message bytes are empty, return unknown
    if (!rawMessage || rawMessage.length === 0) {
      return { messageType: "unknown", preview: "[Message]", skip: false };
    }

    const content: any = schemas.MessageContent.decode(rawMessage);

    // Check text messages first (they have actual text content)
    if (content.textMessage && content.textMessage.text) {
      const text: string = content.textMessage.text;
      return {
        messageType: "text",
        preview: text.length > PREVIEW_MAX_LENGTH ? text.slice(0, PREVIEW_MAX_LENGTH) : text,
        skip: false,
      };
    }

    if (content.longTextMessage && content.longTextMessage.text) {
      const text: string = content.longTextMessage.text;
      return {
        messageType: "long_text",
        preview: text.length > PREVIEW_MAX_LENGTH ? text.slice(0, PREVIEW_MAX_LENGTH) : text,
        skip: false,
      };
    }

    // For bytes fields, check if they have actual data (non-empty arrays)
    // Priority order: deleted/empty should be checked before document
    if (content.deletedMessage && content.deletedMessage.length > 0) {
      return { messageType: "deleted", preview: "", skip: true };
    }

    if (content.emptyMessage && content.emptyMessage.length > 0) {
      return { messageType: "empty", preview: "", skip: true };
    }

    if (content.documentMessage && content.documentMessage.length > 0) {
      return { messageType: "document", preview: "[File]", skip: false };
    }

    if (content.stickerMessage && content.stickerMessage.length > 0) {
      return { messageType: "sticker", preview: "[Sticker]", skip: false };
    }

    if (content.animatedStickerMessage && content.animatedStickerMessage.length > 0) {
      return { messageType: "animated_sticker", preview: "[Sticker]", skip: false };
    }

    if (content.pollMessage && content.pollMessage.length > 0) {
      return { messageType: "poll", preview: "[Poll]", skip: false };
    }

    return { messageType: "unknown", preview: "[Message]", skip: false };
  } catch {
    return { messageType: "unknown", preview: "[Message]", skip: false };
  }
}

export class FrameDecoder {
  private ridBuffer: bigint[] = [];

  decode(rawBytes: Uint8Array): DecodedMessage | null {
    try {
      const envelope: any = schemas.ServerEnvelope.decode(rawBytes);

      if (!envelope.update) return null;

      let dialog: any;
      try {
        dialog = schemas.Dialog.decode(envelope.update.update);
      } catch {
        return null;
      }

      if (!dialog.unreadCount || dialog.unreadCount <= 0) return null;

      const rid = toBigInt(dialog.rid);
      if (rid === 0n) return null;
      if (this.ridBuffer.includes(rid)) return null;
      this.ridBuffer.push(rid);
      if (this.ridBuffer.length > DEDUP_BUFFER_SIZE) {
        this.ridBuffer.shift();
      }

      const senderUid = toBigInt(dialog.senderUid);
      const peerId = dialog.peer ? toBigInt(dialog.peer.id) : 0n;
      const peerType = dialog.peer?.type ?? 0;
      const date = toBigInt(dialog.date);

      if (!dialog.message) {
        return {
          senderUid,
          peerType,
          peerId,
          rid,
          date,
          unreadCount: dialog.unreadCount,
          preview: "[Message]",
          messageType: "unknown",
        };
      }

      const content = classifyContent(dialog.message);
      if (content.skip) return null;

      return {
        senderUid,
        peerType,
        peerId,
        rid,
        date,
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
