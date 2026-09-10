import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import type { PhoneNumber } from "../../types";
import { patchConfig, configString, syncPrimaryPhoneNumber } from "../../utils/channelConfig";

type PhoneNumberRow = PhoneNumber & {
  assignedInstanceId?: string | null;
};

type Props = {
  instanceId: string | null;
  instanceSlug: string;
  config: Record<string, unknown>;
  onChange: (config: Record<string, unknown>) => void;
  voicePreferred?: boolean;
  smsPreferred?: boolean;
  whatsappPreferred?: boolean;
  /** When set, fleet selection updates this list's first entry (e.g. phone_numbers). */
  syncNumbersKey?: string;
  hideManualInput?: boolean;
};

export function PhoneNumberField({
  instanceId,
  instanceSlug,
  config,
  onChange,
  voicePreferred,
  smsPreferred,
  whatsappPreferred,
  syncNumbersKey,
  hideManualInput,
}: Props) {
  const [numbers, setNumbers] = useState<PhoneNumberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [err, setErr] = useState("");

  const selectedId = configString(config, "phone_number_id");

  useEffect(() => {
    setLoading(true);
    api<{ phone_numbers: PhoneNumberRow[] }>("/phone-numbers")
      .then((r) => setNumbers(r.phone_numbers))
      .catch((e) => setErr(e instanceof Error ? e.message : "Failed to load numbers"))
      .finally(() => setLoading(false));
  }, []);

  const eligible = numbers.filter((n) => {
    if (n.id === selectedId) return true;
    if (!n.assignedInstanceId) return true;
    if (instanceId && n.assignedInstanceId === instanceId) return true;
    return false;
  });

  async function onSelect(id: string) {
    setErr("");
    if (!id) {
      let next = patchConfig(config, "phone_number_id", "");
      next = syncNumbersKey
        ? syncPrimaryPhoneNumber(next, "", syncNumbersKey)
        : patchConfig(next, "phone_number", "");
      onChange(next);
      return;
    }
    const row = numbers.find((n) => n.id === id);
    if (!row) return;

    let next = patchConfig(config, "phone_number_id", id);
    if (syncNumbersKey) {
      next = syncPrimaryPhoneNumber(next, row.number, syncNumbersKey);
    } else {
      next = patchConfig(next, "phone_number", row.number);
      next = patchConfig(next, "phone", row.number);
      next = patchConfig(next, "number", row.number);
    }
    if (row.label) next = patchConfig(next, "label", row.label);
    onChange(next);

    if (instanceId && row.assignedInstanceId !== instanceId) {
      setAssigning(true);
      try {
        await api(`/phone-numbers/${id}`, {
          method: "PUT",
          body: JSON.stringify({ assigned_instance_slug: instanceSlug }),
        });
        setNumbers((prev) =>
          prev.map((n) => (n.id === id ? { ...n, assignedInstanceId: instanceId } : n)),
        );
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Could not assign number to instance");
      } finally {
        setAssigning(false);
      }
    }
  }

  const manual = configString(config, "phone_number") || configString(config, "phone");

  return (
    <div className="ch-phone-field">
      <label>
        Fleet phone number
        <select
          value={selectedId}
          disabled={loading || assigning}
          onChange={(e) => void onSelect(e.target.value)}
        >
          <option value="">— Select or enter manually below —</option>
          {eligible.map((n) => (
            <option key={n.id} value={n.id}>
              {n.number}
              {n.label ? ` (${n.label})` : ""}
              {n.assignedInstanceId && n.assignedInstanceId !== instanceId ? " · other instance" : ""}
            </option>
          ))}
        </select>
      </label>
      {loading && <p className="muted">Loading phone numbers…</p>}
      {assigning && <p className="muted">Assigning to {instanceSlug}…</p>}
      {err && <p className="badge bad">{err}</p>}
      {!hideManualInput && (
        <label>
          Number (E.164)
          <input
            type="tel"
            value={manual}
            placeholder="+49…"
            onChange={(e) => {
              const v = e.target.value;
              const next = syncNumbersKey
                ? syncPrimaryPhoneNumber(config, v, syncNumbersKey)
                : patchConfig(patchConfig(patchConfig(config, "phone_number", v), "phone", v), "number", v);
              onChange(next);
            }}
          />
        </label>
      )}
      <p className="muted ch-field-hint">
        <Link to="/phone-numbers">Manage fleet numbers</Link>
        {voicePreferred && " · prefer voice-enabled lines"}
        {smsPreferred && " · SMS"}
        {whatsappPreferred && " · WhatsApp"}
      </p>
    </div>
  );
}
