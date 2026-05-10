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

function toBigInt(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(value);
  if (typeof value === "string") return BigInt(value);
  if (typeof value === "object" && typeof (value as any).toBigInt === "function") {
    return (value as any).toBigInt();
  }
  if (typeof value === "object" && "low" in (value as any) && "high" in (value as any)) {
    const v = value as { low: number; high: number };
    return (BigInt(v.high) << 32n) | BigInt(v.low >>> 0);
  }
  return 0n;
}

function classifyContent(rawMessage: Uint8Array): ContentResult {
  try {
    if (!rawMessage || rawMessage.length === 0) {
      return { messageType: "unknown", preview: "[Message]", skip: false };
    }

    const content: any = schemas.MessageContent.decode(rawMessage);

    if (content.textMessage && content.textMessage.text) {
      const text: string = content.textMessage.text;
      return {
        messageType: "text",
        preview: text.length > PREVIEW_MAX_LENGTH ? text.slice(0, PREVIEW_MAX_LENGTH) : text,
        skip: false,
      };
    }

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

      // Decode the update bytes — two-layer wrapper:
      // UpdatePayload (field 1 = content bytes) → NewMessageUpdate (field 55 = newMessage bytes)
      const updatePayload = new Uint8Array(envelope.update.update);
      let payload: any;
      try {
        payload = schemas.UpdatePayload.decode(updatePayload);
      } catch {
        return null;
      }

      if (!payload.content) return null;

      let updateContent: any;
      try {
        updateContent = schemas.NewMessageUpdate.decode(new Uint8Array(payload.content));
      } catch {
        return null;
      }

      const newMsgBytes = updateContent?.newMessage;
      if (!newMsgBytes) return null;

      // Decode the newMessage bytes as NewMessage type
      let msg: any;
      try {
        const bytes = newMsgBytes instanceof Uint8Array ? newMsgBytes : new Uint8Array(newMsgBytes);
        msg = schemas.NewMessage.decode(bytes);
      } catch {
        return null;
      }

      // Extract message ID and deduplicate
      const rid = toBigInt(msg.rid);
      if (rid === 0n) return null;
      if (this.ridBuffer.includes(rid)) return null;
      this.ridBuffer.push(rid);
      if (this.ridBuffer.length > DEDUP_BUFFER_SIZE) {
        this.ridBuffer.shift();
      }

      // Extract sender info
      const senderUid = toBigInt(msg.from?.id ?? msg.senderUid);
      const peerType = msg.from?.type ?? msg.to?.type ?? 0;
      const peerId = toBigInt(msg.to?.id ?? msg.from?.id ?? 0);
      const date = toBigInt(msg.date);

      // Decode message content
      if (!msg.message) {
        return {
          senderUid,
          peerType,
          peerId,
          rid,
          date,
          preview: "[Message]",
          messageType: "unknown",
        };
      }

      // msg.message is a decoded MessageContent or raw bytes
      const messageData = msg.message instanceof Uint8Array ? msg.message : new Uint8Array(msg.message);
      const content = classifyContent(messageData);
      if (content.skip) return null;

      return {
        senderUid,
        peerType,
        peerId,
        rid,
        date,
        preview: content.preview,
        messageType: content.messageType,
      };
    } catch (err) {
      logger.debug("Failed to decode frame:", err);
      return null;
    }
  }
}
