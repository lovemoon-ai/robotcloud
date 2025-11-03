"use client";

import { useForm } from "react-hook-form";
import { useState } from "react";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { AuthCredentials } from "@/types";
import Link from "next/link";
import { useRouter } from "next/navigation";

type LoginFormValues = AuthCredentials & { invitationCode: string };

export default function LoginPage() {
  const form = useForm<LoginFormValues>({
    defaultValues: { phone: "", password: "", invitationCode: "" }
  });
  const setAuth = useAuthStore((state) => state.setAuth);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const router = useRouter();

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setMessage(null);
    try {
      if (isRegistering) {
        if (!values.invitationCode) {
          form.setError("invitationCode", { type: "manual", message: "请输入邀请码" });
          return;
        }
        await robotCloudApi.registerWithInvitation({
          phone: values.phone,
          password: values.password,
          invitationCode: values.invitationCode
        });
        const session = await robotCloudApi.loginWithPassword({
          phone: values.phone,
          password: values.password
        });
        setAuth(session);
        setIsRegistering(false);
        form.reset({ phone: values.phone, password: "", invitationCode: "" });
        setMessage(`欢迎加入，${session.phone}！`);
        router.replace("/");
        return;
      }

      const result = await robotCloudApi.loginWithPassword({
        phone: values.phone,
        password: values.password
      });
      setAuth(result);
      setMessage(`欢迎回来，${result.phone}！`);
      router.replace("/");
    } catch (err) {
      const failure = err instanceof Error ? err.message : "登录失败";
      if (!isRegistering && failure === "Phone not registered") {
        setIsRegistering(true);
        setMessage("检测到新手机号，请输入邀请码完成注册。");
        form.setFocus("invitationCode");
        setError(null);
        return;
      }
      if (failure === "Invalid phone number") {
        setError("手机号格式有误，请重新输入");
      } else if (failure === "Invalid invitation code") {
        setError("邀请码无效，请确认后重试");
      } else if (failure === "Invitation code already used") {
        setError("邀请码已被使用，请联系管理员");
      } else {
        setError(failure);
      }
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
            {...form.register("phone", {
              required: "请输入手机号",
              pattern: {
                value: /^1\d{10}$/,
                message: "手机号格式有误，请重新输入"
              }
            })}
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
        {isRegistering ? (
          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">邀请码</span>
            <input
              {...form.register("invitationCode", { required: "请输入邀请码" })}
              className="w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              placeholder="请输入邀请码"
            />
            {form.formState.errors.invitationCode ? (
              <span className="text-xs text-red-400">{form.formState.errors.invitationCode.message}</span>
            ) : null}
          </label>
        ) : null}
        <button
          type="submit"
          className="w-full rounded-md bg-teal-500 py-2 font-semibold text-slate-950 transition hover:bg-teal-400"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? (isRegistering ? "注册中..." : "登录中...") : isRegistering ? "提交注册" : "登录"}
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
