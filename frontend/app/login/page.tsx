"use client";

import { useForm } from "react-hook-form";
import { useState, useEffect, useCallback } from "react";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocaleStore } from "@/store/useLocaleStore";

type LoginFormValues = {
  phone: string;
  code: string;
  invitationCode: string;
};

export default function LoginPage() {
  const locale = useLocaleStore((state) => state.locale);
  const form = useForm<LoginFormValues>({
    defaultValues: { phone: "", code: "", invitationCode: "" }
  });
  const setAuth = useAuthStore((state) => state.setAuth);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [showInviteCode, setShowInviteCode] = useState(false);
  const router = useRouter();
  const isZh = locale === "zh";

  const copy = isZh
    ? {
        title: "手机号登录",
        subtitle: "使用短信验证码快速登录或注册",
        phoneLabel: "手机号",
        phonePlaceholder: "例如：13800001234",
        phoneRequired: "请输入手机号",
        phoneInvalid: "手机号格式有误，请重新输入",
        codeLabel: "验证码",
        codePlaceholder: "请输入6位验证码",
        codeRequired: "请输入验证码",
        sendCode: "获取验证码",
        sendingCode: "发送中...",
        resendCode: (s: number) => `${s}秒后重发`,
        invitationLabel: "邀请码（可选）",
        invitationPlaceholder: "请输入邀请码",
        submitLogin: "登录 / 注册",
        submittingLogin: "登录中...",
        loginSuccess: (phone: string) => `欢迎，${phone}！`,
        codeSentSuccess: "验证码已发送",
        devCodeHint: (code: string) => `开发模式验证码：${code}`,
        genericError: "登录失败",
        footerPrompt: "还没有账号？",
        footerLink: "了解平台功能",
        showInviteCode: "有邀请码？"
      }
    : {
        title: "Phone Login",
        subtitle: "Login or register with SMS verification code",
        phoneLabel: "Phone Number",
        phonePlaceholder: "e.g. 13800001234",
        phoneRequired: "Enter your phone number",
        phoneInvalid: "Phone number format is incorrect",
        codeLabel: "Verification Code",
        codePlaceholder: "Enter 6-digit code",
        codeRequired: "Enter verification code",
        sendCode: "Send Code",
        sendingCode: "Sending...",
        resendCode: (s: number) => `Resend in ${s}s`,
        invitationLabel: "Invitation Code (Optional)",
        invitationPlaceholder: "Enter invitation code",
        submitLogin: "Login / Register",
        submittingLogin: "Logging in...",
        loginSuccess: (phone: string) => `Welcome, ${phone}!`,
        codeSentSuccess: "Verification code sent",
        devCodeHint: (code: string) => `Dev mode code: ${code}`,
        genericError: "Login failed",
        footerPrompt: "Don't have an account?",
        footerLink: "Explore the platform",
        showInviteCode: "Have an invite code?"
      };

  useEffect(() => {
    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [countdown]);

  const handleSendCode = useCallback(async () => {
    const phone = form.getValues("phone");
    if (!phone || !/^1\d{10}$/.test(phone)) {
      form.setError("phone", { type: "manual", message: copy.phoneInvalid });
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const result = await robotCloudApi.requestOtp(phone);
      setCodeSent(true);
      setCountdown(60);
      setMessage(copy.codeSentSuccess);
      if (result.code) {
        setDevCode(result.code);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.genericError);
    }
  }, [form, copy]);

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setMessage(null);
    try {
      const session = await robotCloudApi.loginWithCode({
        phone: values.phone,
        code: values.code,
        invitationCode: values.invitationCode || undefined
      });
      setAuth(session);
      setMessage(copy.loginSuccess(session.phone));
      router.replace("/");
    } catch (err) {
      const failure = err instanceof Error ? err.message : copy.genericError;
      if (failure === "Invalid phone number") {
        setError(copy.phoneInvalid);
      } else {
        setError(failure);
      }
    }
  });

  return (
    <main className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2 text-center">
        <h1 className="text-3xl font-bold">{copy.title}</h1>
        <p className="text-sm text-slate-300">{copy.subtitle}</p>
      </header>
      <form onSubmit={onSubmit} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/50 p-6">
        <label className="block space-y-1 text-sm">
          <span className="text-slate-300">{copy.phoneLabel}</span>
          <input
            {...form.register("phone", {
              required: copy.phoneRequired,
              pattern: {
                value: /^1\d{10}$/,
                message: copy.phoneInvalid
              }
            })}
            className="w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            placeholder={copy.phonePlaceholder}
          />
          {form.formState.errors.phone ? (
            <span className="text-xs text-red-400">{form.formState.errors.phone.message}</span>
          ) : null}
        </label>
        <label className="block space-y-1 text-sm">
          <span className="text-slate-300">{copy.codeLabel}</span>
          <div className="flex gap-2">
            <input
              {...form.register("code", { required: copy.codeRequired })}
              className="flex-1 rounded-md border border-slate-700 bg-slate-950/50 p-2"
              placeholder={copy.codePlaceholder}
              maxLength={6}
            />
            <button
              type="button"
              onClick={handleSendCode}
              disabled={countdown > 0}
              className="rounded-md border border-teal-500 px-4 py-2 text-sm font-semibold text-teal-300 transition hover:bg-teal-500/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {countdown > 0 ? copy.resendCode(countdown) : copy.sendCode}
            </button>
          </div>
          {form.formState.errors.code ? (
            <span className="text-xs text-red-400">{form.formState.errors.code.message}</span>
          ) : null}
          {devCode ? (
            <span className="text-xs text-teal-400">{copy.devCodeHint(devCode)}</span>
          ) : null}
        </label>
        {!showInviteCode ? (
          <button
            type="button"
            onClick={() => setShowInviteCode(true)}
            className="text-xs text-teal-400 hover:text-teal-300"
          >
            {copy.showInviteCode}
          </button>
        ) : (
          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">{copy.invitationLabel}</span>
            <input
              {...form.register("invitationCode")}
              className="w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              placeholder={copy.invitationPlaceholder}
            />
          </label>
        )}
        <button
          type="submit"
          className="w-full rounded-md bg-teal-500 py-2 font-semibold text-slate-950 transition hover:bg-teal-400"
          disabled={form.formState.isSubmitting}
        >
          {form.formState.isSubmitting ? copy.submittingLogin : copy.submitLogin}
        </button>
        {message ? <p className="text-sm text-teal-300">{message}</p> : null}
        {error ? <p className="text-sm text-red-400">{error}</p> : null}
      </form>
      <footer className="text-center text-xs text-slate-500">
        {copy.footerPrompt}{" "}
        <Link href="/" className="text-teal-300 hover:text-teal-200">
          {copy.footerLink}
        </Link>
      </footer>
    </main>
  );
}
