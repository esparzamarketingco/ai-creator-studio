import Link from "next/link";
import { cn } from "@/lib/cn";
import { buttonClass } from "./button";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-gold-400">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-ink-300">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: React.ReactNode; action?: { href: string; label: string } | React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-600 px-6 py-12 text-center">
      <div className="mb-3 size-10 rounded-full border border-ink-600 bg-ink-850" aria-hidden />
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm text-ink-300">{description}</p>}
      {action && (
        <div className="mt-4">
          {typeof action === "object" && action !== null && "href" in (action as object) ? (
            <Link href={(action as { href: string }).href} className={buttonClass("secondary")}>{(action as { label: string }).label}</Link>
          ) : (action as React.ReactNode)}
        </div>
      )}
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warn" | "danger" | "success"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const s = { info: "border-sky-500/30 bg-sky-500/5 text-sky-100", warn: "border-amber-500/30 bg-amber-500/5 text-amber-100", danger: "border-red-500/30 bg-red-500/5 text-red-100", success: "border-emerald-500/30 bg-emerald-500/5 text-emerald-100" }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-xl border px-4 py-3 text-sm", s, className)}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={cn(title ? "mt-0.5" : "", "opacity-90")}>{children}</div>}
    </div>
  );
}

export function StatTile({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: "red" | "gold" }) {
  const inner = (
    <div className={cn("h-full rounded-2xl border bg-ink-900/80 p-4 transition-colors", tone === "red" ? "border-red-500/30" : tone === "gold" ? "border-gold-500/40" : "border-ink-700", href && "hover:border-ink-500")}>
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-300">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-ink-400">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block">{inner}</Link> : inner;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-lg bg-ink-800", className)} />;
}
