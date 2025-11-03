"use client";

import Link from "next/link";
import { getSections } from "@/components/shell/sections";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function HomePage() {
  const locale = useLocaleStore((state) => state.locale);
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "RobotCloud 控制面板",
        description: "管理数据、训练模型并连接仿真与硬件资源的统一入口。",
        enter: "进入 →"
      }
    : {
        title: "RobotCloud Control Panel",
        description: "Manage datasets, train models, and bridge simulation with hardware from one workspace.",
        enter: "Open →"
      };
  const sections = getSections(locale);

  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold">{copy.title}</h1>
        <p className="text-slate-300">{copy.description}</p>
      </header>
      <section className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg transition hover:border-teal-400 hover:shadow-teal-500/20"
          >
            <h2 className="text-2xl font-semibold text-teal-300">{section.title}</h2>
            <p className="mt-2 text-sm text-slate-300">{section.description}</p>
            <span className="mt-4 inline-block text-sm text-teal-400">{copy.enter}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
