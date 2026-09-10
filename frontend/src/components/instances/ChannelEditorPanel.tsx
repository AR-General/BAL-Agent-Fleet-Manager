import type { InstanceChannelType } from "../../constants/instanceChannels";
import { INSTANCE_CHANNEL_META } from "../../constants/instanceChannels";
import { channelTypeIcon, channelTypeLabel } from "../../constants/channelSchemas";
import { ChannelConfigFormFields } from "./ChannelConfigFormFields";
import { ChannelStatusSelect } from "./ChannelStatusSelect";

type Props = {
  channelType: string;
  config: Record<string, unknown>;
  status: string | null;
  enabled: boolean;
  instanceSlug: string;
  instanceId: string | null;
  instanceUrls?: Record<string, string>;
  onConfigChange: (config: Record<string, unknown>) => void;
  onStatusChange: (status: string | null) => void;
  onEnabledChange: (enabled: boolean) => void;
  compact?: boolean;
};

export function ChannelEditorPanel({
  channelType,
  config,
  status,
  enabled,
  instanceSlug,
  instanceId,
  instanceUrls,
  onConfigChange,
  onStatusChange,
  onEnabledChange,
  compact,
}: Props) {
  const meta = INSTANCE_CHANNEL_META[channelType as InstanceChannelType];
  const icon = meta?.icon ?? channelTypeIcon(channelType);
  const label = meta?.label ?? channelTypeLabel(channelType);

  return (
    <div className={compact ? "ch-editor-panel-inner compact" : "ch-editor-panel-inner"}>
      <div className="ch-editor-head">
        <h4 style={{ margin: 0 }}>
          {icon} {label}
        </h4>
        <span className="muted">{instanceSlug}</span>
      </div>

      <div className="form-grid ch-editor-meta">
        <label className="checkbox-row">
          <input type="checkbox" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} />
          Enabled
        </label>
        <label>
          Status
          <ChannelStatusSelect value={status} onChange={onStatusChange} />
        </label>
      </div>

      <ChannelConfigFormFields
        channelType={channelType}
        config={config}
        onChange={onConfigChange}
        instanceId={instanceId}
        instanceSlug={instanceSlug}
        instanceUrls={instanceUrls}
        showAdvanced={!compact}
      />
    </div>
  );
}
