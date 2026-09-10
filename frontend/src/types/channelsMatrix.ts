import type { InstanceChannelMeta, InstanceChannelType } from "../constants/instanceChannels";

export type MatrixChannelCell = {
  id: string | null;
  channel_type: string;
  configured: boolean;
  enabled: boolean;
  status: string | null;
  summary: string | null;
  config: Record<string, unknown>;
};

export type MatrixInstanceRow = {
  id: string;
  slug: string;
  display_name: string;
  host: string | null;
  status: string | null;
  health: Record<string, unknown>;
  urls: Record<string, string>;
  gateway_url: string | null;
  has_gateway_token: boolean;
  channels: Record<string, MatrixChannelCell>;
};

export type ChannelsMatrixResponse = {
  channel_types: InstanceChannelType[];
  channel_meta: Record<InstanceChannelType, InstanceChannelMeta>;
  instances: MatrixInstanceRow[];
};
