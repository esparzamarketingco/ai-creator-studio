"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchWorkspaceAction, markReadAction } from "@/app/actions/shell";
import { logoutAction } from "@/app/actions/auth";
import { cn } from "@/lib/cn";
import { NavLinks } from "./sidebar";
import { Icon } from "./icon";

type Ws = { id: string; name: string; kind: string; locked: boolean };
type Note = { id: string; title: string; body: string; link: string | null; readAt: Date | null; createdAt: Date; type: string };

function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onOut(); };
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [ref, onOut]);
}

export function WorkspaceSwitcher({ workspaces, currentId }: { workspaces: Ws[]; currentId: string | null }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="min-w-0">
      <label htmlFor="ws-switch" className="sr-only">Workspace</label>
      <select id="ws-switch" value={currentId ?? ""} disabled={pending}
        onChange={(e) => start(async () => { const r = await switchWorkspaceAction(e.target.value); if (!r.ok) setError(r.error); else { setError(null); router.refresh(); } })}
        className="h-9 max-w-[16rem] truncate rounded-lg border border-ink-600 bg-ink-850 px-2 text-sm text-white focus:border-gold-400 focus:outline-none">
        {workspaces.map((w) => (
          <option key={w.id} value={w.id} disabled={w.locked}>{w.name}{w.locked ? " — locked" : ""}</option>
        ))}
      </select>
      {error && <span role="alert" className="ml-2 text-xs text-red-300">{error}</span>}
    </div>
  );
}

export function NotificationCenter({ items, unread }: { items: Note[]; unread: number }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open} onClick={() => setOpen(!open)} className="relative grid size-9 place-items-center rounded-lg text-ink-200 hover:bg-ink-800">
        <Icon d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 004 0" />
        {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-gold-400 px-1 text-[10px] font-bold text-ink-950">{unread > 9 ? "9+" : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-2xl">
          <div className="flex items-center justify-between border-b border-ink-700 px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            <button disabled={pending || !unread} onClick={() => start(() => markReadAction())} className="text-xs text-gold-300 hover:underline disabled:opacity-40">Mark all read</button>
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-8 text-center text-sm text-ink-400">You are all caught up.</li>}
            {items.map((n) => (
              <li key={n.id} className={cn("border-b border-ink-800 px-4 py-3 last:border-0", !n.readAt && "bg-ink-850")}>
                <Link href={n.link ?? "#"} onClick={() => { setOpen(false); if (!n.readAt) start(() => markReadAction([n.id])); }} className="block">
                  <div className="flex items-start gap-2">
                    {!n.readAt && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-gold-400" />}
                    <div className="min-w-0">
                      <div className="text-sm text-white">{n.title}</div>
                      {n.body && <div className="mt-0.5 line-clamp-2 text-xs text-ink-300">{n.body}</div>}
                      <div className="mt-1 text-[11px] text-ink-500">{new Date(n.createdAt).toLocaleString()}</div>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false));
  return (
    <div className="relative" ref={ref}>
      <button aria-expanded={open} aria-label="Account menu" onClick={() => setOpen(!open)} className="grid size-9 place-items-center rounded-full border border-ink-600 bg-ink-800 text-sm font-semibold text-gold-300 hover:border-ink-500">
        {name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-xl border border-ink-600 bg-ink-900 shadow-2xl">
          <div className="border-b border-ink-700 px-4 py-3">
            <div className="truncate text-sm font-medium text-white">{name}</div>
            <div className="truncate text-xs text-ink-400">{email}</div>
          </div>
          <div className="p-1">
            <Link href="/settings/brand" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink-200 hover:bg-ink-800">Brand & identity</Link>
            <Link href="/settings/security" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 text-sm text-ink-200 hover:bg-ink-800">Security</Link>
            <form action={logoutAction}>
              <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-300 hover:bg-ink-800">Sign out</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export function MobileNav({ badges }: { badges?: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button aria-label="Open navigation" aria-expanded={open} onClick={() => setOpen(true)} className="grid size-9 place-items-center rounded-lg text-ink-200 hover:bg-ink-800 lg:hidden">
        <Icon d="M4 6h16M4 12h16M4 18h16" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
          <div className="absolute inset-0 bg-black/70" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-ink-700 bg-ink-900 p-4">
            <div className="mb-6 flex items-center justify-between">
              <span className="text-sm font-semibold tracking-tight">AI Creator Studio</span>
              <button aria-label="Close navigation" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg hover:bg-ink-800"><Icon d="M6 6l12 12M18 6L6 18" /></button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} badges={badges} />
          </div>
        </div>
      )}
    </>
  );
}
