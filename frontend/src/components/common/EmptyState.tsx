export function EmptyState({ message, action }: { message: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state card">
      <p className="muted">{message}</p>
      {action}
    </div>
  );
}
