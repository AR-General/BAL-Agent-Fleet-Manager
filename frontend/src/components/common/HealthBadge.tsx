import { healthClass } from "../../utils/instance";

export function HealthBadge({ status }: { status?: string }) {
  const cls = healthClass({ health: { status } });
  return (
    <span className="health-badge">
      <span className={`dot ${cls}`} />
      {status || "unknown"}
    </span>
  );
}
