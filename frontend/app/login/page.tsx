"use client";

import { useForm } from "react-hook-form";
import { useState, useEffect, useCallback, useMemo } from "react";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useRouter } from "next/navigation";
import { useLocaleStore } from "@/store/useLocaleStore";
import { Logo } from "@/components/Logo";

type LoginFormValues = {
  phone: string;
  code: string;
};

function safeLoginRedirectTarget(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }
  const pathname = value.split(/[?#]/, 1)[0].replace(/\/+$/, "") || "/";
  if (pathname === "/login") {
    return "/";
  }
  return value;
}

function isDeviceLimitError(value: string) {
  return value.toLowerCase().includes("device limit");
}

export default function LoginPage() {
  const locale = useLocaleStore((state) => state.locale);
  const form = useForm<LoginFormValues>({
    defaultValues: { phone: "", code: "" }
  });
  const setAuth = useAuthStore((state) => state.setAuth);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codeSent, setCodeSent] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [canReplaceDevice, setCanReplaceDevice] = useState(false);
  const [isReplacingDevice, setIsReplacingDevice] = useState(false);
  const router = useRouter();
  const isZh = locale === "zh";

  const copy = useMemo(
    () =>
      isZh
        ? {
            title: "RobotCloud",
            subtitle: "使用短信验证码登录或注册",
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
            submitLogin: "登录 / 注册",
            submittingLogin: "登录中...",
            loginSuccess: (phone: string) => `欢迎，${phone}！`,
            codeSentSuccess: "验证码已发送",
            devCodeHint: (code: string) => `开发模式验证码：${code}`,
            deviceLimitError: "当前账号已在另一台同类型设备登录。",
            replaceDevice: "替换当前设备",
            replacingDevice: "替换中...",
            genericError: "登录失败"
          }
        : {
            title: "RobotCloud",
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
            submitLogin: "Login / Register",
            submittingLogin: "Logging in...",
            loginSuccess: (phone: string) => `Welcome, ${phone}!`,
            codeSentSuccess: "Verification code sent",
            devCodeHint: (code: string) => `Dev mode code: ${code}`,
            deviceLimitError: "This account is already signed in on another device of this type.",
            replaceDevice: "Replace current device",
            replacingDevice: "Replacing...",
            genericError: "Login failed"
          },
    [isZh]
  );

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
    setCanReplaceDevice(false);
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

  const completeLogin = useCallback(
    async (values: LoginFormValues, replaceExistingDevice = false) => {
      if (replaceExistingDevice) {
        setIsReplacingDevice(true);
      }
      try {
        const loginPayload = {
          phone: values.phone,
          code: values.code
        };
        const session = replaceExistingDevice
          ? await robotCloudApi.loginWithCode(loginPayload, { replaceExistingDevice: true })
          : await robotCloudApi.loginWithCode(loginPayload);
        setAuth(session);
        setMessage(copy.loginSuccess(session.phone));
        setCanReplaceDevice(false);
        const next = new URLSearchParams(window.location.search).get("next");
        router.replace(safeLoginRedirectTarget(next));
      } catch (err) {
        const failure = err instanceof Error ? err.message : copy.genericError;
        if (failure === "Invalid phone number") {
          setError(copy.phoneInvalid);
          setCanReplaceDevice(false);
        } else if (isDeviceLimitError(failure)) {
          setError(copy.deviceLimitError);
          setCanReplaceDevice(true);
        } else {
          setError(failure);
          setCanReplaceDevice(false);
        }
      } finally {
        if (replaceExistingDevice) {
          setIsReplacingDevice(false);
        }
      }
    },
    [copy, router, setAuth]
  );

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setMessage(null);
    setCanReplaceDevice(false);
    await completeLogin(values);
  });

  const handleReplaceDevice = useCallback(async () => {
    const valid = await form.trigger();
    if (!valid) {
      return;
    }
    setError(null);
    setMessage(null);
    await completeLogin(form.getValues(), true);
  }, [completeLogin, form]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4 py-10 text-body">
      <section className="flex w-full max-w-sm flex-col items-center gap-5 text-center">
        <Logo className="h-11 w-11 text-body" />
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-body">{copy.title}</h1>
          <p className="text-sm text-muted">{copy.subtitle}</p>
        </header>
        <form onSubmit={onSubmit} className="w-full space-y-4 rounded-lg border border-theme bg-card p-5 text-left">
          <label className="block space-y-1 text-sm">
            <span className="text-muted">{copy.phoneLabel}</span>
            <input
              {...form.register("phone", {
                required: copy.phoneRequired,
                pattern: {
                  value: /^1\d{10}$/,
                  message: copy.phoneInvalid
                }
              })}
              className="w-full rounded-md border border-theme bg-surface p-2 text-body"
              placeholder={copy.phonePlaceholder}
            />
            {form.formState.errors.phone ? (
              <span className="text-xs text-red-500">{form.formState.errors.phone.message}</span>
            ) : null}
          </label>
          <label className="block space-y-1 text-sm">
            <span className="text-muted">{copy.codeLabel}</span>
            <div className="flex gap-2">
              <input
                {...form.register("code", { required: copy.codeRequired })}
                className="min-w-0 flex-1 rounded-md border border-theme bg-surface p-2 text-body"
                placeholder={copy.codePlaceholder}
                maxLength={6}
              />
              <button
                type="button"
                onClick={handleSendCode}
                disabled={countdown > 0}
                className="shrink-0 rounded-md border border-primary px-3 py-2 text-sm font-semibold accent-text transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                {countdown > 0 ? copy.resendCode(countdown) : copy.sendCode}
              </button>
            </div>
            {form.formState.errors.code ? (
              <span className="text-xs text-red-500">{form.formState.errors.code.message}</span>
            ) : null}
            {devCode ? <span className="text-xs accent-text">{copy.devCodeHint(devCode)}</span> : null}
          </label>
          <button
            type="submit"
            className="w-full rounded-md py-2 font-semibold text-white transition hover:opacity-90 gradient-primary"
            disabled={form.formState.isSubmitting}
          >
            {form.formState.isSubmitting ? copy.submittingLogin : copy.submitLogin}
          </button>
          {message ? <p className="text-sm accent-text">{message}</p> : null}
          {error ? <p className="text-sm text-red-500">{error}</p> : null}
          {canReplaceDevice ? (
            <button
              type="button"
              onClick={handleReplaceDevice}
              className="w-full rounded-md border border-primary px-3 py-2 text-sm font-semibold accent-text transition hover:accent-bg disabled:cursor-not-allowed disabled:opacity-50"
              disabled={isReplacingDevice}
            >
              {isReplacingDevice ? copy.replacingDevice : copy.replaceDevice}
            </button>
          ) : null}
        </form>
      </section>
    </main>
  );
}
