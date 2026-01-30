import { ReactNode } from "react";

interface CardProps {
  title: string;
  description?: string;
  children: ReactNode;
  compact?: boolean;
}

export function Card({ title, description, children, compact = false }: CardProps) {
  const containerClass = compact
    ? "rounded-lg border border-theme p-4 shadow-inner"
    : "rounded-xl border border-theme p-5 shadow-inner";
  const titleClass = compact ? "text-base font-semibold accent-text" : "text-lg font-semibold accent-text";
  const descriptionClass = compact ? "text-[11px] text-muted" : "text-xs text-muted";
  const contentClass = compact ? "mt-2 text-xs text-body" : "mt-3 text-sm text-body";
  return (
    <div className={containerClass} style={{ backgroundColor: 'var(--color-card)' }}>
      <header className="space-y-1">
        <h3 className={titleClass}>{title}</h3>
        {description ? <p className={descriptionClass}>{description}</p> : null}
      </header>
      <div className={contentClass}>{children}</div>
    </div>
  );
}
