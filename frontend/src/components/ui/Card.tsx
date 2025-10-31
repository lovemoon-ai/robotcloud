import { ReactNode } from "react";

interface CardProps {
  title: string;
  description?: string;
  children: ReactNode;
}

export function Card({ title, description, children }: CardProps) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-inner shadow-slate-950/40">
      <header className="space-y-1">
        <h3 className="text-lg font-semibold text-teal-300">{title}</h3>
        {description ? <p className="text-xs text-slate-400">{description}</p> : null}
      </header>
      <div className="mt-3 text-sm text-slate-100">{children}</div>
    </div>
  );
}
