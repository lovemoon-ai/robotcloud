"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { robotCloudApi } from "@/api/client";
import { useAuthStore } from "@/store/useAuthStore";
import { useLocaleStore } from "@/store/useLocaleStore";
import { Payment, UserRole } from "@/types";

type TierId = Extract<UserRole, "free" | "plus" | "pro">;

interface Tier {
  id: TierId;
  name: string;
  price: string;
  subtitle: string;
  highlights: string[];
  badge?: string;
  cta: string;
  variant?: "primary";
}

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
  const [provider, setProvider] = useState<"wechat" | "alipay">("wechat");
  const [loadingTier, setLoadingTier] = useState<TierId | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mocking, setMocking] = useState(false);
  const [upgrading, setUpgrading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isZh = locale === "zh";

  const copy = useMemo(
    () =>
      isZh
        ? {
            heroTitle: "选择适合你的 RobotCloud 套餐",
            heroSubtitle: "接通支付后即可升级 Plus 或 Pro，享受更高算力、更高并发与团队控制。",
            currentPlan: "当前套餐",
            upgradeCTA: "升级",
            startCTA: "开始使用",
            highlightTitle: "为什么要升级？",
            highlightItems: [
              "3 台 4090 统一调度，Pro 支持最多 5 路并发",
              "Plus 支持多任务排队，优先级高于 Free",
              "团队协作与角色控制，满足企业安全需求"
            ],
            flowTitle: "支付进度",
            stepCreate: "1) 创建支付单",
            stepPay: "2) 前往收银台（或使用 Mock 回调）",
            stepRefresh: "3) 刷新支付状态",
            stepApply: "4) 成功后应用套餐",
            loginFirst: "请先登录以完成购买。",
            mockSuccess: "模拟支付成功",
            refreshStatus: "刷新状态",
            applyPlan: "应用套餐",
            checkout: "打开收银台",
            amountLabel: "应付金额",
            paymentId: "支付单号",
            targetRole: "目标套餐",
            providerLabel: "支付方式",
            wechat: "微信支付",
            alipay: "支付宝"
          }
        : {
            heroTitle: "Choose the right RobotCloud plan",
            heroSubtitle: "Payments are now wired up. Upgrade to Plus or Pro for more compute, concurrency, and team controls.",
            currentPlan: "Current plan",
            upgradeCTA: "Upgrade",
            startCTA: "Get started",
            highlightTitle: "Why upgrade?",
            highlightItems: [
              "3×4090 pooled; Pro allows up to 5 concurrent jobs",
              "Plus submits multiple queued jobs with higher priority",
              "Team roles and controls for enterprise needs"
            ],
            flowTitle: "Payment progress",
            stepCreate: "1) Create payment",
            stepPay: "2) Go to checkout (or mock callback)",
            stepRefresh: "3) Refresh payment status",
            stepApply: "4) Apply plan after success",
            loginFirst: "Please log in to complete purchase.",
            mockSuccess: "Mock success",
            refreshStatus: "Refresh status",
            applyPlan: "Apply plan",
            checkout: "Open checkout",
            amountLabel: "Amount",
            paymentId: "Payment ID",
            targetRole: "Target plan",
            providerLabel: "Payment method",
            wechat: "WeChat Pay",
            alipay: "Alipay"
          },
    [isZh]
  );

  const tiers: Tier[] = useMemo(
    () =>
      isZh
        ? [
            {
              id: "free",
              name: "Free",
              price: "¥0 / 月",
              subtitle: "入门体验，适合轻量试用。",
              highlights: [
                "1 个训练任务，单次最长 3 小时",
                "1 次云端推理，时长不超过 0.5 小时",
                "排队执行，无并发"
              ],
              cta: copy.startCTA
            },
            {
              id: "plus",
              name: "Plus",
              price: "¥99 / 月",
              subtitle: "多任务排队提交，优先级更高，适合频繁使用。",
              highlights: [
                "可提交多个训练/推理任务，排队顺序优于 Free",
                "单设备串行运行（无并发），适合日常开发验证",
                "服务窗口内优先支持"
              ],
              badge: "热门",
              cta: `${copy.upgradeCTA} · Plus`,
              variant: "primary"
            },
            {
              id: "pro",
              name: "Pro",
              price: "¥299 / 月",
              subtitle: "5 路并发 + 团队协作，充分压榨 3 台 4090。",
              highlights: [
                "最多 5 个任务并发，充分利用 3 台 4090 算力",
                "更高队列优先级与延长的运行时长额度",
                "团队成员与角色控制，满足协作安全"
              ],
              badge: "新",
              cta: `${copy.upgradeCTA} · Pro`
            }
          ]
        : [
            {
              id: "free",
              name: "Free",
              price: "$0 / mo",
              subtitle: "Great for trying the platform with strict limits.",
              highlights: ["1 training up to 3 hours", "1 cloud inference up to 30 minutes", "Queued execution, no concurrency"],
              cta: copy.startCTA
            },
            {
              id: "plus",
              name: "Plus",
              price: "$15 / mo",
              subtitle: "Higher priority with multiple queued jobs, ideal for frequent use.",
              highlights: [
                "Submit multiple training/inference jobs (queued, no concurrency)",
                "Better queue priority than Free on shared 4090s",
                "Priority support during business hours"
              ],
              badge: "Popular",
              cta: `${copy.upgradeCTA} · Plus`,
              variant: "primary"
            },
            {
              id: "pro",
              name: "Pro",
              price: "$45 / mo",
              subtitle: "Up to 5 concurrent jobs plus team controls to max out three 4090s.",
              highlights: [
                "Run up to 5 jobs concurrently to saturate available GPUs",
                "Top queue priority and longer runtime allowances",
                "Team seats with role-based controls for collaboration"
              ],
              badge: "New",
              cta: `${copy.upgradeCTA} · Pro`
            }
          ],
    [copy.startCTA, copy.upgradeCTA, isZh]
  );

  const handleSelect = async (tier: Tier) => {
    if (!token) {
      window.location.href = "/login";
      return;
    }
    setError(null);
    setLoadingTier(tier.id);
    try {
      const payment = await robotCloudApi.createPayment(tier.id, provider);
      setActivePayment(payment);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to create payment";
      setError(message);
    } finally {
      setLoadingTier(null);
    }
  };

  const handleRefresh = async () => {
    if (!activePayment) return;
    setError(null);
    setRefreshing(true);
    try {
      const updated = await robotCloudApi.paymentStatus(activePayment.paymentId);
      setActivePayment(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh payment");
    } finally {
      setRefreshing(false);
    }
  };

  const handleMockSuccess = async () => {
    if (!activePayment) return;
    setError(null);
    setMocking(true);
    try {
      const updated = await robotCloudApi.mockPaymentCallback(activePayment.paymentId, "succeeded");
      setActivePayment(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mock payment");
    } finally {
      setMocking(false);
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

  return (
    <main className="space-y-10">
      <section className="rounded-2xl border border-slate-800 bg-gradient-to-r from-slate-900 via-slate-900/80 to-slate-950 p-8 shadow-xl shadow-teal-900/20">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-3">
            <p className="text-xs uppercase tracking-[0.2em] text-teal-300/80">
              RobotCloud Plans
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

      <section className="grid gap-4 md:grid-cols-3">
        {tiers.map((tier) => {
          const isCurrent = tier.id === role;
          const isPrimary = tier.variant === "primary";
          const isLoading = loadingTier === tier.id;
          return (
            <article
              key={tier.id}
              className={`relative overflow-hidden rounded-2xl border ${
                isPrimary
                  ? "border-teal-500/60 bg-slate-900/80 shadow-[0_15px_50px_rgba(45,212,191,0.12)]"
                  : "border-slate-800 bg-slate-900/70 shadow-inner shadow-slate-950/50"
              } p-6 transition hover:-translate-y-1 hover:border-teal-400/80`}
            >
              {tier.badge ? (
                <span className="absolute right-4 top-4 rounded-full bg-teal-500/20 px-3 py-1 text-xs font-semibold text-teal-200">
                  {tier.badge}
                </span>
              ) : null}
              <div className="space-y-2">
                <h2 className="text-xl font-semibold text-white">{tier.name}</h2>
                <p className="text-3xl font-bold text-teal-200">{tier.price}</p>
                <p className="text-sm text-slate-300">{tier.subtitle}</p>
              </div>
              <ul className="mt-4 space-y-2 text-sm text-slate-200">
                {tier.highlights.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <span className="mt-[5px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-teal-400" aria-hidden />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => handleSelect(tier)}
                className={`mt-6 w-full rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  isCurrent
                    ? "border border-teal-400/50 bg-slate-800/80 text-teal-200 cursor-not-allowed"
                    : isPrimary
                      ? "bg-gradient-to-r from-teal-400 to-sky-400 text-slate-950 hover:opacity-90"
                      : "border border-slate-700 bg-slate-800 text-slate-100 hover:border-teal-400 hover:text-teal-100"
                }`}
                disabled={isCurrent || isLoading || !token}
              >
                {isCurrent ? copy.currentPlan : isLoading ? "..." : tier.cta}
              </button>
            </article>
          );
        })}
      </section>

      {error ? (
        <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div>
      ) : null}

      {activePayment ? (
        <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-inner shadow-slate-950/60">
          <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-slate-200">
            <span className="text-xs uppercase tracking-wide text-teal-300/80">{copy.providerLabel}</span>
            <div className="flex gap-2">
              {(["wechat", "alipay"] as const).map((id) => (
                <button
                  key={id}
                  onClick={() => setProvider(id)}
                  className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    provider === id
                      ? "border-teal-400 bg-teal-500/10 text-teal-100"
                      : "border-slate-700 bg-slate-800 text-slate-100 hover:border-teal-400"
                  }`}
                >
                  {id === "wechat" ? copy.wechat : copy.alipay}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold text-teal-200">{copy.flowTitle}</h3>
              <p className="text-sm text-slate-300">
                {copy.amountLabel}: {formatAmount(activePayment.amountCents, activePayment.currency)} · {copy.targetRole}:{" "}
                {activePayment.targetRole.toUpperCase()}
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
                    className="inline-flex flex-1 items-center justify-center rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-teal-100 transition hover:border-teal-400 hover:text-teal-50"
                  >
                    {copy.checkout}
                  </a>
                ) : null}
                {activePayment.payCode ? (
                  <div className="flex flex-1 flex-col justify-center rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-[11px] text-slate-200">
                    <span className="text-slate-400">{copy.providerLabel}</span>
                    <span className="font-mono text-xs text-teal-100">{activePayment.payCode}</span>
                  </div>
                ) : null}
                <button
                  onClick={handleMockSuccess}
                  disabled={mocking}
                  className="inline-flex items-center justify-center rounded-lg border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-100 transition hover:border-teal-400 hover:text-teal-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {mocking ? "..." : copy.mockSuccess}
                </button>
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

      <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 shadow-inner shadow-slate-950/60">
        <h3 className="text-lg font-semibold text-teal-200">{copy.highlightTitle}</h3>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {copy.highlightItems.map((item) => (
            <div
              key={item}
              className="rounded-lg border border-slate-800 bg-slate-900/80 p-4 text-sm text-slate-200 shadow-inner shadow-slate-950/40"
            >
              {item}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
