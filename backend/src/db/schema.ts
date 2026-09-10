import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
  toDriver(value: Buffer) {
    return value;
  },
  fromDriver(value: unknown): Buffer {
    if (Buffer.isBuffer(value)) return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    const s = String(value);
    if (s.startsWith("\\x")) return Buffer.from(s.slice(2), "hex");
    if (/^[A-Za-z0-9+/=]+$/.test(s) && s.length > 64) {
      return Buffer.from(s, "base64");
    }
    return Buffer.from(s, "hex");
  },
});

export const userRoleEnum = pgEnum("user_role", ["admin", "operator", "viewer"]);
export const contactKindEnum = pgEnum("contact_kind", ["human", "ai_agent"]);
export const channelTypeEnum = pgEnum("channel_type", [
  "phone",
  "signal",
  "sms",
  "whatsapp",
  "email",
  "slack",
  "twilio_voice",
  "webchat",
  "other",
]);
export const phoneNumberTypeEnum = pgEnum("phone_number_type", [
  "virtual_twilio",
  "esim",
  "physical_sim",
]);
export const deviceTypeEnum = pgEnum("device_type", [
  "smartphone",
  "esim_device",
  "signal_device",
  "softphone",
]);
export const instanceChannelTypeEnum = pgEnum("instance_channel_type", [
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
]);
export const teamMemberTypeEnum = pgEnum("team_member_type", ["instance", "agent"]);
export const chatSessionTypeEnum = pgEnum("chat_session_type", ["direct", "group"]);
export const chatSessionStatusEnum = pgEnum("chat_session_status", ["active", "archived"]);
export const chatSessionOriginEnum = pgEnum("chat_session_origin", [
  "human",
  "agent_dm",
  "named_channel",
  "event_mention",
]);
export const chatReplyPolicyEnum = pgEnum("chat_reply_policy", [
  "human_only",
  "mentioned_only",
  "off",
]);
export const chatReactionKindEnum = pgEnum("chat_reaction_kind", [
  "acknowledged",
  "ignoring",
  "responding",
]);
export const messageRoleEnum = pgEnum("message_role", ["user", "assistant", "system", "tool"]);
export const authorTypeEnum = pgEnum("author_type", ["user", "instance", "contact", "system"]);
export const participantTypeEnum = pgEnum("participant_type", ["user", "instance", "contact"]);
export const fleetMessageStatusEnum = pgEnum("fleet_message_status", [
  "pending",
  "delivered",
  "read",
]);
export const agentImageTypeEnum = pgEnum("agent_image_type", ["public", "internal"]);
export const contactStatusEnum = pgEnum("contact_status", ["active", "archived"]);

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    phone: text("phone"),
    passwordHash: text("password_hash").notNull(),
    totpSecret: text("totp_secret"),
    role: userRoleEnum("role").notNull().default("operator"),
    displayName: text("display_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    lastLogin: timestamp("last_login", { withTimezone: true }),
  },
  (t) => [uniqueIndex("users_tenant_email").on(t.tenantId, t.email)],
);

export const refreshTokens = pgTable("refresh_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teams = pgTable(
  "teams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    color: text("color"),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("teams_tenant_slug").on(t.tenantId, t.slug)],
);

export const instances = pgTable(
  "instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    primaryTeamId: uuid("primary_team_id").references(() => teams.id, { onDelete: "set null" }),
    identity: jsonb("identity").$type<Record<string, unknown>>().default({}),
    ports: jsonb("ports").$type<Record<string, unknown>>().default({}),
    host: text("host"),
    urls: jsonb("urls").$type<Record<string, string>>().default({}),
    channels: jsonb("channels").$type<Record<string, unknown>>().default({}),
    tls: jsonb("tls").$type<Record<string, unknown>>().default({}),
    health: jsonb("health").$type<Record<string, unknown>>().default({
      status: "unknown",
      consecutive_failures: 0,
    }),
    status: text("status").default("registered"),
    gatewayTokenEncrypted: text("gateway_token_encrypted"),
    registeredAt: timestamp("registered_at", { withTimezone: true }).defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }),
  },
  (t) => [uniqueIndex("instances_tenant_slug").on(t.tenantId, t.slug)],
);

export const instanceApiTokens = pgTable("instance_api_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  instanceId: uuid("instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  tokenPrefix: text("token_prefix").notNull(),
  tokenHash: text("token_hash").notNull(),
  scopes: text("scopes").array().notNull().default([]),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const agentProfiles = pgTable(
  "agent_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    agentId: text("agent_id").notNull(),
    displayName: text("display_name"),
    roleDescription: text("role_description"),
    publicBio: text("public_bio"),
    internalNotes: text("internal_notes"),
    isPublic: boolean("is_public").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("agent_profiles_instance_agent").on(t.instanceId, t.agentId)],
);

export const agentImages = pgTable("agent_images", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentProfileId: uuid("agent_profile_id")
    .notNull()
    .references(() => agentProfiles.id, { onDelete: "cascade" }),
  imageType: agentImageTypeEnum("image_type").notNull(),
  imageData: bytea("image_data").notNull(),
  mimeType: text("mime_type").notNull(),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
});

