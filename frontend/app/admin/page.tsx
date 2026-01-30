"use client";

import { useQuery } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useTierGuard } from "@/hooks/useTierGuard";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useLocaleStore } from "@/store/useLocaleStore";

export default function AdminPage() {
  const locale = useLocaleStore((state) => state.locale);
  const hasAccess = useTierGuard("pro");
  const token = useAuthStore((state) => state.token);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: robotCloudApi.fetchAdminUsers,
    enabled: hasAccess && Boolean(token)
  });
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "后台管理",
        subtitle: "查看平台用户、套餐与活跃度，辅助运维决策。",
        restrictedMessage: "仅管理员可访问，请联系平台运营开通权限。",
        loginPrompt: "请登录后查看管理员数据。",
        loginLink: "前往登录",
        loading: "加载中...",
        role: (role: string) => `角色：${role}`,
        createdAt: (value: string) => `创建时间：${value}`,
        empty: "暂无用户数据。"
      }
    : {
        title: "Admin Console",
        subtitle: "Review users, plans, and activity to support operations.",
        restrictedMessage: "Admins only. Contact operations to enable access.",
        loginPrompt: "Log in to view admin data.",
        loginLink: "Go to login",
        loading: "Loading...",
        role: (role: string) => `Role: ${role}`,
        createdAt: (value: string) => `Created at: ${value}`,
        empty: "No user data yet."
      };

  if (!hasAccess) {
    return (
      <main className="space-y-4">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.restrictedMessage}</p>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-muted">{copy.subtitle}</p>
      </header>
      {!token ? (
        <p className="text-sm text-muted">
          {copy.loginPrompt}
          <Link href="/login" className="ml-1 accent-text hover:opacity-80">
            {copy.loginLink}
          </Link>
        </p>
      ) : null}
      {token && isLoading ? <p>{copy.loading}</p> : null}
      {token && error instanceof Error ? <p className="text-red-500">{error.message}</p> : null}
      {token ? (
        <div className="space-y-3">
          {data?.map((user) => (
            <Card key={user.id} title={user.phone} description={copy.role(user.role)}>
              <p className="text-xs text-muted">{copy.createdAt(new Date(user.createdAt).toLocaleString())}</p>
            </Card>
          ))}
          {!data?.length ? <p className="text-sm text-muted">{copy.empty}</p> : null}
        </div>
      ) : null}
    </main>
  );
}
