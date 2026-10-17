export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-12">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,rgba(217,184,113,0.12),transparent_55%)]" />
      <div className="relative w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-gold-400">Private</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight text-white">AI Creator Studio</div>
        </div>
        <div className="rounded-2xl border border-ink-700 bg-ink-900/90 p-6 shadow-2xl shadow-black/50 sm:p-8">{children}</div>
      </div>
    </main>
  );
}
