import TelegramBot from "node-telegram-bot-api";
import type { BaleEvent, NotificationChannel, TelegramConfig } from "../types.js";

function formatEvent(event: BaleEvent): { text: string; link?: string } {
  switch (event.type) {
    case "message":
      return {
        text: [
          `New Bale Message in ${event.source}`,
          event.preview ? event.preview : "",
        ].filter(Boolean).join("\n"),
        link: event.chatUrl,
      };

    case "call":
      return {
        text: `${event.callType === "video" ? "Video" : "Voice"} ${event.source}`,
      };

    case "group_notification":
      return {
        text: [
          `Bale Group Notification`,
          event.preview ?? "New activity",
        ].join("\n"),
        link: event.chatUrl,
      };

    default:
      return { text: event.preview ?? event.source };
  }
}

export class TelegramChannel implements NotificationChannel {
  private bot: TelegramBot;
  private chatId: number;

  constructor(private config: TelegramConfig) {
    this.bot = new TelegramBot(config.botToken, { polling: false });
    this.chatId = config.chatId;
  }

  async send(event: BaleEvent): Promise<void> {
    const { text, link } = formatEvent(event);
    const fullText = link ? `${text}\n${link}` : text;
    await this.bot.sendMessage(this.chatId, fullText, {
      disable_web_page_preview: true,
    });
  }

  async validateConfig(): Promise<boolean> {
    try {
      await this.bot.getMe();
      return true;
    } catch {
      return false;
    }
  }
}
