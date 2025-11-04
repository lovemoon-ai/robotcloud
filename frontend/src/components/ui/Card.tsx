import { ReactNode } from "react";

interface CardProps {
  title: string;
  description?: string;
  children: ReactNode;
  compact?: boolean;
}

export function Card({ title, description, children, compact = false }: CardProps) {
  const containerClass = compact
    ? "rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-inner shadow-slate-950/40"
    : "rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-inner shadow-slate-950/40";
  const titleClass = compact ? "text-base font-semibold text-teal-200" : "text-lg font-semibold text-teal-300";
  const descriptionClass = compact ? "text-[11px] text-slate-400" : "text-xs text-slate-400";
  const contentClass = compact ? "mt-2 text-xs text-slate-100" : "mt-3 text-sm text-slate-100";
  return (
    <div className={containerClass}>
      <header className="space-y-1">
        <h3 className={titleClass}>{title}</h3>
        {description ? <p className={descriptionClass}>{description}</p> : null}
      </header>
      <div className={contentClass}>{children}</div>
    </div>
  );
}
