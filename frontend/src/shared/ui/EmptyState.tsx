import type { ReactNode } from "react";
export function EmptyState({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return <div className="empty-state"><span className="empty-state-mark" aria-hidden="true">—</span><h3>{title}</h3>{description && <p className="muted">{description}</p>}{children}</div>;
}
export default EmptyState;
