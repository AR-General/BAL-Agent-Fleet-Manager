type Tab = { id: string; label: string };

type Props = {
  tabs: Tab[];
  active: string;
  onChange: (id: string) => void;
};

export function Tabs({ tabs, active, onChange }: Props) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          className={active === t.id ? "tab active" : "tab"}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
