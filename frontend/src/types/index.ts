import type { InstanceTls } from "./tls.ts";
import type { InstanceEndpoints } from "../lib/instanceEndpoints.ts";

export type DbInstance = {
  id: string;
  slug: string;
  tenantId?: string;
  primaryTeamId?: string | null;
  identity: Record<string, unknown>;
  ports: Record<string, unknown>;
  host: string | null;
  urls: Record<string, string>;
  channels: Record<string, unknown>;
  tls?: InstanceTls | Record<string, unknown>;
  endpoints?: InstanceEndpoints;
  health: {
    status?: string;
    consecutive_failures?: number;
    tls_warning?: string | null;
    http_warning?: string | null;
    used_fallback?: boolean;
    active_url?: string | null;
    response_time_ms?: number | null;
    last_ping?: string | null;
    last_error?: string | null;
  };
  status: string | null;
  lastSeen: string | null;
  registeredAt?: string | null;
  /** Present when API redacts gateway_token_encrypted */
  has_gateway_token?: boolean;
};

export type Team = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  color: string | null;
  members: TeamMember[];
};

export type TeamMember = {
  id: string;
  memberType: string;
  instanceId: string;
  agentProfileId: string | null;
  roleInTeam: string | null;
};

export type Contact = {
  id: string;
  slug: string;
  displayName: string;
  contactKind: string;
  notes: string | null;
  tags: string[] | null;
  isExternal: boolean;
  allowContact: boolean;
  status: string;
  linkedInstanceId: string | null;
};

export type ContactChannel = {
  id: string;
  channelType: string;
  address: string;
  label: string | null;
  priority: number | null;
  inboundOk: boolean;
  outboundOk: boolean;
  isPrimary: boolean;
};

export type PhoneNumber = {
  id: string;
  number: string;
  label: string | null;
  numberType: "virtual_twilio" | "esim" | "physical_sim" | string;
  inboundEnabled: boolean | null;
  outboundEnabled: boolean | null;
  voiceEnabled: boolean | null;
  smsEnabled: boolean | null;
  whatsappEnabled: boolean | null;
  assignedInstanceId?: string | null;
  twilioSid?: string | null;
};

export type Device = {
  id: string;
  name: string;
  deviceType: "smartphone" | "esim_device" | "signal_device" | "softphone" | string;
  serialOrImei: string | null;
  notes: string | null;
  createdAt: string;
};

export type AgentProfile = {
  id: string;
  instanceId: string;
  agentId: string;
  displayName: string | null;
  roleDescription: string | null;
  publicBio: string | null;
  internalNotes: string | null;
  isPublic: boolean;
  instance_slug?: string;
  runtime?: string;
};

export type HealthLog = {
  id: string;
  status: string;
  responseTimeMs: number | null;
  error: string | null;
  ts: string;
};

export type FleetEvent = {
  id: string;
  eventType: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export type InstanceChannelConfig = {
  id: string;
  channelType: string;
  enabled: boolean;
  config: Record<string, unknown>;
  status: string | null;
};

export type ProfileImageGroupSettings = {
  auto_rotate: boolean;
  rotate_interval_sec: number | null;
};

export type ProfileImageSettings = {
  public: ProfileImageGroupSettings;
  internal: ProfileImageGroupSettings;
};

export type InstanceImageMeta = {
  id: string;
  imageType: "public" | "internal" | string;
  mimeType: string;
  label: string | null;
  probability: number | null;
  sortOrder: number | null;
  isPrimary?: boolean | null;
  uploadedAt?: string;
};
