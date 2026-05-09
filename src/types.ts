// --- Bale Event Types ---

export type BaleEventType = "message" | "call" | "group_notification";

export interface BaleEvent {
  type: BaleEventType;
  timestamp: Date;
  sender?: string;
  chatName: string;
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
  };
  channel: {
    type: ChannelType;
    telegram?: TelegramConfig;
    discord?: DiscordConfig;
    slack?: SlackConfig;
  };
  notifications: NotificationPreferences;
}

// --- DOM Notification Types ---

export type DomNotificationType = "incoming_call" | "new_message" | "unread_badge_change";

export interface DomNotification {
  type: DomNotificationType;
  callerName?: string;
  chatName?: string;
  messagePreview?: string;
  chatUrl?: string;
  unreadCount?: number;
  rawText?: string;
}