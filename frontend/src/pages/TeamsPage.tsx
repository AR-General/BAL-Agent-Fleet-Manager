import { FormEvent, useEffect, useState } from "react";
import { api } from "../api/client";
import type { DbInstance, Team } from "../types";
import { PageHeader } from "../components/common/PageHeader";
import { Modal } from "../components/common/Modal";
import { EmptyState } from "../components/common/EmptyState";

export function TeamsPage() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [instances, setInstances] = useState<DbInstance[]>([]);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [memberTeam, setMemberTeam] = useState<Team | null>(null);
  const [form, setForm] = useState({ slug: "", name: "", description: "" });
  const [memberForm, setMemberForm] = useState({
    instance_slug: "",
    member_type: "instance" as "instance" | "agent",
    agent_id: "",
    role_in_team: "",
  });

  const load = () => {
    Promise.all([
      api<{ teams: Team[] }>("/teams"),
      api<{ instances: DbInstance[] }>("/instances"),
    ])
      .then(([t, i]) => {
        setTeams(t.teams);
        setInstances(i.instances);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed"));
  };

  useEffect(() => load(), []);

  async function createTeam(e: FormEvent) {
    e.preventDefault();
    await api("/teams", {
      method: "POST",
      body: JSON.stringify({
        slug: form.slug,
        name: form.name,
        description: form.description || undefined,
      }),
    });
    setCreateOpen(false);
    setForm({ slug: "", name: "", description: "" });
    load();
  }

  async function addMember(e: FormEvent) {
    e.preventDefault();
    if (!memberTeam) return;
    await api(`/teams/${memberTeam.slug}/members`, {
      method: "POST",
      body: JSON.stringify({
        member_type: memberForm.member_type,
        instance_slug: memberForm.instance_slug,
        agent_id: memberForm.member_type === "agent" ? memberForm.agent_id : undefined,
        role_in_team: memberForm.role_in_team || undefined,
      }),
    });
    setMemberTeam(null);
    load();
  }

  async function removeMember(teamSlug: string, memberId: string) {
    if (!confirm("Remove this member?")) return;
    await api(`/teams/${teamSlug}/members/${memberId}`, { method: "DELETE" });
    load();
  }

  return (
    <>
      <PageHeader
        title="Teams"
        subtitle="Group instances and agents for routing and access"
        actions={
          <button type="button" onClick={() => setCreateOpen(true)}>
            Create team
          </button>
        }
      />
      {error && <p className="badge bad">{error}</p>}

      {teams.length === 0 ? (
        <EmptyState message="No teams yet." action={<button type="button" onClick={() => setCreateOpen(true)}>Create team</button>} />
      ) : (
        teams.map((t) => (
          <div key={t.id} className="card" style={{ marginBottom: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
              <div>
                <h3 style={{ margin: 0 }}>{t.name}</h3>
                <p className="muted">{t.slug}</p>
                {t.description && <p>{t.description}</p>}
              </div>
              <button type="button" className="secondary" onClick={() => setMemberTeam(t)}>
                Add member
              </button>
            </div>
            <table className="table" style={{ marginTop: "0.75rem" }}>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Instance</th>
                  <th>Role</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {t.members?.length ? (
                  t.members.map((m) => {
                    const inst = instances.find((i) => i.id === m.instanceId);
                    return (
                      <tr key={m.id}>
                        <td>{m.memberType}</td>
                        <td>{inst?.slug ?? m.instanceId}</td>
                        <td>{m.roleInTeam ?? "—"}</td>
                        <td>
                          <button type="button" className="danger" onClick={() => removeMember(t.slug, m.id)}>
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="muted">
                      No members
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))
      )}

      <Modal open={createOpen} title="Create team" onClose={() => setCreateOpen(false)}>
        <form onSubmit={createTeam} className="form-grid">
          <label>
            Slug *
            <input required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          </label>
          <label>
            Name *
            <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="full">
            Description
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <button type="submit">Create</button>
        </form>
      </Modal>

      <Modal open={!!memberTeam} title={`Add member — ${memberTeam?.name}`} onClose={() => setMemberTeam(null)}>
        <form onSubmit={addMember} className="form-grid">
          <label>
            Instance *
            <select
              required
              value={memberForm.instance_slug}
              onChange={(e) => setMemberForm({ ...memberForm, instance_slug: e.target.value })}
            >
              <option value="">Select…</option>
              {instances.map((i) => (
                <option key={i.id} value={i.slug}>
                  {i.slug}
                </option>
              ))}
            </select>
          </label>
          <label>
            Member type
            <select
              value={memberForm.member_type}
              onChange={(e) =>
                setMemberForm({ ...memberForm, member_type: e.target.value as "instance" | "agent" })
              }
            >
              <option value="instance">instance</option>
              <option value="agent">agent</option>
            </select>
          </label>
          {memberForm.member_type === "agent" && (
            <label>
              Agent ID
              <input
                value={memberForm.agent_id}
                onChange={(e) => setMemberForm({ ...memberForm, agent_id: e.target.value })}
                placeholder="main"
              />
            </label>
          )}
          <label>
            Role in team
            <input
              value={memberForm.role_in_team}
              onChange={(e) => setMemberForm({ ...memberForm, role_in_team: e.target.value })}
            />
          </label>
          <button type="submit">Add</button>
        </form>
      </Modal>
    </>
  );
}
