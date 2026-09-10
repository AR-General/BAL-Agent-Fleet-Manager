import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { Contact } from "../types";
import { PageHeader } from "../components/common/PageHeader";
import { Modal } from "../components/common/Modal";
import { useViewMode } from "../stores/viewMode";

export function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const { mode } = useViewMode();
  const [form, setForm] = useState({
    slug: "",
    display_name: "",
    contact_kind: "human" as "human" | "ai_agent",
    is_external: false,
    allow_contact: true,
    notes: "",
  });

  const load = () => {
    let q = "";
    if (filter === "human") q = "?kind=human";
    if (filter === "ai") q = "?kind=ai_agent";
    if (filter === "external") q = "?external=true";
    api<{ contacts: Contact[] }>(`/contacts${q}`)
      .then((r) => {
        let rows = r.contacts;
        if (mode === "tenant") rows = rows.filter((c) => !c.isExternal || c.allowContact);
        setContacts(rows);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  };

  useEffect(() => load(), [filter, mode]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    await api("/contacts", {
      method: "POST",
      body: JSON.stringify(form),
    });
    setCreateOpen(false);
    load();
  }

  async function syncAgents() {
    const r = await api<{ created: number }>("/contacts/sync-agents", { method: "POST" });
    alert(`Synced ${r.created} agent contact(s)`);
    load();
  }

  async function onDelete(slug: string) {
    if (!confirm(`Delete contact ${slug}?`)) return;
    await api(`/contacts/${slug}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle="Humans and AI agents in the tenant directory"
        actions={
          <>
            <button type="button" className="secondary" onClick={syncAgents}>
              Sync from instances
            </button>
            <button type="button" onClick={() => setCreateOpen(true)}>
              Add contact
            </button>
          </>
        }
      />
      {error && <p className="badge bad">{error}</p>}

      <div className="toolbar">
        <select value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">All</option>
          <option value="human">Humans</option>
          <option value="ai">AI agents</option>
          <option value="external">External only</option>
        </select>
      </div>

      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Slug</th>
            <th>Kind</th>
            <th>External</th>
            <th>Allow contact</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {contacts.map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/contacts/${c.slug}`}>
                  <strong>{c.displayName}</strong>
                </Link>
              </td>
              <td className="muted">{c.slug}</td>
              <td>{c.contactKind}</td>
              <td>{c.isExternal ? "yes" : "no"}</td>
              <td>{c.allowContact ? "yes" : "no"}</td>
              <td>{c.status}</td>
              <td>
                <button type="button" className="danger" onClick={() => onDelete(c.slug)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal open={createOpen} title="Add contact" onClose={() => setCreateOpen(false)} wide>
        <form onSubmit={onCreate} className="form-grid">
          <label>
            Slug *
            <input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </label>
          <label>
            Display name *
            <input
              required
              value={form.display_name}
              onChange={(e) => setForm({ ...form, display_name: e.target.value })}
            />
          </label>
          <label>
            Kind
            <select
              value={form.contact_kind}
              onChange={(e) => setForm({ ...form, contact_kind: e.target.value as "human" | "ai_agent" })}
            >
              <option value="human">human</option>
              <option value="ai_agent">ai_agent</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.is_external}
              onChange={(e) => setForm({ ...form, is_external: e.target.checked })}
            />{" "}
            External
          </label>
          <label>
            <input
              type="checkbox"
              checked={form.allow_contact}
              onChange={(e) => setForm({ ...form, allow_contact: e.target.checked })}
            />{" "}
            Allow contact
          </label>
          <label className="full">
            Notes
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </label>
          <button type="submit">Create</button>
        </form>
      </Modal>
    </>
  );
}
