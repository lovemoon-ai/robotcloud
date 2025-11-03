"use client";

import { useQuery } from "@tanstack/react-query";
import { robotCloudApi } from "@/api/client";
import { Card } from "@/components/ui/Card";
import { useTierGuard } from "@/hooks/useTierGuard";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";

export default function AdminPage() {
  const hasAccess = useTierGuard("pro");
  const token = useAuthStore((state) => state.token);
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-users"],
    queryFn: robotCloudApi.fetchAdminUsers,
    enabled: hasAccess && Boolean(token)
  });

  if (!hasAccess) {
    return (
      <main className="space-y-4">
        <h1 className="text-3xl font-bold">后台管理</h1>
        <p className="text-sm text-slate-300">仅管理员可访问，请联系平台运营开通权限。</p>
      </main>
    );
  }

  return (
    <main className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold">后台管理</h1>
        <p className="text-sm text-slate-300">查看平台用户、套餐与活跃度，辅助运维决策。</p>
      </header>
      {!token ? (
        <p className="text-sm text-slate-400">
          请登录后查看管理员数据。
          <Link href="/login" className="ml-1 text-teal-300 hover:text-teal-200">
            前往登录
          </Link>
        </p>
      ) : null}
      {token && isLoading ? <p>加载中...</p> : null}
      {token && error instanceof Error ? <p className="text-red-400">{error.message}</p> : null}
      {token ? (
        <div className="space-y-3">
          {data?.map((user) => (
            <Card key={user.id} title={user.phone} description={`角色：${user.role}`}>
              <p className="text-xs text-slate-300">创建时间：{new Date(user.createdAt).toLocaleString()}</p>
            </Card>
          ))}
          {!data?.length ? <p className="text-sm text-slate-400">暂无用户数据。</p> : null}
        </div>
      ) : null}
    </main>
  );
}
