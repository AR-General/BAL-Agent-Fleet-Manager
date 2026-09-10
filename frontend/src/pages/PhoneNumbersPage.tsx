import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import type { PhoneNumber } from "../types";
import { PageHeader } from "../components/common/PageHeader";
import { Modal } from "../components/common/Modal";

export function PhoneNumbersPage() {
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [edit, setEdit] = useState<PhoneNumber | null>(null);
  const [form, setForm] = useState({
    number: "",
    label: "",
    number_type: "virtual_twilio" as PhoneNumber["numberType"],
    inbound_enabled: true,
    outbound_enabled: true,
    voice_enabled: true,
    sms_enabled: true,
    whatsapp_enabled: false,
  });

  const load = () =>
    api<{ phone_numbers: PhoneNumber[] }>("/phone-numbers").then((r) => setNumbers(r.phone_numbers));

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  }, []);

  function openCreate() {
    setEdit(null);
    setForm({
      number: "",
      label: "",
      number_type: "virtual_twilio",
      inbound_enabled: true,
      outbound_enabled: true,
      voice_enabled: true,
      sms_enabled: true,
      whatsapp_enabled: false,
    });
    setCreateOpen(true);
  }

  function openEdit(n: PhoneNumber) {
    setEdit(n);
    setForm({
      number: n.number,
      label: n.label || "",
      number_type: n.numberType as PhoneNumber["numberType"],
      inbound_enabled: n.inboundEnabled ?? true,
      outbound_enabled: n.outboundEnabled ?? true,
      voice_enabled: n.voiceEnabled ?? true,
      sms_enabled: n.smsEnabled ?? true,
      whatsapp_enabled: n.whatsappEnabled ?? false,
    });
    setCreateOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (edit) {
      await api(`/phone-numbers/${edit.id}`, {
        method: "PUT",
        body: JSON.stringify({
          label: form.label,
          inbound_enabled: form.inbound_enabled,
          outbound_enabled: form.outbound_enabled,
          voice_enabled: form.voice_enabled,
          sms_enabled: form.sms_enabled,
          whatsapp_enabled: form.whatsapp_enabled,
        }),
      });
    } else {
      await api("/phone-numbers", {
        method: "POST",
        body: JSON.stringify({
          number: form.number,
          label: form.label || undefined,
          number_type: form.number_type,
          inbound_enabled: form.inbound_enabled,
          outbound_enabled: form.outbound_enabled,
          voice_enabled: form.voice_enabled,
          sms_enabled: form.sms_enabled,
          whatsapp_enabled: form.whatsapp_enabled,
        }),
      });
    }
    setCreateOpen(false);
    load();
  }

  async function onDelete(id: string) {
    if (!confirm("Delete this number?")) return;
    await api(`/phone-numbers/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <PageHeader
        title="Phone numbers"
        subtitle="Twilio, eSIM, and physical lines assigned to agents"
        actions={
          <button type="button" onClick={openCreate}>
            Add number
          </button>
        }
      />
      {error && <p className="badge bad">{error}</p>}

      <table className="table">
        <thead>
          <tr>
            <th>Number</th>
            <th>Label</th>
            <th>Type</th>
            <th>Voice</th>
            <th>SMS</th>
            <th>WhatsApp</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {numbers.map((n) => (
            <tr key={n.id}>
              <td>
                <strong>{n.number}</strong>
              </td>
              <td>{n.label ?? "—"}</td>
              <td>{n.numberType}</td>
              <td>{n.voiceEnabled ? "✓" : "—"}</td>
              <td>{n.smsEnabled ? "✓" : "—"}</td>
              <td>{n.whatsappEnabled ? "✓" : "—"}</td>
              <td>
                <div className="row-actions">
                  <button type="button" className="secondary" onClick={() => openEdit(n)}>
                    Edit
                  </button>
                  <button type="button" className="danger" onClick={() => onDelete(n.id)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal open={createOpen} title={edit ? "Edit number" : "Add number"} onClose={() => setCreateOpen(false)} wide>
        <form onSubmit={onSubmit} className="form-grid">
          <label>
            E.164 number *
            <input
              required
              disabled={!!edit}
              value={form.number}
              onChange={(e) => setForm({ ...form, number: e.target.value })}
              placeholder="+49…"
            />
          </label>
          <label>
            Label
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          </label>
          <label>
            Type
            <select
              value={form.number_type}
              disabled={!!edit}
              onChange={(e) => setForm({ ...form, number_type: e.target.value as PhoneNumber["numberType"] })}
            >
              <option value="virtual_twilio">virtual_twilio</option>
              <option value="esim">esim</option>
              <option value="physical_sim">physical_sim</option>
            </select>
          </label>
          {(["voice_enabled", "sms_enabled", "whatsapp_enabled", "inbound_enabled", "outbound_enabled"] as const).map(
            (key) => (
              <label key={key}>
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                />{" "}
                {key.replace(/_/g, " ")}
              </label>
            ),
          )}
          <button type="submit">{edit ? "Save" : "Create"}</button>
        </form>
      </Modal>
    </>
  );
}