export const instanceImages = pgTable(
  "instance_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    imageType: agentImageTypeEnum("image_type").notNull(),
    imageData: bytea("image_data").notNull(),
    mimeType: text("mime_type").notNull(),
    label: text("label"),
    probability: integer("probability"),
    sortOrder: integer("sort_order").default(0),
    isPrimary: boolean("is_primary").notNull().default(false),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("instance_images_instance_id_idx").on(t.instanceId)],
);

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    contactKind: contactKindEnum("contact_kind").notNull(),
    notes: text("notes"),
    tags: text("tags").array().default([]),
    isExternal: boolean("is_external").default(false),
    allowContact: boolean("allow_contact").default(true),
    linkedUserId: uuid("linked_user_id").references(() => users.id, { onDelete: "set null" }),
    linkedInstanceId: uuid("linked_instance_id").references(() => instances.id, {
      onDelete: "set null",
    }),
    linkedAgentProfileId: uuid("linked_agent_profile_id").references(() => agentProfiles.id, {
      onDelete: "set null",
    }),
    status: contactStatusEnum("status").default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("contacts_tenant_slug").on(t.tenantId, t.slug)],
);

export const contactChannels = pgTable("contact_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "cascade" }),
  channelType: channelTypeEnum("channel_type").notNull(),
  address: text("address").notNull(),
  label: text("label"),
  priority: integer("priority").default(0),
  inboundOk: boolean("inbound_ok").default(true),
  outboundOk: boolean("outbound_ok").default(true),
  isPrimary: boolean("is_primary").default(false),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
});

export const teamMembers = pgTable(
  "team_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    teamId: uuid("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    memberType: teamMemberTypeEnum("member_type").notNull(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    agentProfileId: uuid("agent_profile_id").references(() => agentProfiles.id, {
      onDelete: "cascade",
    }),
    roleInTeam: text("role_in_team"),
    sortOrder: integer("sort_order").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("team_members_unique").on(t.teamId, t.instanceId, t.agentProfileId),
  ],
);

export const phoneNumbers = pgTable("phone_numbers", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  number: text("number").notNull().unique(),
  label: text("label"),
  numberType: phoneNumberTypeEnum("number_type").notNull(),
  inboundEnabled: boolean("inbound_enabled").default(true),
  outboundEnabled: boolean("outbound_enabled").default(true),
  voiceEnabled: boolean("voice_enabled").default(false),
  smsEnabled: boolean("sms_enabled").default(false),
  whatsappEnabled: boolean("whatsapp_enabled").default(false),
  assignedInstanceId: uuid("assigned_instance_id").references(() => instances.id, {
    onDelete: "set null",
  }),
  assignedDeviceId: uuid("assigned_device_id"),
  twilioSid: text("twilio_sid"),
  providerMetadata: jsonb("provider_metadata").$type<Record<string, unknown>>().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  deviceType: deviceTypeEnum("device_type").notNull(),
  serialOrImei: text("serial_or_imei"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const devicePhoneNumbers = pgTable("device_phone_numbers", {
  deviceId: uuid("device_id")
    .notNull()
    .references(() => devices.id, { onDelete: "cascade" }),
  phoneNumberId: uuid("phone_number_id")
    .notNull()
    .references(() => phoneNumbers.id, { onDelete: "cascade" }),
  isPrimary: boolean("is_primary").default(false),
});

export const channelConfigs = pgTable("channel_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  instanceId: uuid("instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
  channelType: instanceChannelTypeEnum("channel_type").notNull(),
  enabled: boolean("enabled").default(false),
  config: jsonb("config").$type<Record<string, unknown>>().default({}),
  status: text("status"),
  lastVerified: timestamp("last_verified", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chatSessions = pgTable(
  "chat_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdByInstanceId: uuid("created_by_instance_id").references(() => instances.id, {
      onDelete: "set null",
    }),
    title: text("title"),
    slug: text("slug"),
    origin: chatSessionOriginEnum("origin").notNull().default("human"),
    replyPolicy: chatReplyPolicyEnum("reply_policy").notNull().default("human_only"),
    sessionType: chatSessionTypeEnum("session_type").notNull().default("direct"),
    targetInstanceIds: uuid("target_instance_ids").array(),
    primaryInstanceId: uuid("primary_instance_id").references(() => instances.id, {
      onDelete: "set null",
    }),
    maxAgentAutoTurns: integer("max_agent_auto_turns").notNull().default(5),
    maxToolCalls: integer("max_tool_calls").notNull().default(50),
    modelId: text("model_id"),
    thinkingEnabled: boolean("thinking_enabled").default(false),
    pinned: boolean("pinned").default(false),
    relatedEventId: uuid("related_event_id"),
    status: chatSessionStatusEnum("status").default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("chat_sessions_tenant_updated").on(t.tenantId, t.updatedAt),
    index("chat_sessions_tenant_origin").on(t.tenantId, t.origin),
  ],
);

export const chatSessionParticipants = pgTable("chat_session_participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  participantType: participantTypeEnum("participant_type").notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  instanceId: uuid("instance_id").references(() => instances.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  displayName: text("display_name"),
  paused: boolean("paused").notNull().default(false),
  modelId: text("model_id"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
});

export const chatMessages = pgTable(
  "chat_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => chatSessions.id, { onDelete: "cascade" }),
    role: messageRoleEnum("role").notNull(),
    authorType: authorTypeEnum("author_type").notNull().default("user"),
    authorUserId: uuid("author_user_id").references(() => users.id, { onDelete: "set null" }),
    authorInstanceId: uuid("author_instance_id").references(() => instances.id, {
      onDelete: "set null",
    }),
    authorContactId: uuid("author_contact_id").references(() => contacts.id, {
      onDelete: "set null",
    }),
    contentEncrypted: bytea("content_encrypted"),
    contentIv: bytea("content_iv"),
    contentSearchHash: text("content_search_hash"),
    toolCallId: text("tool_call_id"),
    toolName: text("tool_name"),
    toolResultEncrypted: bytea("tool_result_encrypted"),
    toolResultIv: bytea("tool_result_iv"),
    errorInfo: jsonb("error_info").$type<Record<string, unknown>>(),
    tokenUsage: jsonb("token_usage").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("chat_messages_session_created").on(t.sessionId, t.createdAt)],
);

