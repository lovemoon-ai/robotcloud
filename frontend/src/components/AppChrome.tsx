"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnchorHTMLAttributes, ComponentType, Fragment, ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAuthStore } from "@/store/useAuthStore";
import { Logo } from "@/components/Logo";
import { getSections } from "@/components/shell/sections";
import { useDesktopBridgeAvailable } from "@/hooks/useDesktopBridgeAvailable";
import { useLocaleStore } from "@/store/useLocaleStore";
import { desktopAwareHref, isExternalHref } from "@/desktop/navigation";

interface AppChromeProps {
  children: ReactNode;
}

type NavIconProps = {
  active: boolean;
  className?: string;
};

type RoutedLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  children: ReactNode;
};

const SIDEBAR_COLLAPSED_STORAGE_KEY = "robotcloud-sidebar-collapsed";
const subscribeToHydration = () => () => {};
const subscribeToAuthHydration = (listener: () => void) => {
  const unsubscribeHydrate = useAuthStore.persist.onHydrate(listener);
  const unsubscribeFinishHydration = useAuthStore.persist.onFinishHydration(listener);
  return () => {
    unsubscribeHydrate();
    unsubscribeFinishHydration();
  };
};
const getSidebarCollapsedSnapshot = () =>
  typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === "1";
const getAuthHydratedSnapshot = () => useAuthStore.persist.hasHydrated();

function RoutedLink({ href, children, ...props }: RoutedLinkProps) {
  if (isExternalHref(href)) {
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} {...props}>
      {children}
    </Link>
  );
}

function normalizeAppPathname(pathname: string | null) {
  if (!pathname) return "/";
  return pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
}

function SidebarToggleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <rect x="4.5" y="5" width="15" height="14" rx="3" strokeWidth="1.9" />
      <path strokeLinecap="round" strokeWidth="1.9" d="M10 7.5v9" />
    </svg>
  );
}

function RefreshIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" d="M20 11a8 8 0 0 0-14.12-4.5M4 5v4h4" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" d="M4 13a8 8 0 0 0 14.12 4.5M20 19v-4h-4" />
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
  "/robot": RobotIcon,
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

type NavItem = ReturnType<typeof getSections>[number];

function isActiveNavItem(pathname: string, item: NavItem) {
  return isActiveRoute(pathname, item.href) || Boolean(item.children?.some((child) => isActiveRoute(pathname, child.href)));
}

const mobileNavPairs = [
  { primaryHref: "/datasets", secondaryHref: "/models" },
  { primaryHref: "/train", secondaryHref: "/inference" }
] as const;

type MobileNavEntry = {
  active: boolean;
  backItem?: NavItem;
  displayItem: NavItem;
  flipped: boolean;
  frontItem: NavItem;
  href: string;
  key: string;
  targetItem: NavItem;
};

function getMobileNavEntries(navItems: readonly NavItem[], pathname: string): MobileNavEntry[] {
  const itemByHref = new Map(navItems.map((item) => [item.href, item]));

  return navItems.flatMap((item): MobileNavEntry[] => {
    const primaryPair = mobileNavPairs.find((pair) => pair.primaryHref === item.href);
    if (primaryPair) {
      const secondaryItem = itemByHref.get(primaryPair.secondaryHref);
      if (!secondaryItem) {
        const active = isActiveNavItem(pathname, item);
        return [
          {
            active,
            displayItem: item,
            flipped: false,
            frontItem: item,
            href: item.href,
            key: item.href,
            targetItem: item
          }
        ];
      }

      const primaryActive = isActiveNavItem(pathname, item);
      const secondaryActive = isActiveNavItem(pathname, secondaryItem);
      const flipped = secondaryActive;
      const href = primaryActive ? secondaryItem.href : item.href;
      const targetItem = primaryActive ? secondaryItem : item;

      return [
        {
          active: primaryActive || secondaryActive,
          backItem: secondaryItem,
          displayItem: flipped ? secondaryItem : item,
          flipped,
          frontItem: item,
          href,
          key: `${item.href}:${secondaryItem.href}`,
          targetItem
        }
      ];
    }

    if (mobileNavPairs.some((pair) => pair.secondaryHref === item.href)) {
      return [];
    }

    const active = isActiveNavItem(pathname, item);
    return [
      {
        active,
        displayItem: item,
        flipped: false,
        frontItem: item,
        href: item.href,
        key: item.href,
        targetItem: item
      }
    ];
  });
}

