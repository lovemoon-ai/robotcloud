"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";
import { Payment } from "@/types";

// Only Plus plan is available: 200 RMB/month
const PLUS_PRICE_CNY = 20000; // 20000 cents = 200 RMB

function formatAmount(amountCents: number, currency: string): string {
  const unit = currency === "CNY" ? "¥" : currency === "USD" ? "$" : `${currency} `;
  const value = (amountCents / 100).toFixed(2);
  return `${unit}${value}`;
}

function StatusPill({ status }: { status: Payment["status"] }) {
  const color =
    status === "succeeded"
      ? "bg-emerald-500/20 text-emerald-200 border-emerald-500/60"
      : status === "pending"
        ? "bg-amber-500/10 text-amber-200 border-amber-500/40"
        : "bg-rose-500/10 text-rose-200 border-rose-500/50";
  return <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${color}`}>{status}</span>;
}

export default function PlansPage() {
  const locale = useLocaleStore((state) => state.locale);
  const auth = useAuthStore();
  const role = auth.role ?? "free";
  const token = auth.token;
  const [activePayment, setActivePayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isZh = locale === "zh";

  const copy = useMemo(
    () =>
      isZh
        ? {
            heroTitle: "升级到 Plus",
            heroSubtitle: "享受更高算力、更高并发与团队控制。",
            currentPlan: "当前套餐",
            upgradeCTA: "立即升级",
            startCTA: "开始使用",
            loginFirst: "请先登录以完成购买。",
            freeTitle: "Free",
            freePrice: "¥0 / 月",
            freeSubtitle: "入门体验，适合轻量试用。",
            freeHighlights: [
              "1 个训练任务，单次最长 3 小时",
              "1 次云端推理，时长不超过 0.5 小时",
              "排队执行，无并发"
            ],
            plusTitle: "Plus",
            plusPrice: "¥200 / 月",
            plusSubtitle: "多任务排队提交，优先级更高，适合频繁使用。",
            plusHighlights: [
              "可提交多个训练/推理任务，排队顺序优于 Free",
              "单设备串行运行（无并发），适合日常开发验证",
              "服务窗口内优先支持"
            ],
            popularBadge: "热门",
            currentBadge: "当前",
            flowTitle: "支付进度",
            stepCreate: "1) 创建支付单",
            stepPay: "2) 前往支付宝收银台",
            stepRefresh: "3) 刷新支付状态",
            stepApply: "4) 应用套餐",
            refreshStatus: "刷新状态",
            applyPlan: "应用 Plus 套餐",
            checkout: "打开支付宝",
            amountLabel: "应付金额",
            paymentId: "支付单号",
            targetRole: "目标套餐",
            alipay: "支付宝",
            paymentSuccess: "支付成功",
            paymentPending: "等待支付",
            alreadyPlus: "您已经是 Plus 用户",
            errorPrefix: "错误: "
          }
        : {
            heroTitle: "Upgrade to Plus",
            heroSubtitle: "Enjoy more compute, concurrency, and team controls.",
            currentPlan: "Current plan",
            upgradeCTA: "Upgrade Now",
            startCTA: "Get started",
            loginFirst: "Please log in to complete purchase.",
            freeTitle: "Free",
            freePrice: "$0 / mo",
            freeSubtitle: "Great for trying the platform with strict limits.",
            freeHighlights: [
              "1 training up to 3 hours",
              "1 cloud inference up to 30 minutes",
              "Queued execution, no concurrency"
            ],
            plusTitle: "Plus",
            plusPrice: "¥200 / mo",
            plusSubtitle: "Higher priority with multiple queued jobs, ideal for frequent use.",
            plusHighlights: [
              "Submit multiple training/inference jobs (queued, no concurrency)",
              "Better queue priority than Free on shared 4090s",
              "Priority support during business hours"
            ],
            popularBadge: "Popular",
            currentBadge: "Current",
            flowTitle: "Payment Progress",
            stepCreate: "1) Create payment order",
            stepPay: "2) Go to Alipay checkout",
            stepRefresh: "3) Refresh payment status",
            stepApply: "4) Apply plan",
            refreshStatus: "Refresh status",
            applyPlan: "Apply Plus Plan",
            checkout: "Open Alipay",
            amountLabel: "Amount",
            paymentId: "Payment ID",
            targetRole: "Target plan",
            alipay: "Alipay",
            paymentSuccess: "Payment successful",
            paymentPending: "Waiting for payment",
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
      setActivePayment(payment);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create payment";
      setError(copy.errorPrefix + message);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    if (!activePayment) return;
    setError(null);
    setRefreshing(true);
    try {
      const updated = await robotCloudApi.alipayQuery(activePayment.paymentId);
      setActivePayment(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh payment");
    } finally {
      setRefreshing(false);
    }
  };

  const handleApplyUpgrade = async () => {
    if (!activePayment) return;
    setError(null);
    setUpgrading(true);
    try {
      const updated = await robotCloudApi.upgradePlan(activePayment.targetRole, activePayment.paymentId);
      auth.setRole(updated.role, updated.expireAt);
      const refreshed = await robotCloudApi.paymentStatus(activePayment.paymentId).catch(() => null);
      if (refreshed) {
        setActivePayment(refreshed);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to upgrade plan");
    } finally {
      setUpgrading(false);
    }
  };

  const isPlus = role === "plus";

  return (
    <main className="space-y-10">
      <section className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900/80 to-slate-950 p-8 shadow-xl shadow-teal-900/20">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] text-teal-300/80">
              RobotCloud
            </p>
            <h1 className="text-3xl font-bold text-white md:text-4xl">{copy.heroTitle}</h1>
            <p className="max-w-3xl text-sm text-slate-300">{copy.heroSubtitle}</p>
          </div>
          <div className="rounded-xl border border-teal-500/30 bg-slate-900/70 px-5 py-4 text-sm text-teal-100 shadow-lg shadow-teal-900/40">
            <p className="text-xs uppercase text-teal-300/80">{copy.currentPlan}</p>
            <p className="mt-1 text-lg font-semibold capitalize">{role}</p>
          </div>
        </div>
      </section>

      {!token ? (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {copy.loginFirst}{" "}
          <Link href="/login" className="underline">
            Login
          </Link>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        {/* Free Tier */}
        <article className="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-6 shadow-inner shadow-slate-950/50">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-white">{copy.freeTitle}</h2>
            <p className="text-3xl font-bold text-slate-400">{copy.freePrice}</p>
            <p className="text-sm text-slate-300">{copy.freeSubtitle}</p>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-slate-200">
            {copy.freeHighlights.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-500" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <button
            disabled
            className="mt-6 w-full rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-400 cursor-not-allowed"
          >
            {copy.currentPlan}
          </button>
        </article>

        {/* Plus Tier */}
        <article className="relative overflow-hidden rounded-2xl border border-teal-500/60 bg-slate-900/80 p-6 shadow-[0_15px_50px_rgba(45,212,191,0.12)]">
          <span className="absolute right-4 top-4 rounded-full bg-teal-500/20 px-3 py-1 text-xs font-semibold text-teal-200">
            {isPlus ? copy.currentBadge : copy.popularBadge}
          </span>
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-white">{copy.plusTitle}</h2>
            <p className="text-3xl font-bold text-teal-200">{copy.plusPrice}</p>
            <p className="text-sm text-slate-300">{copy.plusSubtitle}</p>
          </div>
          <ul className="mt-4 space-y-2 text-sm text-slate-200">
            {copy.plusHighlights.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-400" aria-hidden />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <button
            onClick={handleUpgrade}
            disabled={isPlus || loading || !token}
            className={`mt-6 w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
              isPlus
                ? "border border-teal-400/50 bg-slate-800/80 text-teal-200 cursor-not-allowed"
                : "bg-gradient-to-r from-teal-400 to-sky-400 text-slate-950 hover:opacity-90 disabled:opacity-60"
            }`}
          >
            {isPlus ? copy.currentPlan : loading ? "..." : copy.upgradeCTA}
          </button>
        </article>
      </section>

      {activePayment ? (
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-inner shadow-slate-950/60">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-teal-200">{copy.flowTitle}</h3>
              <p className="text-sm text-slate-300">
                {copy.amountLabel}: {formatAmount(activePayment.amountCents, activePayment.currency)} · {copy.targetRole}: Plus
              </p>
            </div>
            <StatusPill status={activePayment.status} />
          </div>
          <div className="grid gap-3 text-sm text-slate-200 md:grid-cols-2">
            <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/80 p-4">
              <p className="text-xs uppercase tracking-wide text-teal-300/80">{copy.stepCreate}</p>
              <p className="text-xs text-slate-400">
                {copy.paymentId}: <span className="font-mono text-slate-200">{activePayment.paymentId}</span>
              </p>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/80 p-4">
              <p className="text-xs uppercase tracking-wide text-teal-300/80">{copy.stepPay}</p>
              <div className="flex gap-2">
                {activePayment.checkoutUrl ? (
                  <a
                    href={activePayment.checkoutUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex flex-1 items-center justify-center rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-teal-100 transition hover:bg-slate-700"
                  >
                    {copy.checkout}
                  </a>
                ) : null}
              </div>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/80 p-4">
              <p className="text-xs uppercase tracking-wide text-teal-300/80">{copy.stepRefresh}</p>
              <button
                onClick={handleRefresh}
                disabled={refreshing}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-teal-400 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {refreshing ? "..." : copy.refreshStatus}
              </button>
            </div>
            <div className="space-y-2 rounded-lg border border-slate-800 bg-slate-900/80 p-4">
              <p className="text-xs uppercase tracking-wide text-teal-300/80">{copy.stepApply}</p>
              <button
                onClick={handleApplyUpgrade}
                disabled={upgrading || activePayment.status !== "succeeded"}
                className="w-full rounded-lg bg-gradient-to-r from-teal-400 to-sky-400 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {upgrading ? "..." : copy.applyPlan}
              </button>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
