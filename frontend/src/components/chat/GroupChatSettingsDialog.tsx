import { FormEvent, useEffect, useMemo, useState } from "react";

type Props = {
  open: boolean;
  maxAgentAutoTurns: number;
  replyPolicy?: string;
  primarySlug?: string | null;
  participantSlugs: string[];
  availableAgentSlugs: string[];
  adding?: boolean;
  removingSlug?: string | null;
  onClose: () => void;
  onSave: (next: { maxAgentAutoTurns: number }) => Promise<void> | void;
  onAddParticipant: (slug: string) => Promise<void> | void;
  onRemoveParticipant: (slug: string) => Promise<void> | void;
};

export function GroupChatSettingsDialog({
  open,
  maxAgentAutoTurns,
  replyPolicy,
  primarySlug,
  participantSlugs,
  availableAgentSlugs,
  adding = false,
  removingSlug = null,
  onClose,
  onSave,
  onAddParticipant,
  onRemoveParticipant,
}: Props) {
  const [turns, setTurns] = useState(maxAgentAutoTurns);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [addSlug, setAddSlug] = useState("");

  const candidates = useMemo(
    () => availableAgentSlugs.filter((slug) => !participantSlugs.includes(slug)),
    [availableAgentSlugs, participantSlugs],
  );

  useEffect(() => {
    if (open) {
      setTurns(maxAgentAutoTurns);
      setError("");
      setAddSlug("");
    }
  }, [open, maxAgentAutoTurns]);

  useEffect(() => {
    if (addSlug && !candidates.includes(addSlug)) setAddSlug("");
  }, [addSlug, candidates]);

  if (!open) return null;

  const busy = saving || adding || Boolean(removingSlug);
  const canRemove = participantSlugs.length > 1;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({ maxAgentAutoTurns: turns });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleAdd() {
    if (!addSlug) return;
    setError("");
    try {
      await onAddParticipant(addSlug);
      setAddSlug("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function handleRemove(slug: string) {
    setError("");
    try {
      await onRemoveParticipant(slug);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="chat-group-settings-overlay" role="dialog" aria-label="Group chat settings">
      <div className="chat-group-settings card">
        <header>
          <h2>Group chat settings</h2>
          <button type="button" className="secondary" onClick={onClose}>
            Close
          </button>
        </header>
        <section className="chat-group-roster" aria-label="Participants">
          <h3>Participants</h3>
          <ul className="chat-group-roster-list">
            {participantSlugs.map((slug) => (
              <li key={slug}>
                <span>
                  @{slug}
                  {slug === primarySlug ? <span className="muted"> · primary</span> : null}
                </span>
                <button
                  type="button"
                  className="secondary"
                  disabled={!canRemove || busy}
                  title={canRemove ? `Remove @${slug}` : "Cannot remove the last agent"}
                  onClick={() => void handleRemove(slug)}
                >
                  {removingSlug === slug ? "Removing…" : "Remove"}
                </button>
              </li>
            ))}
          </ul>
          {candidates.length ? (
            <div className="chat-group-roster-add">
              <label>
                <span>Add agent</span>
                <select
                  value={addSlug}
                  disabled={busy}
                  onChange={(e) => setAddSlug(e.target.value)}
                >
                  <option value="">Choose an agent…</option>
                  {candidates.map((slug) => (
                    <option key={slug} value={slug}>
                      @{slug}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" disabled={!addSlug || busy} onClick={() => void handleAdd()}>
                {adding ? "Adding…" : "Add"}
              </button>
            </div>
          ) : (
            <p className="muted">All fleet agents are already in this room.</p>
          )}
        </section>
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p className="muted">
            Click a participant chip to choose the primary responder. Others only reply when
            @mentioned or via @all / @room.
          </p>
          <dl className="chat-group-settings-meta">
            <div>
              <dt>Primary</dt>
              <dd>{primarySlug ? `@${primarySlug}` : "first participant"}</dd>
            </div>
            <div>
              <dt>Policy</dt>
              <dd>{replyPolicy || "human_only"}</dd>
            </div>
          </dl>
          <label>
            <span>Max agent auto turns</span>
            <input
              type="number"
              min={1}
              max={20}
              value={turns}
              onChange={(e) => setTurns(Number(e.target.value) || 1)}
            />
            <span className="muted">
              Generations spawned from one human message (first hop + @mention follow-ups). Default 5.
            </span>
          </label>
          {error ? <p className="badge bad">{error}</p> : null}
          <footer>
            <button type="button" className="secondary" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              {saving ? "Saving…" : "Save"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
