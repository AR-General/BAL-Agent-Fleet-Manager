export const INSTANCE_CHANNEL_TYPES = [
  "signal",
  "slack",
  "telegram",
  "twilio_voice",
  "twilio_sms",
  "whatsapp",
  "email",
  "nextcloud",
  "gitlab",
  "anx_employee",
  "pub_urls",
  "instagram",
  "youtube",
] as const;

export type InstanceChannelType = (typeof INSTANCE_CHANNEL_TYPES)[number];

export type InstanceChannelMeta = {
  label: string;
  icon: string;
  summaryKeys: string[];
};

export const INSTANCE_CHANNEL_META: Record<InstanceChannelType, InstanceChannelMeta> = {
  signal: { label: "Signal", icon: "💬", summaryKeys: ["phone", "number", "device"] },
  slack: { label: "Slack", icon: "💼", summaryKeys: ["webhook_url", "channel", "team"] },
  telegram: { label: "Telegram", icon: "✈️", summaryKeys: ["bot_username", "chat_id", "bot_token"] },
  twilio_voice: { label: "Twilio voice", icon: "📞", summaryKeys: ["phone_numbers", "phone_number", "number"] },
  twilio_sms: { label: "Twilio SMS", icon: "📱", summaryKeys: ["phone_numbers", "phone_number", "number"] },
  whatsapp: { label: "WhatsApp", icon: "🟢", summaryKeys: ["phone", "phone_number", "number"] },
  email: { label: "Email", icon: "✉️", summaryKeys: ["addresses", "address", "from", "imap_host"] },
  nextcloud: { label: "Nextcloud", icon: "☁️", summaryKeys: ["url", "user", "basePath"] },
  gitlab: { label: "GitLab", icon: "🦊", summaryKeys: ["url", "project", "token_prefix"] },
  anx_employee: {
    label: "ANX employee",
    icon: "🤖",
    summaryKeys: ["baseUrl", "aiEmployeeId", "defaultEmployee", "employee_slug"],
  },
  pub_urls: {
    label: "Public URLs",
    icon: "🔗",
    summaryKeys: ["public_url", "profile_url", "gateway_public"],
  },
  instagram: { label: "Instagram", icon: "📷", summaryKeys: ["handle", "username", "url"] },
  youtube: { label: "YouTube", icon: "▶️", summaryKeys: ["channel_id", "handle", "url"] },
};

export const PUB_URL_KEYS = [
  "gateway_intranet",
  "control_ui",
  "bridge_api",
  "signal_rest",
  "twilio_bridge",
] as const;
