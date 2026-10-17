import Link from "next/link";
import { requireActor } from "@/server/auth/context";
import { currentWorkspace } from "@/server/current-workspace";
import { listNotifications } from "@/server/services/notifications";
import { db } from "@/server/db";
import { NavLinks } from "@/components/shell/sidebar";
import { MobileNav, NotificationCenter, UserMenu, WorkspaceSwitcher } from "@/components/shell/topbar";
import { mockProvidersEnabled } from "@/server/env";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const [{ current, all }, notes] = await Promise.all([currentWorkspace(actor), listNotifications(actor)]);
  const pending = current
    ? await db.mediaAsset.count({ where: { workspaceId: current.id, kind: "VIDEO", deletedAt: null, archivedAt: null, currentVersionId: { not: null }, currentVersion: { approvals: { none: {} } } } })
    : 0;
  const badges = { "/approval": pending };
  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col border-r border-ink-800 bg-ink-900/60 px-3 py-5 lg:flex">
        <Link href="/dashboard" className="mb-8 px-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-gold-400">Private</div>
          <div className="text-base font-semibold tracking-tight text-white">AI Creator Studio</div>
        </Link>
        <div className="flex-1 overflow-y-auto"><NavLinks badges={badges} /></div>
        <div className="mt-4 rounded-xl border border-ink-700 bg-ink-850 p-3 text-[11px] leading-relaxed text-ink-400">
          Nothing is published without your explicit approval of the exact final file.
        </div>
      </aside>
      <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b border-ink-800 bg-ink-950/85 px-3 backdrop-blur sm:px-6">
        <MobileNav badges={badges} />
        <WorkspaceSwitcher workspaces={all.map((w) => ({ id: w.id, name: w.name, kind: w.kind, locked: w.locked }))} currentId={current?.id ?? null} />
        {current?.kind === "ADULT" && <span className="hidden rounded-full border border-red-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-300 sm:inline">Restricted · 18+</span>}
        {mockProvidersEnabled() && <span className="hidden rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300 md:inline" title="Mock providers produce labeled simulated output only">Mock providers on</span>}
        <div className="ml-auto flex items-center gap-1">
          <NotificationCenter items={notes.items} unread={notes.unread} />
          <UserMenu name={actor.user.name} email={actor.user.email} />
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
