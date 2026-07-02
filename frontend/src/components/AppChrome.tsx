"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ComponentType, ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { Logo } from "@/components/Logo";
import { getSections } from "@/components/shell/sections";
import { useDesktopBridgeAvailable } from "@/hooks/useDesktopBridgeAvailable";
import { useLocaleStore } from "@/store/useLocaleStore";
import { useThemeStore } from "@/store/useThemeStore";

interface AppChromeProps {
  children: ReactNode;
}

type NavIconProps = {
  active: boolean;
  className?: string;
};

const SIDEBAR_COLLAPSED_STORAGE_KEY = "robotcloud-sidebar-collapsed";
const subscribeToHydration = () => () => {};
const getSidebarCollapsedSnapshot = () =>
  typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";

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
      <circle cx="12" cy="12" r="5" />
      <line x1="12" y1="1" x2="12" y2="3" />
      <line x1="12" y1="21" x2="12" y2="23" />
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
      <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
      <line x1="1" y1="12" x2="3" y2="12" />
      <line x1="21" y1="12" x2="23" y2="12" />
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
      <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
    </svg>
  );
}

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="4.5" y="5" width="15" height="14" rx="3" strokeWidth="1.9" />
      <path strokeLinecap="round" strokeWidth="1.9" d="M10 7.5v9" />
    </svg>
  );
}

function DashboardIcon({ active, className }: NavIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M4 13.5h6.5V20H4v-6.5Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M13.5 4H20v16h-6.5V4Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M4 4h6.5v6.5H4V4Z" />
    </svg>
  );
}

function DatabaseIcon({ active, className }: NavIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M5 7c0-1.66 3.13-3 7-3s7 1.34 7 3-3.13 3-7 3-7-1.34-7-3Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M5 7v5c0 1.66 3.13 3 7 3s7-1.34 7-3V7" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M5 12v5c0 1.66 3.13 3 7 3s7-1.34 7-3v-5" />
    </svg>
  );
}

function TrainingIcon({ active, className }: NavIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="6" y="6" width="12" height="12" rx="2.5" strokeWidth={active ? 2.35 : 1.9} />
      <path strokeLinecap="round" strokeWidth={active ? 2.35 : 1.9} d="M9 2.5v2.2M15 2.5v2.2M9 19.3v2.2M15 19.3v2.2M2.5 9h2.2M2.5 15h2.2M19.3 9h2.2M19.3 15h2.2" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="m12.8 8.5-3 4.2h3.1l-1.7 3.8 4-4.9h-3.1l.7-3.1Z" />
    </svg>
  );
}

function ModelsIcon({ active, className }: NavIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="m4 12 8 4.5 8-4.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="m4 16.5 8 4.5 8-4.5" />
    </svg>
  );
}

function InferenceIcon({ active, className }: NavIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M4 12h4l2-5 4 10 2-5h4" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M5 5.5A9 9 0 0 1 19 18.5" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M19 18.5h-4.5M19 18.5V14" />
    </svg>
  );
}

function SettingsIcon({ active, className }: NavIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M10.3 4.3c.4-1.7 2.9-1.7 3.4 0a1.8 1.8 0 0 0 2.6 1.1c1.5-.9 3.2.8 2.3 2.3a1.8 1.8 0 0 0 1.1 2.6c1.7.4 1.7 2.9 0 3.4a1.8 1.8 0 0 0-1.1 2.6c.9 1.5-.8 3.2-2.3 2.3a1.8 1.8 0 0 0-2.6 1.1c-.4 1.7-2.9 1.7-3.4 0a1.8 1.8 0 0 0-2.6-1.1c-1.5.9-3.2-.8-2.3-2.3a1.8 1.8 0 0 0-1.1-2.6c-1.7-.4-1.7-2.9 0-3.4a1.8 1.8 0 0 0 1.1-2.6c-.9-1.5.8-3.2 2.3-2.3a1.8 1.8 0 0 0 2.6-1.1Z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </svg>
  );
}

