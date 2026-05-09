import protobuf from "protobufjs";

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
  .add(new protobuf.Field("message", 7, "bytes"))  // Changed from MessageContent to bytes
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
