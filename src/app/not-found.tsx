import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 text-center">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.3em] text-gold-400">404</div>
        <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
        <Link href="/dashboard" className="mt-4 inline-block text-sm text-gold-300 hover:underline">Back to dashboard</Link>
      </div>
    </main>
  );
}
