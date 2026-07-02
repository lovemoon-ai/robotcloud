"use client";

import Link from "next/link";
import { getSections } from "@/components/shell/sections";
import { useDesktopBridgeAvailable } from "@/hooks/useDesktopBridgeAvailable";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function HomePage() {
  const locale = useLocaleStore((state) => state.locale);
  const isDesktop = useDesktopBridgeAvailable();
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "RobotCloud 控制面板",
        description: "管理数据、训练模型、云端推理的统一入口。",
        enter: "进入 →"
      }
    : {
        title: "RobotCloud Control Panel",
        description: "Manage datasets, train models, and remote inference from one workspace.",
        enter: "Open →"
      };
  const sections = getSections(locale, { includeDesktopOnly: isDesktop });

  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold text-body">{copy.title}</h1>
        <p className="text-muted">{copy.description}</p>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-xl border border-theme p-6 shadow-lg transition hover:border-primary hover:shadow-primary/20"
            style={{ backgroundColor: 'var(--color-card)' }}
          >
            <h2 className="text-2xl font-semibold accent-text">{section.title}</h2>
            <p className="mt-2 text-sm text-muted">{section.description}</p>
            <span className="mt-4 inline-block text-sm accent-text">{copy.enter}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
