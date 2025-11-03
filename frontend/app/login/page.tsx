"use client";

import { useForm } from "react-hook-form";
import { useState } from "react";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { AuthCredentials } from "@/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocaleStore } from "@/store/useLocaleStore";

type LoginFormValues = AuthCredentials & { invitationCode: string };

export default function LoginPage() {
  const locale = useLocaleStore((state) => state.locale);
  const form = useForm<LoginFormValues>({
    defaultValues: { phone: "", password: "", invitationCode: "" }
  });
  const setAuth = useAuthStore((state) => state.setAuth);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState(false);
  const router = useRouter();
  const isZh = locale === "zh";
  const copy = isZh
    ? {
        title: "手机号登录",
        subtitle: "支持密码或验证码登录，保障账号安全。",
        phoneLabel: "手机号",
        phonePlaceholder: "例如：13800001234",
        phoneRequired: "请输入手机号",
        phoneInvalid: "手机号格式有误，请重新输入",
        passwordLabel: "密码",
        passwordPlaceholder: "至少 8 位字符",
        passwordRequired: "请输入密码",
        invitationLabel: "邀请码",
        invitationPlaceholder: "请输入邀请码",
        invitationRequired: "请输入邀请码",
        submitLogin: "登录",
        submittingLogin: "登录中...",
        submitRegister: "提交注册",
        submittingRegister: "注册中...",
        loginSuccess: (phone: string) => `欢迎回来，${phone}！`,
        registerSuccess: (phone: string) => `欢迎加入，${phone}！`,
        newPhoneNotice: "检测到新手机号，请输入邀请码完成注册。",
        invalidInvitation: "邀请码无效，请确认后重试",
        invitationUsed: "邀请码已被使用，请联系管理员",
        genericError: "登录失败",
        footerPrompt: "还没有账号？",
        footerLink: "了解平台功能"
      }
    : {
        title: "Phone Login",
        subtitle: "Use a password or one-time code to keep your account secure.",
        phoneLabel: "Phone Number",
        phonePlaceholder: "e.g. 13800001234",
        phoneRequired: "Enter your phone number",
        phoneInvalid: "Phone number format is incorrect",
        passwordLabel: "Password",
        passwordPlaceholder: "At least 8 characters",
        passwordRequired: "Enter your password",
        invitationLabel: "Invitation Code",
        invitationPlaceholder: "Enter invitation code",
        invitationRequired: "Enter an invitation code",
        submitLogin: "Log in",
        submittingLogin: "Logging in...",
        submitRegister: "Complete Registration",
        submittingRegister: "Registering...",
        loginSuccess: (phone: string) => `Welcome back, ${phone}!`,
        registerSuccess: (phone: string) => `Welcome aboard, ${phone}!`,
        newPhoneNotice: "New phone detected. Enter an invitation code to finish registration.",
        invalidInvitation: "Invitation code is invalid. Please try again.",
        invitationUsed: "Invitation code already used. Contact an administrator.",
        genericError: "Login failed",
        footerPrompt: "Don't have an account?",
        footerLink: "Explore the platform"
      };

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    setMessage(null);
    try {
      if (isRegistering) {
        if (!values.invitationCode) {
          form.setError("invitationCode", { type: "manual", message: copy.invitationRequired });
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
        setMessage(copy.registerSuccess(session.phone));
        router.replace("/");
        return;
      }

      const result = await robotCloudApi.loginWithPassword({
        phone: values.phone,
        password: values.password
      });
      setAuth(result);
      setMessage(copy.loginSuccess(result.phone));
      router.replace("/");
    } catch (err) {
      const failure = err instanceof Error ? err.message : copy.genericError;
      if (!isRegistering && failure === "Phone not registered") {
        setIsRegistering(true);
        setMessage(copy.newPhoneNotice);
        form.setFocus("invitationCode");
        setError(null);
        return;
      }
      if (failure === "Invalid phone number") {
        setError(copy.phoneInvalid);
      } else if (failure === "Invalid invitation code") {
        setError(copy.invalidInvitation);
      } else if (failure === "Invitation code already used") {
        setError(copy.invitationUsed);
      } else {
        setError(isZh ? copy.genericError : failure);
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
          <span className="text-slate-300">{copy.passwordLabel}</span>
          <input
            type="password"
            {...form.register("password", { required: copy.passwordRequired })}
            className="w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
            placeholder={copy.passwordPlaceholder}
          />
          {form.formState.errors.password ? (
            <span className="text-xs text-red-400">{form.formState.errors.password.message}</span>
          ) : null}
        </label>
        {isRegistering ? (
          <label className="block space-y-1 text-sm">
            <span className="text-slate-300">{copy.invitationLabel}</span>
            <input
              {...form.register("invitationCode", { required: copy.invitationRequired })}
              className="w-full rounded-md border border-slate-700 bg-slate-950/50 p-2"
              placeholder={copy.invitationPlaceholder}
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
          {form.formState.isSubmitting
            ? isRegistering
              ? copy.submittingRegister
              : copy.submittingLogin
            : isRegistering
            ? copy.submitRegister
            : copy.submitLogin}
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
