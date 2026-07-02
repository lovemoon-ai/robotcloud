"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";

function PlansContent() {
  const locale = useLocaleStore((state) => state.locale);
  const auth = useAuthStore();
  const role = auth.role ?? "free";
  const token = auth.token;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isZh = locale === "zh";
  const searchParams = useSearchParams();

  // 支付完成返回后，先查询支付状态触发后端升级，再刷新用户信息
  useEffect(() => {
    const paymentId = searchParams.get("payment_id");
    if (paymentId && token) {
      // 先调用 alipayQuery 触发后端检查支付状态并升级用户
      robotCloudApi.alipayQuery(paymentId).then(() => {
        // 再获取最新的用户信息
        return robotCloudApi.fetchProfile();
      }).then((profile) => {
        if (profile.role !== role) {
          auth.setRole(profile.role, profile.expireAt);
        }
      }).catch(() => {
        // ignore
      });
    }
  }, [searchParams, token, auth, role]);

  const copy = useMemo(
    () =>
      isZh
        ? {
            heroTitle: "升级到 Plus",
            heroSubtitle: "享受更高算力、更高并发与云端推理。",
            currentPlan: "当前套餐",
            upgradeCTA: "支付宝支付",
            loginFirst: "请先登录以完成购买。",
            freeTitle: "Free",
            freePrice: "¥0 / 月",
            freeSubtitle: "入门体验，适合轻量试用。",
            freeHighlights: [
              "1 个训练任务，单次最长 3 小时",
              "排队执行，无并发"
            ],
            plusTitle: "Plus",
            plusPrice: "¥600 / 月",
            plusSubtitle: "多任务排队提交，优先级更高，适合频繁使用。",
            plusHighlights: [
              "可提交多个训练，排队顺序优于 Free",
              "支持云端推理",
            ],
            popularBadge: "热门",
            currentBadge: "当前",
            alreadyPlus: "您已经是 Plus 用户",
            errorPrefix: "错误: "
          }
        : {
            heroTitle: "Upgrade to Plus",
            heroSubtitle: "Enjoy more compute, concurrency, and remote inference.",
            currentPlan: "Current plan",
            upgradeCTA: "AliPay",
            loginFirst: "Please log in to complete purchase.",
            freeTitle: "Free",
            freePrice: "¥0 / mo",
            freeSubtitle: "Great for trying the platform with strict limits.",
            freeHighlights: [
              "1 training up to 3 hours",
              "Queued execution, no concurrency"
            ],
            plusTitle: "Plus",
            plusPrice: "¥600 / mo",
            plusSubtitle: "Higher priority with multiple queued jobs, ideal for frequent use.",
            plusHighlights: [
              "Submit multiple training jobs (queued, no concurrency)",
              "Support inference on cloud",
            ],
            popularBadge: "Popular",
            currentBadge: "Current",
            alreadyPlus: "You are already a Plus user",
            errorPrefix: "Error: "
          },
    [isZh]
  );

  const handleUpgrade = async () => {
    if (!token) {
      window.location.href = "/login";
      return;
    }
    if (role !== "free") {
      setError(copy.alreadyPlus);
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const payment = await robotCloudApi.createPayment("plus", "alipay");
      // 直接跳转到支付宝支付页面
      if (payment.checkoutUrl) {
        window.location.href = payment.checkoutUrl;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create payment";
      setError(copy.errorPrefix + message);
    } finally {
      setLoading(false);
    }
  };

  const isFree = role === "free";
  const isPlus = role === "plus";

  return (
    <main className="bg-surface space-y-10">
      <section className="rounded-2xl border border-theme p-8 shadow-xl" style={{ background: 'linear-gradient(to right, var(--color-card), var(--color-bg))' }}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] accent-text/80">
              RobotCloud
            </p>
            <h1 className="text-3xl font-bold text-body md:text-4xl">{copy.heroTitle}</h1>
            <p className="max-w-3xl text-sm text-muted">{copy.heroSubtitle}</p>
          </div>
          <div className="rounded-xl border border-primary/30 px-5 py-4 text-sm shadow-lg" style={{ backgroundColor: 'var(--color-card)' }}>
            <p className="text-xs uppercase text-muted">{copy.currentPlan}</p>
            <p className="mt-1 text-lg font-semibold capitalize accent-text">{role}</p>
          </div>
        </div>
      </section>

      {!token ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-400">
          {copy.loginFirst}{" "}
          <Link href="/login" className="underline hover:text-amber-300">
            Login
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-400">{error}</div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        {/* Free Tier */}
        <article
          className={`relative overflow-hidden rounded-2xl border p-6 shadow-inner transition ${
            isFree
              ? "border-primary ring-2 ring-primary/30"
              : "border-theme opacity-80"
          }`}
          style={{ backgroundColor: 'var(--color-card)' }}
        >
          {isFree && (
            <span className="absolute right-4 top-4 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-on-primary">
              {copy.currentBadge}
            </span>
          )}
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-body">{copy.freeTitle}</h2>
            <p className="text-3xl font-bold text-muted">{copy.freePrice}</p>
            <p className="text-sm text-muted">{copy.freeSubtitle}</p>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-body">
            {copy.freeHighlights.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-muted" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <button
            disabled={!isFree}
            className={`mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              isFree
                ? "bg-primary text-on-primary shadow-lg shadow-primary/30 cursor-default"
                : "border border-theme bg-surface-secondary text-muted cursor-not-allowed"
            }`}
          >
            {isFree ? copy.currentPlan : isPlus ? "Plus 专属" : copy.currentPlan}
          </button>
        </article>

        {/* Plus Tier */}
        <article
          className={`relative overflow-hidden rounded-2xl border p-6 shadow-lg transition ${
            isPlus
              ? "border-primary ring-2 ring-primary/30"
              : "border-primary/60"
          }`}
          style={{
            backgroundColor: 'var(--color-card)',
            boxShadow: isPlus ? '0 15px 50px rgba(59, 173, 224, 0.15)' : '0 15px 50px rgba(59, 173, 224, 0.08)'
          }}
        >
          <span className={`absolute right-4 top-4 rounded-full px-3 py-1 text-xs font-semibold ${
            isPlus
              ? "bg-primary text-on-primary"
              : "accent-bg accent-text"
          }`}>
            {isPlus ? copy.currentBadge : copy.popularBadge}
          </span>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-body">{copy.plusTitle}</h2>
            <p className="text-3xl font-bold accent-text">{copy.plusPrice}</p>
            <p className="text-sm text-muted">{copy.plusSubtitle}</p>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-body">
            {copy.plusHighlights.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-primary" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <button
            onClick={handleUpgrade}
            disabled={isPlus || loading || !token}
            className={`mt-6 w-full rounded-lg px-4 py-2.5 text-sm font-semibold transition ${
              isPlus
                ? "bg-primary text-on-primary shadow-lg shadow-primary/30 cursor-default"
                : "gradient-primary hover:opacity-90 disabled:opacity-60 text-white"
            }`}
          >
            {isPlus ? copy.currentPlan : loading ? "..." : copy.upgradeCTA}
          </button>
        </article>
      </section>
    </main>
  );
}

export default function PlansPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[50vh]"><span className="text-muted">Loading...</span></div>}>
      <PlansContent />
    </Suspense>
  );
}
