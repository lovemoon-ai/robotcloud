"use client";

import Link from "next/link";
import { ReactNode } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { Logo } from "@/components/Logo";

interface AppChromeProps {
  children: ReactNode;
}

export function AppChrome({ children }: AppChromeProps) {
  const { phone } = useAuthStore((state) => ({
    phone: state.phone
  }));

  const initials = phone ? phone.slice(-2) : "";

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 bg-slate-900/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-3 transition hover:opacity-90" aria-label="RobotCloud 首页">
            <Logo />
            <span className="text-lg font-semibold text-transparent bg-gradient-to-r from-teal-200 via-teal-300 to-sky-400 bg-clip-text">
              RobotCloud
            </span>
          </Link>
          {phone ? (
            <div className="flex items-center gap-3">
              <span className="hidden text-sm text-slate-300 md:inline">{phone}</span>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-teal-500/20 text-sm font-semibold text-teal-200">
                {initials}
              </div>
            </div>
          ) : (
            <Link href="/login" className="text-sm text-teal-300 transition hover:text-teal-100">
              登录
            </Link>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}