function PlansIcon({ active, className }: NavIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="4" y="5.5" width="16" height="13" rx="2.5" strokeWidth={active ? 2.35 : 1.9} />
      <path strokeLinecap="round" strokeWidth={active ? 2.35 : 1.9} d="M4 10h16M8 15h3" />
    </svg>
  );
}

function RobotIcon({ active, className }: NavIconProps) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeWidth={active ? 2.35 : 1.9} d="M12 4V2.5" />
      <rect x="6" y="5" width="12" height="9" rx="3" strokeWidth={active ? 2.35 : 1.9} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={active ? 2.35 : 1.9} d="M8 17h8M9 14v5M15 14v5" />
      <path strokeLinecap="round" strokeWidth={active ? 2.35 : 1.9} d="M9.5 9.5h.01M14.5 9.5h.01" />
    </svg>
  );
}

const iconByHref: Record<string, ComponentType<NavIconProps>> = {
  "/so101": RobotIcon,
  "/datasets": DatabaseIcon,
  "/train": TrainingIcon,
  "/models": ModelsIcon,
  "/inference": InferenceIcon,
  "/dashboard": DashboardIcon,
  "/settings": SettingsIcon,
  "/plans": PlansIcon
};

function isActiveRoute(pathname: string, href: string) {
  if (pathname === "/" && href === "/dashboard") {
    return true;
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppChrome({ children }: AppChromeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const storedSidebarCollapsed = useSyncExternalStore(subscribeToHydration, getSidebarCollapsedSnapshot, () => false);
  const [sidebarCollapsedOverride, setSidebarCollapsedOverride] = useState<boolean | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isSidebarCollapsed = sidebarCollapsedOverride ?? storedSidebarCollapsed;
  const iconRailClassName = "flex h-10 w-[52px] shrink-0 items-center justify-center";

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
  const isDesktopBridgeAvailable = useDesktopBridgeAvailable();
  const navItems = getSections(locale, { includeDesktopOnly: isDesktopBridgeAvailable });
  const activeSection = navItems.find((item) => isActiveRoute(pathname, item.href));

  const copy = {
    homeAria: isZh ? "RobotCloud 控制面板" : "RobotCloud workspace",
    login: isZh ? "登录" : "Log in",
    logout: isZh ? "退出登录" : "Log out",
    settings: isZh ? "设置" : "Settings",
    account: isZh ? "账号" : "Account",
    workspace: isZh ? "工作区" : "Workspace",
    lightMode: isZh ? "浅色" : "Light",
    darkMode: isZh ? "深色" : "Dark",
    copyright: isZh
      ? "© 2025-2026 LoveMoon Ltd. 保留所有权利。"
      : "© 2025-2026 LoveMoon Ltd. All rights reserved."
  };

  const sidebarToggleCopy = isZh
    ? {
        collapse: "收起侧边栏",
        expand: "展开侧边栏"
      }
    : {
        collapse: "Collapse sidebar",
        expand: "Expand sidebar"
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

  const toggleSidebarCollapsed = useCallback(() => {
    const next = !isSidebarCollapsed;
    setSidebarCollapsedOverride(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
    }
  }, [isSidebarCollapsed]);

  return (
    <div className="min-h-screen bg-surface text-body">
      <div className="flex min-h-screen">
        <aside
          className={`hidden h-screen shrink-0 flex-col border-r border-theme bg-card transition-[width] duration-200 motion-reduce:transition-none md:sticky md:top-0 md:flex ${
            isSidebarCollapsed ? "w-[68px]" : "w-64"
          }`}
          data-collapsed={isSidebarCollapsed ? "true" : "false"}
          aria-label="Workspace sidebar"
        >
          <div className="group/sidebar relative flex h-16 items-center border-b border-theme px-2">
            <Link
              href="/dashboard"
              className={`${iconRailClassName} rounded-xl transition-opacity hover:opacity-80 ${
                isSidebarCollapsed ? "cursor-ew-resize group-hover/sidebar:opacity-0" : ""
              }`}
              aria-label={copy.homeAria}
              title={copy.homeAria}
            >
              <Logo className="h-8 w-8 shrink-0" />
            </Link>

            {!isSidebarCollapsed ? (
              <>
                <span className="min-w-0 flex-1 truncate text-lg font-semibold text-body">RobotCloud</span>
                <button
                  type="button"
                  aria-label={sidebarToggleCopy.collapse}
                  aria-controls="robotcloud-sidebar-primary-nav"
                  aria-expanded
                  title={sidebarToggleCopy.collapse}
                  onClick={toggleSidebarCollapsed}
                  className="inline-flex h-10 w-10 shrink-0 cursor-ew-resize items-center justify-center rounded-xl text-body transition hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
                >
                  <SidebarToggleIcon className="h-5 w-5" />
                </button>
              </>
            ) : (
              <button
                type="button"
                aria-label={sidebarToggleCopy.expand}
                aria-controls="robotcloud-sidebar-primary-nav"
                aria-expanded={false}
                title={sidebarToggleCopy.expand}
                onClick={toggleSidebarCollapsed}
                className={`pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 cursor-ew-resize rounded-xl text-body opacity-0 transition-opacity group-hover/sidebar:pointer-events-auto group-hover/sidebar:opacity-100 focus:pointer-events-auto focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary/30 ${iconRailClassName}`}
              >
                <SidebarToggleIcon className="h-5 w-5" />
              </button>
            )}
          </div>

          <nav id="robotcloud-sidebar-primary-nav" aria-label="Primary navigation" className="flex-1 overflow-y-auto px-2 py-4">
            <div className="space-y-1">
              {navItems.map((item) => {
                const active = isActiveRoute(pathname, item.href);
                const Icon = iconByHref[item.href] ?? DashboardIcon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-label={item.title}
                    aria-current={active ? "page" : undefined}
                    title={isSidebarCollapsed ? item.title : item.description}
                    className={`group/nav relative flex min-h-11 items-center rounded-lg text-sm transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                      active
                        ? "bg-surface-secondary text-body"
                        : "text-muted hover:bg-surface-secondary hover:text-body"
                    } ${isSidebarCollapsed ? "justify-center" : "gap-3 px-3 py-2"}`}
                  >
                    <span className={`${isSidebarCollapsed ? iconRailClassName : "flex h-8 w-8 shrink-0 items-center justify-center"} rounded-md border border-theme bg-card transition group-hover/nav:scale-105 group-hover/nav:border-primary`}>
                      <Icon active={active} className={`h-5 w-5 transition-transform ${active ? "scale-110" : ""}`} />
                    </span>
                    {!isSidebarCollapsed ? (
                      <>
                        <span className={`min-w-0 flex-1 truncate ${active ? "font-semibold" : "font-medium"}`}>{item.title}</span>
                        {active ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-theme-primary" aria-hidden /> : null}
                      </>
                    ) : active ? (
                      <span className="absolute right-2 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-theme-primary" aria-hidden />
                    ) : null}
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className={`border-t border-theme py-4 ${isSidebarCollapsed ? "px-2" : "px-4"}`}>
            {!isSidebarCollapsed ? <p className="text-xs leading-relaxed text-muted">{copy.copyright}</p> : null}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 border-b border-theme bg-header backdrop-blur">
            <div className="flex h-16 items-center gap-4 px-4 md:px-6">
              <Link href="/dashboard" className="flex items-center gap-2 transition hover:opacity-80 md:hidden" aria-label={copy.homeAria}>
                <Logo className="h-8 w-8" />
                <span className="text-base font-semibold text-body">RobotCloud</span>
              </Link>

              <div className="hidden min-w-0 md:block">
                <p className="text-xs uppercase tracking-[0.16em] text-muted">{copy.workspace}</p>
                <p className="truncate text-lg font-semibold text-body">{activeSection?.title ?? "RobotCloud"}</p>
              </div>

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={toggleLocale}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-theme bg-card text-xs font-semibold text-body transition hover:border-primary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  aria-label={isZh ? "Switch to English" : "切换到中文"}
                  title={isZh ? "English" : "中文"}
                >
                  {isZh ? "EN" : "中"}
                </button>

                <button
                  type="button"
                  onClick={toggleTheme}
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-theme bg-card text-body transition hover:border-primary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
                  aria-label={isDark ? copy.lightMode : copy.darkMode}
                  title={isDark ? copy.lightMode : copy.darkMode}
                >
                  {isDark ? <SunIcon className="h-[18px] w-[18px]" /> : <MoonIcon className="h-[18px] w-[18px]" />}
                </button>

                <div className="relative" ref={dropdownRef}>
                  {phone ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setIsOpen(!isOpen)}
                        className="flex items-center gap-2 rounded-full border border-theme bg-card px-2 py-1 transition hover:border-primary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
                        aria-expanded={isOpen}
                        aria-haspopup="true"
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-secondary text-sm font-semibold text-body">
                          {initials}
                        </span>
                        <ChevronDownIcon
                          className={`hidden text-muted transition-transform duration-200 sm:block ${isOpen ? "rotate-180" : ""}`}
                        />
                      </button>

                      {isOpen && (
                        <div className="absolute right-0 top-full mt-2 w-56 rounded-lg border border-theme bg-card py-2 shadow-xl">
                          <div className="border-b border-theme px-4 py-3">
                            <p className="text-xs text-muted">{copy.account}</p>
                            <p className="mt-1 text-sm text-body">{phone}</p>
                          </div>

                          <div className="px-2 pt-2">
                            <Link
                              href="/settings"
                              onClick={() => setIsOpen(false)}
                              className="block w-full rounded-md px-3 py-2 text-left text-sm text-body transition hover:bg-surface-secondary"
                            >
                              {copy.settings}
                            </Link>
                            <button
                              type="button"
                              onClick={handleLogout}
                              className="w-full rounded-md px-3 py-2 text-left text-sm text-muted transition hover:bg-surface-secondary hover:text-body"
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
                      className="flex h-9 items-center justify-center rounded-full border border-theme bg-card px-4 text-sm font-medium text-body transition hover:border-primary hover:bg-surface-secondary focus:outline-none focus:ring-2 focus:ring-primary/30"
                    >
                      {copy.login}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </header>

          <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:px-8 md:pb-8">
            {children}
          </main>

        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-theme bg-header backdrop-blur md:hidden" aria-label="Primary navigation">
        <div className="flex h-[calc(4.5rem+env(safe-area-inset-bottom))] items-start gap-1 overflow-x-auto px-2 pb-[env(safe-area-inset-bottom)] pt-2">
          {navItems.map((item) => {
            const active = isActiveRoute(pathname, item.href);
            const Icon = iconByHref[item.href] ?? DashboardIcon;

            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`group/nav relative flex min-w-[4.75rem] flex-1 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                  active ? "text-body" : "text-muted hover:text-body"
                }`}
              >
                <span className={`flex h-8 w-8 items-center justify-center rounded-full transition group-hover/nav:bg-surface-secondary ${active ? "bg-surface-secondary" : ""}`}>
                  <Icon active={active} className={`h-5 w-5 transition-transform duration-200 ${active ? "scale-110" : "group-hover/nav:scale-105"}`} />
                </span>
                <span className={`max-w-full truncate leading-none ${active ? "font-semibold" : "font-medium"}`}>{item.title}</span>
                {active ? <span className="absolute bottom-0 h-1 w-1 rounded-full bg-theme-primary" aria-hidden /> : null}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
