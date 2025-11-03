"use client";

import Link from "next/link";
import { ReactNode, useEffect } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { Logo } from "@/components/Logo";
import { LanguageToggle } from "@/components/LanguageToggle";
import { useLocaleStore } from "@/store/useLocaleStore";

interface AppChromeProps {
  children: ReactNode;
}

export function AppChrome({ children }: AppChromeProps) {
  const locale = useLocaleStore((state) => state.locale);
  const { phone } = useAuthStore((state) => ({
    phone: state.phone
  }));
  const isZh = locale === "zh";
  const initials = phone ? phone.slice(-2) : "";
  const copy = {
    homeAria: isZh ? "RobotCloud 首页" : "RobotCloud Home",
    login: isZh ? "登录" : "Log in"
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 transition hover:opacity-90" aria-label={copy.homeAria}>
            <Logo />
            <span className="text-lg font-semibold text-transparent bg-gradient-to-r from-teal-200 via-teal-300 to-sky-400 bg-clip-text">
              RobotCloud
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <LanguageToggle />
            {phone ? (
              <div className="flex items-center gap-3">
                <span className="hidden text-sm text-slate-300 md:inline">{phone}</span>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-500/20 text-sm font-semibold text-teal-200">
                  {initials}
                </div>
              </div>
            ) : (
              <Link href="/login" className="text-sm text-teal-300 transition hover:text-teal-100">
                {copy.login}
              </Link>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}
