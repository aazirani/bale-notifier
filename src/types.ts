// --- Bale Event Types ---

export type BaleEventType = "message" | "call" | "group_notification" | "relogin";

export interface BaleEvent {
  type: BaleEventType;
  timestamp: Date;
  source: string;
  preview?: string;
  chatUrl?: string;
  callType?: "voice" | "video";
}

// --- Channel Types ---

export interface NotificationChannel {
  send(event: BaleEvent): Promise<void>;
  validateConfig(): Promise<boolean>;
}

export type ChannelType = "telegram" | "discord" | "slack";

export interface TelegramConfig {
  botToken: string;
  chatId: number;
}

export interface DiscordConfig {
  webhookUrl: string;
}

export interface SlackConfig {
  webhookUrl: string;
}

// --- App Config ---

export interface NotificationPreferences {
  messages: boolean;
  calls: boolean;
  groups: boolean;
}

export interface AppConfig {
  bale: {
    sessionDir: string;
    noVncUrl: string;
  };
  channel: {
    type: ChannelType;
    telegram?: TelegramConfig;
    discord?: DiscordConfig;
    slack?: SlackConfig;
  };
  notifications: NotificationPreferences;
}

// --- Decoded Message Types (from protobuf) ---

export interface DecodedMessage {
  senderUid: bigint;
  peerType: number;
  peerId: bigint;
  rid: bigint;
  date: bigint;
  preview: string;
  messageType: "text" | "document" | "sticker" | "animated_sticker" | "poll" | "deleted" | "empty" | "unknown";
}

// --- Multi-Tenant Types ---

export interface MasterConfig {
  serverIp: string;
  novncPortRange: [number, number];
  loginTimeoutMinutes: number;
  logLevel?: string;
}

export type UserStatus = "starting" | "running" | "reconnecting" | "needs-login" | "stopped";

export interface UserState {
  userId: string;
  status: UserStatus;
  lastPing?: string;
  lastReconnect?: string;
}
