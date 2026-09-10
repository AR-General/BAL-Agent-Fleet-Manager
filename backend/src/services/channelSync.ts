import { eq } from "drizzle-orm";
import { channelConfigs, instances } from "../db/schema.js";
import { getDb } from "../db/client.js";

export type ChannelConfigRow = typeof channelConfigs.$inferSelect;

export function channelConfigsToInstanceBlob(
  rows: Pick<ChannelConfigRow, "channelType" | "enabled" | "config">[],
): Record<string, unknown> {
  const channels: Record<string, unknown> = {};
  for (const row of rows) {
    channels[row.channelType] = {
      enabled: row.enabled ?? false,
      ...(row.config || {}),
    };
  }
  return channels;
}

export async function syncInstanceChannelsBlob(
  db: ReturnType<typeof getDb>,
  instanceId: string,
): Promise<Record<string, unknown>> {
  const rows = await db
    .select({
      channelType: channelConfigs.channelType,
      enabled: channelConfigs.enabled,
      config: channelConfigs.config,
    })
    .from(channelConfigs)
    .where(eq(channelConfigs.instanceId, instanceId));

  const channels = channelConfigsToInstanceBlob(rows);
  await db.update(instances).set({ channels }).where(eq(instances.id, instanceId));
  return channels;
}
