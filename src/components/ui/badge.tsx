import { cn } from "@/lib/cn";

export type Tone = "neutral" | "gold" | "green" | "red" | "amber" | "blue" | "violet";
const tones: Record<Tone, string> = {
  neutral: "bg-ink-700/70 text-ink-200 ring-ink-600",
  gold: "bg-gold-400/10 text-gold-300 ring-gold-500/40",
  green: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/40",
  red: "bg-red-500/10 text-red-300 ring-red-500/40",
  amber: "bg-amber-500/10 text-amber-300 ring-amber-500/40",
  blue: "bg-sky-500/10 text-sky-300 ring-sky-500/40",
  violet: "bg-violet-500/10 text-violet-300 ring-violet-500/40",
};

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span {...props} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", tones[tone], className)} />;
}

export function SimulatedBadge() {
  return <Badge tone="amber" title="Produced by a mock provider. Not a real generation and never publishable to a real destination.">SIMULATED</Badge>;
}

export function DemoBadge() {
  return <Badge tone="amber" title="Demo data, not real performance.">DEMO DATA</Badge>;
}