function MobileNavFace({
  active,
  ariaHidden,
  item
}: {
  active: boolean;
  ariaHidden?: boolean;
  item: NavItem;
}) {
  const Icon = iconByHref[item.href] ?? DashboardIcon;

  return (
    <span aria-hidden={ariaHidden || undefined} className="flex h-full w-full flex-col items-center gap-1">
      <span className={`flex h-8 w-8 items-center justify-center rounded-full transition ${active ? "bg-surface-secondary" : ""}`}>
        <Icon active={active} className={`h-5 w-5 transition-transform duration-200 ${active ? "scale-110" : "group-hover/nav:scale-105"}`} />
      </span>
      <span className={`max-w-full truncate leading-none ${active ? "font-semibold" : "font-medium"}`}>{item.title}</span>
    </span>
  );
}

export function AppChrome({ children }: AppChromeProps) {
  const router = useRouter();
  const pathname = usePathname();
  const storedSidebarCollapsed = useSyncExternalStore(subscribeToHydration, getSidebarCollapsedSnapshot, () => false);
  const authHydrated = useSyncExternalStore(subscribeToAuthHydration, getAuthHydratedSnapshot, () => true);
  const [authStorageChecked, setAuthStorageChecked] = useState(false);
  const [sidebarCollapsedOverride, setSidebarCollapsedOverride] = useState<boolean | null>(null);
  const isSidebarCollapsed = sidebarCollapsedOverride ?? storedSidebarCollapsed;
  const iconRailClassName = "flex h-10 w-[52px] shrink-0 items-center justify-center";

  const locale = useLocaleStore((state) => state.locale);
  const token = useAuthStore((state) => state.token);
  const restoreAuthFromStorage = useAuthStore((state) => state.restoreFromStorage);
  const restoreAuthFromDesktopBridge = useAuthStore((state) => state.restoreFromDesktopBridge);

  const isZh = locale === "zh";
  const normalizedPathname = normalizeAppPathname(pathname);
  const isLoginRoute = normalizedPathname === "/login";
  const authReady = authHydrated && authStorageChecked;
  const isDesktopBridgeAvailable = useDesktopBridgeAvailable();
  const navItems = getSections(locale, { includeDesktopOnly: isDesktopBridgeAvailable });
  const mobileNavItems = getMobileNavEntries(navItems, pathname);
  const homeHref = desktopAwareHref("/dashboard", isDesktopBridgeAvailable);
  const wideContent = normalizedPathname === "/so101" || normalizedPathname.startsWith("/so101/");

  const copy = {
    homeAria: isZh ? "RobotCloud 控制面板" : "RobotCloud workspace",
    copyright: isZh
      ? "© 2025-2026 LoveMoon Ltd. 保留所有权利。"
      : "© 2025-2026 LoveMoon Ltd. All rights reserved.",
    switchTo: isZh ? "切换到" : "Switch to",
    refresh: isZh ? "刷新页面" : "Refresh page"
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
    if (isLoginRoute || token) {
      setAuthStorageChecked(true);
      return;
    }

    let cancelled = false;
    setAuthStorageChecked(false);
    Promise.resolve(useAuthStore.persist.rehydrate())
      .then(async () => {
        if (!useAuthStore.getState().token) {
          const restored = restoreAuthFromStorage();
          if (!restored) {
            await restoreAuthFromDesktopBridge();
          }
        }
      })
      .catch(async () => {
        const restored = restoreAuthFromStorage();
        if (!restored) {
          await restoreAuthFromDesktopBridge();
        }
      })
      .finally(() => {
        if (!cancelled) {
          setAuthStorageChecked(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isLoginRoute, pathname, restoreAuthFromDesktopBridge, restoreAuthFromStorage, token]);

  useEffect(() => {
    if (authReady && !token && !isLoginRoute) {
      const next = pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : "";
      const loginHref = desktopAwareHref(`/login${next}`, false);
      if (isExternalHref(loginHref)) {
        window.location.assign(loginHref);
      } else {
        router.replace(loginHref);
      }
    }
  }, [authReady, isLoginRoute, pathname, router, token]);

  const handleRefreshPage = useCallback(() => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  }, []);

  const toggleSidebarCollapsed = useCallback(() => {
    const next = !isSidebarCollapsed;
    setSidebarCollapsedOverride(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? "1" : "0");
    }
  }, [isSidebarCollapsed]);

  if (isLoginRoute) {
    return <div className="min-h-screen bg-surface text-body">{children}</div>;
  }

  if (!authReady || !token) {
    return <div className="min-h-screen bg-surface text-body" aria-hidden="true" />;
  }

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
            <RoutedLink
              href={homeHref}
              className={`${iconRailClassName} rounded-xl transition-opacity hover:opacity-80 ${
                isSidebarCollapsed ? "cursor-ew-resize group-hover/sidebar:opacity-0" : ""
              }`}
              aria-label={copy.homeAria}
              title={copy.homeAria}
            >
              <Logo className="h-8 w-8 shrink-0" />
            </RoutedLink>

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
                const current = isActiveRoute(pathname, item.href);
                const active = isActiveNavItem(pathname, item);
                const Icon = iconByHref[item.href] ?? DashboardIcon;
                const href = desktopAwareHref(item.href, isDesktopBridgeAvailable);

                return (
                  <Fragment key={item.href}>
                    <RoutedLink
                      href={href}
                      aria-label={item.title}
                      aria-current={current ? "page" : undefined}
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
                        <span className={`min-w-0 flex-1 truncate ${active ? "font-semibold" : "font-medium"}`}>{item.title}</span>
                      ) : null}
                    </RoutedLink>

                    {!isSidebarCollapsed && item.children?.length && active ? (
                      <div className="ml-11 mt-1 space-y-1 border-l border-theme pl-3">
                        {item.children.map((child) => {
                          const childActive = isActiveRoute(pathname, child.href);
                          const childHref = desktopAwareHref(child.href, isDesktopBridgeAvailable);
                          return (
                            <RoutedLink
                              key={child.href}
                              href={childHref}
                              aria-current={childActive ? "page" : undefined}
                              title={child.description}
                              className={`block rounded-md px-3 py-2 text-sm transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                                childActive
                                  ? "bg-surface-secondary font-semibold text-body"
                                  : "text-muted hover:bg-surface-secondary hover:text-body"
                              }`}
                            >
                              {child.title}
                            </RoutedLink>
                          );
                        })}
                      </div>
                    ) : null}
                  </Fragment>
                );
              })}
            </div>
          </nav>

          <div className={`border-t border-theme py-4 ${isSidebarCollapsed ? "px-2" : "px-4"}`}>
            <div className={`flex items-center ${isSidebarCollapsed ? "justify-center" : "gap-3"}`}>
              <button
                type="button"
                onClick={handleRefreshPage}
                aria-label={copy.refresh}
                title={copy.refresh}
                className={`${
                  isSidebarCollapsed ? iconRailClassName : "flex h-9 w-9 shrink-0 items-center justify-center"
                } rounded-lg border border-theme bg-card text-muted transition hover:border-primary hover:bg-surface-secondary hover:text-body focus:outline-none focus:ring-2 focus:ring-primary/30`}
              >
                <RefreshIcon className="h-5 w-5" />
              </button>
              {!isSidebarCollapsed ? (
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted">{copy.copyright}</p>
              ) : null}
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <main className={`mx-auto w-full flex-1 py-6 pb-[calc(5.75rem+env(safe-area-inset-bottom))] md:pb-8 ${
            wideContent ? "max-w-none px-2 md:px-3" : "max-w-6xl px-4 md:px-8"
          }`}>
            {children}
          </main>

        </div>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-theme bg-header backdrop-blur md:hidden" aria-label="Primary navigation">
        <div className="flex h-[calc(4.5rem+env(safe-area-inset-bottom))] items-start gap-1 overflow-x-auto px-2 pb-[env(safe-area-inset-bottom)] pt-2">
          {mobileNavItems.map((item) => {
            const targetIsCurrent = isActiveRoute(pathname, item.href);
            const isToggleLink = item.href !== item.displayItem.href;
            const linkLabel = isToggleLink ? `${copy.switchTo} ${item.targetItem.title}` : item.displayItem.title;
            const linkTitle = isToggleLink ? linkLabel : item.displayItem.description;
            const href = desktopAwareHref(item.href, isDesktopBridgeAvailable);

            return (
              <RoutedLink
                key={item.key}
                href={href}
                aria-label={linkLabel}
                aria-current={targetIsCurrent ? "page" : undefined}
                data-flipped={item.flipped ? "true" : "false"}
                title={linkTitle}
                className={`group/nav relative flex min-w-[4.75rem] flex-1 flex-col items-center gap-1 rounded-lg px-2 py-1.5 text-xs transition focus:outline-none focus:ring-2 focus:ring-primary/30 ${
                  item.active ? "text-body" : "text-muted hover:text-body"
                }`}
              >
                <span className="relative flex h-12 w-full items-center justify-center [perspective:700px]">
                  <span
                    className={`relative h-full w-full transition-transform duration-300 [transform-style:preserve-3d] motion-reduce:transition-none ${
                      item.flipped ? "[transform:rotateY(180deg)]" : ""
                    }`}
                  >
                    <span className="absolute inset-0 [backface-visibility:hidden]">
                      <MobileNavFace active={item.active && !item.flipped} ariaHidden={item.flipped} item={item.frontItem} />
                    </span>
                    {item.backItem ? (
                      <span className="absolute inset-0 [backface-visibility:hidden] [transform:rotateY(180deg)]">
                        <MobileNavFace active={item.active && item.flipped} ariaHidden={!item.flipped} item={item.backItem} />
                      </span>
                    ) : null}
                  </span>
                </span>
              </RoutedLink>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
