import type { BaleEvent, NotificationChannel, SlackConfig } from "../types.js";

function formatEvent(event: BaleEvent): string {
  switch (event.type) {
    case "message":
      return [
        "*New Bale Message*",
        `From: ${event.sender ?? "Unknown"}`,
        `Chat: ${event.chatName}`,
        event.preview ? `Preview: ${event.preview}` : "",
      ].filter(Boolean).join("\n");

    case "call":
      return [
        `*${event.callType === "video" ? "Video" : "Voice"} Call from Bale*`,
        `From: ${event.sender ?? "Unknown"}`,
        `Chat: ${event.chatName}`,
      ].join("\n");

    case "group_notification":
      return [
        "*Bale Group Notification*",
        `Group: ${event.chatName}`,
        event.preview ?? "New activity",
      ].join("\n");
  }
}

export class SlackChannel implements NotificationChannel {
  constructor(private config: SlackConfig) {}

  async send(event: BaleEvent): Promise<void> {
    const text = formatEvent(event);
    const res = await fetch(this.config.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
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