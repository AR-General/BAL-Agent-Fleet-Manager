import type { instances } from "../db/schema.js";
import {
  summarizeInstanceEndpoints,
  type InstanceEndpoints,
} from "./instanceEndpoints.js";

type InstanceRow = typeof instances.$inferSelect;

export type PublicInstance = Omit<InstanceRow, "gatewayTokenEncrypted"> & {
  has_gateway_token: boolean;
  endpoints: InstanceEndpoints;
};

export function instanceToPublic(row: InstanceRow): PublicInstance {
  const { gatewayTokenEncrypted, ...rest } = row;
  return {
    ...rest,
    has_gateway_token: Boolean(gatewayTokenEncrypted?.trim()),
    endpoints: summarizeInstanceEndpoints({
      host: row.host,
      urls: (row.urls || {}) as Record<string, string>,
      identity: (row.identity || {}) as Record<string, unknown>,
    }),
  };
}

export function instancesToPublic(rows: InstanceRow[]): PublicInstance[] {
  return rows.map(instanceToPublic);
}
