import type { InstanceChannelType } from "./instanceChannels";
import { INSTANCE_CHANNEL_META, PUB_URL_KEYS } from "./instanceChannels";

export const CHANNEL_STATUS_OPTIONS = [
  { value: "", label: "Unknown" },
  { value: "ok", label: "OK / connected" },
  { value: "configured", label: "Configured" },
  { value: "pending", label: "Pending setup" },
  { value: "degraded", label: "Degraded" },
  { value: "error", label: "Error" },
  { value: "disabled", label: "Disabled" },
] as const;

export type ChannelFieldType =
  | "text"
  | "email"
  | "tel"
  | "url"
  | "password"
  | "number"
  | "textarea"
  | "select"
  | "checkbox"
  | "phone_number"
  | "email_list"
  | "phone_number_list";

export type ChannelFieldDef = {
  key: string;
  label: string;
  type: ChannelFieldType;
  placeholder?: string;
  hint?: string;
  required?: boolean;
  advanced?: boolean;
  options?: { value: string; label: string }[];
};

export const CHANNEL_FIELD_SCHEMAS: Record<InstanceChannelType, ChannelFieldDef[]> = {
  signal: [
    { key: "phone_number_id", label: "Fleet number", type: "phone_number", hint: "Assign a line from Phone numbers" },
    { key: "phone", label: "Signal number (E.164)", type: "tel", placeholder: "+49…" },
    { key: "device", label: "Linked device name", type: "text", placeholder: "signal-cli device" },
    { key: "notes", label: "Notes", type: "textarea", advanced: true },
  ],
  slack: [
    { key: "webhook_url", label: "Incoming webhook URL", type: "url", placeholder: "https://hooks.slack.com/…" },
    { key: "channel", label: "Default channel", type: "text", placeholder: "#general" },
    { key: "team", label: "Workspace / team", type: "text" },
    { key: "bot_token", label: "Bot token", type: "password", advanced: true },
  ],
  telegram: [
    { key: "bot_username", label: "Bot username", type: "text", placeholder: "@MyBot" },
    { key: "bot_token", label: "Bot token", type: "password" },
    { key: "chat_id", label: "Default chat ID", type: "text" },
    {
      key: "allow_from",
      label: "Allowed senders (comma-separated IDs)",
      type: "textarea",
      advanced: true,
    },
  ],
  twilio_voice: [
    { key: "phone_numbers", label: "Voice numbers (E.164)", type: "phone_number_list" },
    {
      key: "phone_number_id",
      label: "Primary fleet number",
      type: "phone_number",
      hint: "Optional — links first list entry to a fleet line",
    },
    { key: "account_sid", label: "Account SID", type: "text", advanced: true },
    { key: "voice_webhook_url", label: "Voice webhook URL", type: "url", advanced: true },
  ],
  twilio_sms: [
    { key: "phone_numbers", label: "SMS numbers (E.164)", type: "phone_number_list" },
    {
      key: "phone_number_id",
      label: "Primary fleet number",
      type: "phone_number",
      hint: "Optional — links first list entry to a fleet line",
    },
    { key: "messaging_service_sid", label: "Messaging service SID", type: "text", advanced: true },
  ],
  whatsapp: [
    { key: "phone_number_id", label: "Fleet number", type: "phone_number" },
    { key: "phone", label: "WhatsApp number", type: "tel", placeholder: "+49…" },
    { key: "business_account_id", label: "Business account ID", type: "text", advanced: true },
  ],
  email: [
    { key: "addresses", label: "Email addresses", type: "email_list" },
    { key: "from", label: "From / display name", type: "text", placeholder: "Agent <agent@example.com>" },
    { key: "imap_host", label: "IMAP host", type: "text", placeholder: "imap.example.com" },
    { key: "imap_port", label: "IMAP port", type: "number", placeholder: "993" },
    { key: "smtp_host", label: "SMTP host", type: "text", placeholder: "smtp.example.com" },
    { key: "smtp_port", label: "SMTP port", type: "number", placeholder: "587" },
    { key: "username", label: "Mailbox username", type: "text" },
    { key: "password", label: "Mailbox password", type: "password" },
  ],
  nextcloud: [
    { key: "url", label: "Server URL", type: "url", required: true },
    { key: "user", label: "Username", type: "text", required: true },
    { key: "appPassword", label: "App password", type: "password", required: true },
    { key: "basePath", label: "WebDAV base path", type: "text", placeholder: "/remote.php/dav/files/user/" },
    { key: "chunkSizeMB", label: "Chunk size (MB)", type: "number", advanced: true },
  ],
  gitlab: [
    { key: "url", label: "GitLab URL", type: "url", required: true, placeholder: "https://gitlab.example.com" },
    { key: "project", label: "Project path", type: "text", placeholder: "group/project" },
    { key: "token", label: "Access token", type: "password", required: true },
    {
      key: "api_version",
      label: "API version",
      type: "select",
      options: [
        { value: "v4", label: "v4 (default)" },
        { value: "v3", label: "v3" },
      ],
      advanced: true,
    },
  ],
  anx_employee: [
    { key: "defaultEmployee", label: "Default employee slug", type: "text" },
    { key: "openApiUrl", label: "OpenAPI doc URL", type: "url" },
    { key: "baseUrl", label: "Region base URL", type: "url", required: true },
    { key: "aiEmployeeId", label: "AI employee document ID", type: "text", required: true },
    { key: "bridgeToken", label: "Bridge token", type: "password", required: true },
    { key: "employee_slug", label: "Legacy employee slug", type: "text", advanced: true },
  ],
  pub_urls: [
    { key: "public_url", label: "Public profile URL", type: "url" },
    { key: "profile_url", label: "Profile page URL", type: "url" },
    { key: "docs_url", label: "Docs / landing URL", type: "url" },
    { key: "gateway_public", label: "Public gateway URL", type: "url", advanced: true },
  ],
  instagram: [
    { key: "handle", label: "Handle", type: "text", placeholder: "@brand" },
    { key: "username", label: "Username", type: "text" },
    { key: "account_id", label: "Account ID", type: "text", advanced: true },
    { key: "url", label: "Profile URL", type: "url" },
  ],
  youtube: [
    { key: "handle", label: "Handle", type: "text", placeholder: "@channel" },
    { key: "channel_id", label: "Channel ID", type: "text" },
    { key: "url", label: "Channel URL", type: "url" },
  ],
};

export function channelTypeLabel(type: string): string {
  return INSTANCE_CHANNEL_META[type as InstanceChannelType]?.label ?? type;
}

export function channelTypeIcon(type: string): string {
  return INSTANCE_CHANNEL_META[type as InstanceChannelType]?.icon ?? "📡";
}

export { PUB_URL_KEYS };
