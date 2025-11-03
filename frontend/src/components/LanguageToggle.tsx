"use client";

import { useLocaleStore } from "@/store/useLocaleStore";

export function LanguageToggle() {
  const { locale, toggleLocale } = useLocaleStore((state) => ({
    locale: state.locale,
    toggleLocale: state.toggleLocale
  }));
  const isZh = locale === "zh";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={locale === "en"}
      aria-label={isZh ? "切换到英文界面" : "Switch to Chinese interface"}
      onClick={toggleLocale}
      className="flex items-center gap-2 rounded-full border border-slate-700/80 bg-slate-900/60 px-3 py-1 text-[12px] font-semibold uppercase tracking-wide text-slate-400 transition hover:border-teal-400 focus:outline-none focus:ring-2 focus:ring-teal-400/40"
    >
      <span className={isZh ? "text-teal-200" : "text-slate-500"}>中</span>
      <span className="relative inline-flex h-6 w-12 items-center rounded-full bg-slate-800/80">
        <span
          className={`absolute left-1 top-1 h-4 w-5 rounded-full bg-teal-400 transition-transform ${isZh ? "" : "translate-x-5"}`}
        />
      </span>
      <span className={!isZh ? "text-teal-200" : "text-slate-500"}>EN</span>
    </button>
  );
}
