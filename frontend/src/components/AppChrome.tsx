"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ReactNode, useEffect, useState, useRef } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { Logo } from "@/components/Logo";
import { useLocaleStore } from "@/store/useLocaleStore";
import { useThemeStore } from "@/store/useThemeStore";

interface AppChromeProps {
  children: ReactNode;
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M2.5 4.5L6 8L9.5 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/>
      <line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/>
      <line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
    </svg>
  );
}

export function AppChrome({ children }: AppChromeProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { locale, toggleLocale } = useLocaleStore((state) => ({
    locale: state.locale,
    toggleLocale: state.toggleLocale
  }));
  
  const { theme, toggleTheme } = useThemeStore((state) => ({
    theme: state.theme,
    toggleTheme: state.toggleTheme
  }));
  
  const { phone, reset } = useAuthStore((state) => ({
    phone: state.phone,
    reset: state.reset
  }));

  const isZh = locale === "zh";
  const isDark = theme === "dark";
  const initials = phone ? phone.slice(-2) : "";
  
  const copy = {
    homeAria: isZh ? "RobotCloud 首页" : "RobotCloud Home",
    login: isZh ? "登录" : "Log in",
    logout: isZh ? "退出登录" : "Log out",
    settings: isZh ? "设置" : "Settings",
    language: isZh ? "语言" : "Language",
    account: isZh ? "账号" : "Account",
    chinese: "中文",
    english: "English",
    theme: isZh ? "主题" : "Theme",
    lightMode: isZh ? "浅色" : "Light",
    darkMode: isZh ? "深色" : "Dark",
    copyright: isZh
      ? "© 2025-2026 LoveMoon Ltd. 保留所有权利。"
      : "© 2025-2026 LoveMoon Ltd. All rights reserved."
  };

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = () => {
    reset();
    setIsOpen(false);
    router.push("/login");
  };

  const handleLanguageChange = (newLocale: "zh" | "en") => {
    if (locale !== newLocale) {
      toggleLocale();
    }
    setIsOpen(false);
  };

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-theme backdrop-blur sticky top-0 z-50" style={{ backgroundColor: 'var(--color-header)' }}>
        <nav className="mx-auto max-w-6xl px-6">
          <div className="flex items-center justify-between py-4">
            <Link href="/" className="flex items-center gap-3 transition hover:opacity-90" aria-label={copy.homeAria}>
              <Logo />
              <span className="text-lg font-semibold gradient-text">
                RobotCloud
              </span>
            </Link>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleLocale}
                className="flex items-center justify-center w-9 h-9 rounded-full border border-theme accent-bg transition hover:opacity-80"
                aria-label={isZh ? "Switch to English" : "切换到中文"}
                title={isZh ? "English" : "中文"}
              >
                <span className="text-xs font-semibold accent-text">{isZh ? "EN" : "中"}</span>
              </button>

              <button
                type="button"
                onClick={toggleTheme}
                className="flex items-center justify-center w-9 h-9 rounded-full border border-theme accent-bg transition hover:opacity-80"
                aria-label={isDark ? copy.lightMode : copy.darkMode}
                title={isDark ? copy.darkMode : copy.lightMode}
              >
                {isDark ? (
                  <SunIcon className="accent-text" />
                ) : (
                  <MoonIcon className="accent-text" />
                )}
              </button>
              
              <div className="relative" ref={dropdownRef}>
                {phone ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setIsOpen(!isOpen)}
                      className="flex items-center gap-2 rounded-full border border-theme px-3 py-2 transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                      style={{ backgroundColor: 'var(--color-card)' }}
                      aria-expanded={isOpen}
                      aria-haspopup="true"
                    >
                      <div className="flex h-8 w-8 items-center justify-center rounded-full accent-bg accent-text text-sm font-semibold">
                        {initials}
                      </div>
                      <ChevronDownIcon
                        className={`text-muted transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                      />
                    </button>
                    
                    {isOpen && (
                      <div
                        className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-theme py-2 shadow-xl"
                        style={{ backgroundColor: 'var(--color-card)' }}
                      >
                        <div className="border-b border-theme px-4 py-3">
                          <p className="text-xs text-muted">{copy.account}</p>
                          <p className="mt-1 text-sm text-body">{phone}</p>
                        </div>

                        <div className="px-2 pt-2">
                          <Link
                            href="/settings"
                            onClick={() => setIsOpen(false)}
                            className="block w-full rounded-md px-3 py-2 text-left text-sm text-body transition hover:bg-primary/10"
                          >
                            {copy.settings}
                          </Link>
                          <button
                            type="button"
                            onClick={handleLogout}
                            className="w-full rounded-md px-3 py-2 text-left text-sm text-red-500 transition hover:bg-red-500/10"
                          >
                            {copy.logout}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <Link
                    href="/login"
                    className="flex items-center justify-center h-9 px-4 rounded-full border border-theme transition hover:border-primary focus:outline-none focus:ring-2 focus:ring-primary/40 text-sm accent-text"
                    style={{ backgroundColor: 'var(--color-card)' }}
                  >
                    {copy.login}
                  </Link>
                )}
              </div>
            </div>
          </div>
        </nav>
      </header>
      
      <main className="mx-auto max-w-6xl px-6 py-8">
        {children}
      </main>

      <footer className="border-t border-theme py-6">
        <p className="text-center text-sm text-muted">{copy.copyright}</p>
      </footer>
    </div>
  );
}