export const chatMessageReactions = pgTable(
  "chat_message_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => chatMessages.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    kind: chatReactionKindEnum("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("chat_message_reactions_message_id_idx").on(t.messageId),
    uniqueIndex("chat_message_reactions_message_instance_unique").on(t.messageId, t.instanceId),
  ],
);

export const healthLog = pgTable(
  "health_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    responseTimeMs: integer("response_time_ms"),
    error: text("error"),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("health_log_instance_ts").on(t.instanceId, t.ts)],
);

export const fleetEvents = pgTable(
  "fleet_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    tags: text("tags").array().notNull().default([]),
    summaryEncrypted: bytea("summary_encrypted"),
    summaryIv: bytea("summary_iv"),
    dataEncrypted: bytea("data_encrypted"),
    dataIv: bytea("data_iv"),
    /** Legacy plaintext jsonb retained for migration compatibility. Prefer encrypted fields. */
    data: jsonb("data").$type<Record<string, unknown>>().default({}),
    mentionInstanceIds: uuid("mention_instance_ids").array().notNull().default([]),
    relatedSessionId: uuid("related_session_id").references(() => chatSessions.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("fleet_events_instance_created").on(t.instanceId, t.createdAt),
    index("fleet_events_tenant_created").on(t.tenantId, t.createdAt),
  ],
);

export const agentPresence = pgTable(
  "agent_presence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    instanceId: uuid("instance_id")
      .notNull()
      .references(() => instances.id, { onDelete: "cascade" })
      .unique(),
    agentProfileId: uuid("agent_profile_id").references(() => agentProfiles.id, {
      onDelete: "set null",
    }),
    vrmUrl: text("vrm_url"),
    gestureManifestUrl: text("gesture_manifest_url"),
    defaultMood: text("default_mood").default("neutral"),
    clothes: jsonb("clothes").$type<Record<string, unknown>>().default({}),
    fishVoiceId: text("fish_voice_id"),
    pointerLook: boolean("pointer_look").default(true),
    defaultModelId: text("default_model_id"),
    settings: jsonb("settings").$type<Record<string, unknown>>().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
);

export const eventTagCatalog = pgTable(
  "event_tag_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    description: text("description"),
    isStandard: boolean("is_standard").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("event_tag_catalog_tenant_tag").on(t.tenantId, t.tag)],
);

export const fleetMessages = pgTable("fleet_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  fromInstanceId: uuid("from_instance_id")
    .notNull()
    .references(() => instances.id, { onDelete: "cascade" }),
  toInstanceId: uuid("to_instance_id").references(() => instances.id, { onDelete: "cascade" }),
  toContactId: uuid("to_contact_id").references(() => contacts.id, { onDelete: "cascade" }),
  channel: text("channel").notNull().default("oc-controller"),
  bodyEncrypted: bytea("body_encrypted"),
  bodyIv: bytea("body_iv"),
  status: fleetMessageStatusEnum("status").default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
});

export const vrmModels = pgTable(
  "vrm_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    source: text("source").notNull(),
    relativePath: text("relative_path"),
    storageKey: text("storage_key"),
    originalFilename: text("original_filename"),
    fileSize: integer("file_size"),
    sha256: text("sha256"),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("vrm_models_tenant_dir_path").on(t.tenantId, t.relativePath),
    uniqueIndex("vrm_models_tenant_storage").on(t.tenantId, t.storageKey),
    index("vrm_models_tenant_updated").on(t.tenantId, t.updatedAt),
  ],
);

export const twilioUsageSnapshots = pgTable("twilio_usage_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  instanceId: uuid("instance_id").references(() => instances.id, { onDelete: "set null" }),
  period: text("period").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().default({}),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
});
