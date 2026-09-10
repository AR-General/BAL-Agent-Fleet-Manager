import { MarkdownContent } from "./MarkdownContent";

type Props = {
  title?: string;
  value: string;
  saving?: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  onReload: () => void;
};

export function MarkdownEditor({
  title = "Notes",
  value,
  saving = false,
  onChange,
  onSave,
  onReload,
}: Props) {
  return (
    <section className="chat-side-panel">
      <div className="chat-side-panel-head">
        <div>
          <h3>{title}</h3>
          <p className="muted">Scratchpad for prompts, summaries, and room notes.</p>
        </div>
        <div className="row-actions">
          <button type="button" className="secondary" onClick={onReload}>
            Reload
          </button>
          <button type="button" onClick={onSave}>
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      <div className="chat-markdown-editor">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={14}
          placeholder="# Room notes"
        />
        <div className="chat-markdown-preview card">
          <MarkdownContent
            source={value}
            empty={<p className="muted">Preview will appear here.</p>}
          />
        </div>
      </div>
    </section>
  );
}
