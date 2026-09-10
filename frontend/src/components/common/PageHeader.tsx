import { Link } from "react-router-dom";

type Props = {
  title: string;
  subtitle?: string;
  backTo?: string;
  actions?: React.ReactNode;
};

export function PageHeader({ title, subtitle, backTo, actions }: Props) {
  return (
    <div className="page-header">
      <div>
        {backTo && (
          <Link to={backTo} className="back-link">
            ← Back
          </Link>
        )}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}
