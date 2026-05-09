import type { AppConfig, NotificationChannel } from "../types.js";
import { TelegramChannel } from "./telegram.js";
import { DiscordChannel } from "./discord.js";
import { SlackChannel } from "./slack.js";

export function createChannel(config: AppConfig): NotificationChannel {
  switch (config.channel.type) {
    case "telegram":
      if (!config.channel.telegram) throw new Error("Telegram config missing");
      return new TelegramChannel(config.channel.telegram);

    case "discord":
      if (!config.channel.discord) throw new Error("Discord config missing");
      return new DiscordChannel(config.channel.discord);

    case "slack":
      if (!config.channel.slack) throw new Error("Slack config missing");
      return new SlackChannel(config.channel.slack);

    default:
      throw new Error(`Unknown channel type: ${config.channel.type}`);
  }
}