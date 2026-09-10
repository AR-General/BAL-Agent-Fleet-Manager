import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { tenants } from "../db/schema.js";
import {
  DEFAULT_TTS_SPEAK_MODE,
  TTS_SPEAK_MODE_KEY,
  parseTtsSpeakMode,
  type TtsSpeakMode,
  workspaceTtsSpeakMode,
} from "./ttsSpeakMode.js";

export type WorkspaceSettingsView = {
  tts_speak_mode: TtsSpeakMode;
};

export async function getTenantSettings(
  tenantId: string,
): Promise<Record<string, unknown>> {
  const db = getDb();
  const row = await db.query.tenants.findFirst({
    where: eq(tenants.id, tenantId),
    columns: { settings: true },
  });
  const settings = row?.settings;
  return settings && typeof settings === "object" ? { ...settings } : {};
}

export async function getWorkspaceSettingsView(
  tenantId: string,
): Promise<WorkspaceSettingsView> {
  const settings = await getTenantSettings(tenantId);
  return {
    tts_speak_mode: workspaceTtsSpeakMode(settings),
  };
}

export async function patchWorkspaceSettings(
  tenantId: string,
  patch: { tts_speak_mode?: TtsSpeakMode },
): Promise<WorkspaceSettingsView> {
  const db = getDb();
  const current = await getTenantSettings(tenantId);
  const next = { ...current };
  if (patch.tts_speak_mode !== undefined) {
    const mode = parseTtsSpeakMode(patch.tts_speak_mode) || DEFAULT_TTS_SPEAK_MODE;
    next[TTS_SPEAK_MODE_KEY] = mode;
  }
  await db
    .update(tenants)
    .set({ settings: next, updatedAt: new Date() })
    .where(eq(tenants.id, tenantId));
  return {
    tts_speak_mode: workspaceTtsSpeakMode(next),
  };
}
