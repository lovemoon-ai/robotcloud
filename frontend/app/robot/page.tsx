"use client";

import Link from "next/link";
import { desktopAwareHref } from "@/desktop/navigation";
import { useDesktopBridgeAvailable } from "@/hooks/useDesktopBridgeAvailable";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function RobotPage() {
  const locale = useLocaleStore((state) => state.locale);
  const isDesktopBridgeAvailable = useDesktopBridgeAvailable();
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "Robot",
        so101Description: "本地配置、校准、遥操作、录制与终端命令。",
        open: "打开"
      }
    : {
        title: "Robot",
        so101Description: "Local setup, calibration, teleoperation, recording, and terminal commands.",
        open: "Open"
      };

  return (
    <main className="space-y-5">
      <header>
        <h1 className="text-3xl font-bold text-body">{copy.title}</h1>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Link
          href={desktopAwareHref("/so101", isDesktopBridgeAvailable)}
          className="group rounded-lg border border-theme bg-card p-5 transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/30"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-xl font-semibold accent-text">SO101</h2>
              <p className="mt-2 text-sm text-muted">{copy.so101Description}</p>
            </div>
            <span className="rounded-md border border-theme px-3 py-1.5 text-sm font-semibold accent-text transition group-hover:border-primary">
              {copy.open}
            </span>
          </div>
        </Link>
      </section>
    </main>
  );
}
