import Link from "next/link";
import { sections } from "@/components/shell/sections";

export default function HomePage() {
  return (
    <main className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-4xl font-bold">RobotCloud 控制面板</h1>
        <p className="text-slate-300">
          管理数据、训练模型并连接仿真与硬件资源的统一入口。
        </p>
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
            <span className="mt-4 inline-block text-sm text-teal-400">进入 →</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
