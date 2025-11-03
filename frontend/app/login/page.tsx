"use client";

import { useForm } from "react-hook-form";
import { useState } from "react";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { AuthCredentials } from "@/types";
import Link from "next/link";

export default function LoginPage() {
  const form = useForm<AuthCredentials>({
    defaultValues: { phone: "", password: "" }
  });
  const setAuth = useAuthStore((state) => state.setAuth);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setMessage(null);
    try {
      const result = await robotCloudApi.loginWithPassword(values);
      setAuth(result);
      setMessage(`欢迎回来，${result.phone}！`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "登录失败");
    }
  });

  return (
    <main className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">手机号登录</h1>
        <p className="text-sm text-slate-300">支持密码或验证码登录，保障账号安全。</p>
      </header>
      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <label className="block space-y-1 text-sm">
          <span className="text-slate-300">手机号</span>
          <input
            {...form.register("phone", { required: "请输入手机号" })}
            className="w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            placeholder="例如：13800001234"
          />
          {form.formState.errors.phone ? (
            <span className="text-xs text-red-400">{form.formState.errors.phone.message}</span>
          ) : null}
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-300">密码</span>
          <input
            type="password"
            {...form.register("password", { required: "请输入密码" })}
            className="w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            placeholder="至少 8 位字符"
          />
          {form.formState.errors.password ? (
            <span className="text-xs text-red-400">{form.formState.errors.password.message}</span>
          ) : null}
        </label>
        <button
          type="submit"
          className="w-full rounded-md bg-teal-500 py-2 font-semibold text-slate-950 transition hover:bg-teal-400"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? "登录中..." : "登录"}
        </button>
        {message ? <p className="text-sm text-teal-300">{message}</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </form>
      <footer className="text-center text-xs text-slate-500">
        还没有账号？ <Link href="/" className="text-teal-300 hover:text-teal-200">了解平台功能</Link>
      </footer>
    </main>
  );
}
