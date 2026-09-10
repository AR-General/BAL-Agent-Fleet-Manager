import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import type { Contact, ContactChannel } from "../types";
import { PageHeader } from "../components/common/PageHeader";

const CHANNEL_TYPES = [
  "phone",
  "signal",
  "sms",
  "whatsapp",
  "email",
  "slack",
  "twilio_voice",
  "webchat",
  "other",
];

export function ContactDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [contact, setContact] = useState<Contact | null>(null);
  const [channels, setChannels] = useState<ContactChannel[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [notes, setNotes] = useState("");
  const [isExternal, setIsExternal] = useState(false);
  const [allowContact, setAllowContact] = useState(true);

  const load = () => {
    if (!slug) return;
    api<{ contact: Contact; channels: ContactChannel[] }>(`/contacts/${slug}`).then((r) => {
      setContact(r.contact);
      setChannels(r.channels);
      setDisplayName(r.contact.displayName);
      setNotes(r.contact.notes || "");
      setIsExternal(r.contact.isExternal);
      setAllowContact(r.contact.allowContact);
    });
  };

  useEffect(() => load(), [slug]);

  async function saveContact(e: FormEvent) {
    e.preventDefault();
    if (!slug) return;
    setSaving(true);
    try {
      await api(`/contacts/${slug}`, {
        method: "PUT",
        body: JSON.stringify({
          display_name: displayName,
          notes,
          is_external: isExternal,
          allow_contact: allowContact,
        }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function saveChannels(e: FormEvent) {
    e.preventDefault();
    if (!slug) return;
    await api(`/contacts/${slug}/channels`, {
      method: "PUT",
      body: JSON.stringify({
        channels: channels.map((ch) => ({
          channel_type: ch.channelType,
          address: ch.address,
          label: ch.label,
          priority: ch.priority ?? 0,
          inbound_ok: ch.inboundOk,
          outbound_ok: ch.outboundOk,
          is_primary: ch.isPrimary,
        })),
      }),
    });
    load();
  }

  function addChannel() {
    setChannels([
      ...channels,
      {
        id: `new-${Date.now()}`,
        channelType: "phone",
        address: "",
        label: null,
        priority: 0,
        inboundOk: true,
        outboundOk: true,
        isPrimary: channels.length === 0,
      },
    ]);
  }

  if (!contact) return <p className="muted">Loading…</p>;

  return (
    <>
      <PageHeader title={contact.displayName} subtitle={contact.slug} backTo="/contacts" />
      {error && <p className="badge bad">{error}</p>}

      <form onSubmit={saveContact} className="card" style={{ marginBottom: "1rem" }}>
        <h3>Profile</h3>
        <div className="form-grid">
          <label>
            Display name
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </label>
          <label>
            Kind
            <input disabled value={contact.contactKind} />
          </label>
          <label>
            <input type="checkbox" checked={isExternal} onChange={(e) => setIsExternal(e.target.checked)} /> External
          </label>
          <label>
            <input type="checkbox" checked={allowContact} onChange={(e) => setAllowContact(e.target.checked)} /> Allow
            contact
          </label>
          <label className="full">
            Notes
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
        <button type="submit" disabled={saving} style={{ marginTop: "0.75rem" }}>
          Save profile
        </button>
      </form>

      <form onSubmit={saveChannels} className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3>Channels</h3>
          <button type="button" className="secondary" onClick={addChannel}>
            Add channel
          </button>
        </div>
        {channels.map((ch, idx) => (
          <div key={ch.id} className="form-grid" style={{ marginTop: "0.75rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border)" }}>
            <label>
              Type
              <select
                value={ch.channelType}
                onChange={(e) => {
                  const next = [...channels];
                  next[idx] = { ...ch, channelType: e.target.value };
                  setChannels(next);
                }}
              >
                {CHANNEL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Address *
              <input
                required
                value={ch.address}
                onChange={(e) => {
                  const next = [...channels];
                  next[idx] = { ...ch, address: e.target.value };
                  setChannels(next);
                }}
              />
            </label>
            <label>
              Label
              <input
                value={ch.label || ""}
                onChange={(e) => {
                  const next = [...channels];
                  next[idx] = { ...ch, label: e.target.value };
                  setChannels(next);
                }}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={ch.isPrimary}
                onChange={(e) => {
                  const next = [...channels];
                  next[idx] = { ...ch, isPrimary: e.target.checked };
                  setChannels(next);
                }}
              />{" "}
              Primary
            </label>
            <button
              type="button"
              className="danger"
              onClick={() => setChannels(channels.filter((_, i) => i !== idx))}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="submit" style={{ marginTop: "1rem" }}>
          Save channels
        </button>
      </form>
    </>
  );
}
