import { useState, type MouseEvent } from "react";
import type { InstanceChannelType } from "../../constants/instanceChannels";
import { PUB_URL_KEYS } from "../../constants/instanceChannels";
import {
  CHANNEL_FIELD_SCHEMAS,
  type ChannelFieldDef,
} from "../../constants/channelSchemas";
import {
  configBool,
  configFormList,
  configString,
  patchConfig,
} from "../../utils/channelConfig";
import { parseJsonField } from "../../utils/instance";
import { PhoneNumberField } from "./PhoneNumberField";

type Props = {
  channelType: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  instanceId: string | null;
  instanceSlug: string;
  instanceUrls?: Record<string, string>;
  showAdvanced?: boolean;
};

function MultiValueListField({
  label,
  values,
  onChange,
  inputType,
  placeholder,
  addLabel,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  inputType: "email" | "tel";
  placeholder: string;
  addLabel: string;
}) {
  const rows = values.length > 0 ? values : [""];

  function addRow(e: MouseEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    onChange([...rows, ""]);
  }

  return (
    <div className="ch-multi-list">
      <span className="ch-field-label">{label}</span>
      {rows.map((val, i) => (
        <div key={`${i}-${rows.length}`} className="ch-multi-row">
          <input
            type={inputType}
            value={val}
            placeholder={placeholder}
            onChange={(e) => {
              const next = [...rows];
              next[i] = e.target.value;
              onChange(next);
            }}
          />
          <button
            type="button"
            className="secondary"
            disabled={rows.length <= 1 && !val}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const next = rows.filter((_, j) => j !== i);
              onChange(next.length > 0 ? next : [""]);
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <button type="button" className="secondary ch-multi-add" onClick={addRow}>
        {addLabel}
      </button>
    </div>
  );
}

function renderScalarField(
  field: ChannelFieldDef,
  config: Record<string, unknown>,
  onChange: (config: Record<string, unknown>) => void,
) {
  const value = field.type === "checkbox" ? configBool(config, field.key) : configString(config, field.key);

  if (field.type === "checkbox") {
    return (
      <label key={field.key} className="checkbox-row">
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(patchConfig(config, field.key, e.target.checked))}
        />
        {field.label}
      </label>
    );
  }

  if (field.type === "select" && field.options) {
    return (
      <label key={field.key}>
        {field.label}
        <select
          value={value}
          onChange={(e) => onChange(patchConfig(config, field.key, e.target.value))}
        >
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {field.hint && <span className="muted ch-field-hint">{field.hint}</span>}
      </label>
    );
  }

  const inputType =
    field.type === "password"
      ? "password"
      : field.type === "email"
        ? "email"
        : field.type === "tel"
          ? "tel"
          : field.type === "url"
            ? "url"
            : field.type === "number"
              ? "number"
              : "text";

  if (field.type === "textarea") {
    return (
      <label key={field.key} className="full">
        {field.label}
        <textarea
          rows={3}
          value={value}
          placeholder={field.placeholder}
          onChange={(e) => onChange(patchConfig(config, field.key, e.target.value))}
        />
        {field.hint && <span className="muted ch-field-hint">{field.hint}</span>}
      </label>
    );
  }

  return (
    <label key={field.key} className={field.type === "password" ? "full" : undefined}>
      {field.label}
      <input
        type={inputType}
        value={value}
        required={field.required}
        placeholder={field.placeholder}
        onChange={(e) =>
          onChange(
            patchConfig(
              config,
              field.key,
              field.type === "number" ? Number(e.target.value) || e.target.value : e.target.value,
            ),
          )
        }
      />
      {field.hint && <span className="muted ch-field-hint">{field.hint}</span>}
    </label>
  );
}

export function ChannelConfigFormFields({
  channelType,
  config,
  onChange,
  instanceId,
  instanceSlug,
  instanceUrls = {},
  showAdvanced = false,
}: Props) {
  const [advancedJson, setAdvancedJson] = useState("");
  const [jsonErr, setJsonErr] = useState("");

  const schema =
    CHANNEL_FIELD_SCHEMAS[channelType as InstanceChannelType] ??
    ([] as ChannelFieldDef[]);

  const primary = schema.filter((f) => !f.advanced);
  const advanced = schema.filter((f) => f.advanced);

  function applyAdvancedJson() {
    setJsonErr("");
    try {
      const parsed = parseJsonField(advancedJson) as Record<string, unknown>;
      onChange({ ...config, ...parsed });
    } catch (e) {
      setJsonErr(e instanceof Error ? e.message : "Invalid JSON");
    }
  }

  const voicePreferred = channelType === "twilio_voice";
  const smsPreferred = channelType === "twilio_sms";
  const whatsappPreferred = channelType === "whatsapp";

  return (
    <div className="ch-config-fields">
      <div className="form-grid">
        {primary.map((field) => {
          if (field.type === "phone_number") {
            return (
              <div key={field.key} className="full">
                <PhoneNumberField
                  instanceId={instanceId}
                  instanceSlug={instanceSlug}
                  config={config}
                  onChange={onChange}
                  voicePreferred={voicePreferred}
                  smsPreferred={smsPreferred}
                  whatsappPreferred={whatsappPreferred}
                  syncNumbersKey={voicePreferred || smsPreferred ? "phone_numbers" : undefined}
                  hideManualInput={voicePreferred || smsPreferred}
                />
              </div>
            );
          }
          if (field.type === "phone_number_list") {
            return (
              <div key={field.key} className="full">
                <MultiValueListField
                  label={field.label}
                  values={configFormList(config, field.key)}
                  inputType="tel"
                  placeholder={field.placeholder ?? "+1…"}
                  addLabel="Add number"
                  onChange={(nums) => {
                    let next = patchConfig(config, field.key, nums);
                    const first = nums.map((n) => n.trim()).find(Boolean);
                    if (first) {
                      next = patchConfig(next, "phone_number", first);
                      next = patchConfig(next, "number", first);
                    }
                    onChange(next);
                  }}
                />
              </div>
            );
          }
          if (field.type === "email_list") {
            return (
              <div key={field.key} className="full">
                <MultiValueListField
                  label={field.label}
                  values={configFormList(config, "addresses")}
                  inputType="email"
                  placeholder="agent@example.com"
                  addLabel="Add email"
                  onChange={(addrs) => {
                    let next = patchConfig(config, "addresses", addrs);
                    const first = addrs.map((a) => a.trim()).find(Boolean);
                    if (first) next = patchConfig(next, "address", first);
                    onChange(next);
                  }}
                />
              </div>
            );
          }
          return renderScalarField(field, config, onChange);
        })}
      </div>

      {channelType === "pub_urls" && Object.keys(instanceUrls).length > 0 && (
        <div className="ch-instance-urls">
          <p className="muted" style={{ margin: "0.5rem 0 0.25rem" }}>
            From instance ports (read-only)
          </p>
          <table className="table ch-url-table">
            <tbody>
              {PUB_URL_KEYS.filter((k) => instanceUrls[k]).map((k) => (
                <tr key={k}>
                  <td className="muted">{k}</td>
                  <td>
                    <a href={instanceUrls[k]} target="_blank" rel="noopener noreferrer">
                      {instanceUrls[k]}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(showAdvanced || advanced.length > 0) && (
        <details className="ch-advanced" open={showAdvanced}>
          <summary className="muted">Advanced options</summary>
          <div className="form-grid" style={{ marginTop: "0.75rem" }}>
            {advanced.map((field) => renderScalarField(field, config, onChange))}
          </div>
        </details>
      )}

      <details className="ch-advanced">
        <summary className="muted">Raw JSON (merge)</summary>
        <textarea
          rows={6}
          className="code"
          placeholder={JSON.stringify(config, null, 2)}
          value={advancedJson}
          onChange={(e) => setAdvancedJson(e.target.value)}
          onFocus={() => {
            if (!advancedJson) setAdvancedJson(JSON.stringify(config, null, 2));
          }}
        />
        {jsonErr && <p className="badge bad">{jsonErr}</p>}
        <button type="button" className="secondary" style={{ marginTop: "0.5rem" }} onClick={applyAdvancedJson}>
          Merge JSON into config
        </button>
      </details>
    </div>
  );
}
