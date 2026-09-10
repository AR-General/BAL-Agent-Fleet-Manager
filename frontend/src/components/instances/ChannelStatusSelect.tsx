import { CHANNEL_STATUS_OPTIONS } from "../../constants/channelSchemas";

type Props = {
  value: string | null;
  onChange: (value: string | null) => void;
  id?: string;
};

export function ChannelStatusSelect({ value, onChange, id }: Props) {
  return (
    <select
      id={id}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
    >
      {CHANNEL_STATUS_OPTIONS.map((opt) => (
        <option key={opt.value || "_unknown"} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
