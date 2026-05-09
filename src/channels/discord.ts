import type { BaleEvent, NotificationChannel, DiscordConfig } from "../types.js";

function buildEmbed(event: BaleEvent) {
  const fields: { name: string; value: string; inline?: boolean }[] = [];

  switch (event.type) {
    case "message":
      if (event.sender) fields.push({ name: "From", value: event.sender, inline: true });
      fields.push({ name: "Chat", value: event.chatName, inline: true });
      if (event.preview) fields.push({ name: "Preview", value: event.preview });
      return { title: "New Bale Message", color: 0x229ed9, fields };

    case "call":
      if (event.sender) fields.push({ name: "From", value: event.sender, inline: true });
      fields.push({ name: "Chat", value: event.chatName, inline: true });
      return {
        title: `${event.callType === "video" ? "Video" : "Voice"} Call from Bale`,
        color: 0xff0000,
        fields,
      };

    case "group_notification":
      fields.push({ name: "Group", value: event.chatName, inline: true });
      if (event.preview) fields.push({ name: "Details", value: event.preview });
      return { title: "Bale Group Notification", color: 0x229ed9, fields };
  }
}

export class DiscordChannel implements NotificationChannel {
  constructor(private config: DiscordConfig) {}

  async send(event: BaleEvent): Promise<void> {
    const embed = buildEmbed(event);
    const res = await fetch(this.config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed] }),
    });
    if (!res.ok) {
      throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`);
    }
  }

  async validateConfig(): Promise<boolean> {
    try {
      const res = await fetch(this.config.webhookUrl, { method: "HEAD" });
      return res.ok || res.status === 400;
    } catch {
      return false;
    }
  }
}