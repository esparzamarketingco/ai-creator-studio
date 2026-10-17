"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { NAV, SETTINGS_NAV } from "./nav";
import { Icon } from "./icon";

export function NavLinks({ onNavigate, badges }: { onNavigate?: () => void; badges?: Record<string, number> }) {
  const path = usePathname();
  const item = (n: { href: string; label: string; icon: string }) => {
    const active = path === n.href || path.startsWith(`${n.href}/`);
    const badge = badges?.[n.href];
    return (
      <Link key={n.href} href={n.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
        className={cn("group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", active ? "bg-ink-800 text-white" : "text-ink-300 hover:bg-ink-850 hover:text-white")}>
        <Icon d={n.icon} className={cn("size-4", active ? "text-gold-400" : "text-ink-400 group-hover:text-ink-200")} />
        <span className="flex-1">{n.label}</span>
        {badge ? <span className="rounded-full bg-gold-400 px-1.5 text-[10px] font-bold text-ink-950">{badge}</span> : null}
      </Link>
    );
  };
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {NAV.map(item)}
      <div className="mb-1 mt-5 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-500">Settings</div>
      {SETTINGS_NAV.map(item)}
    </nav>
  );
}
