import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "success";
const styles: Record<Variant, string> = {
  primary: "bg-gold-400 text-ink-950 hover:bg-gold-300 disabled:bg-gold-600/60",
  secondary: "bg-ink-700 text-ink-100 hover:bg-ink-600 border border-ink-600",
  ghost: "text-ink-200 hover:bg-ink-800 hover:text-white",
  danger: "bg-red-500/15 text-red-300 border border-red-500/40 hover:bg-red-500/25",
  success: "bg-emerald-500/15 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/25",
};

export function buttonClass(variant: Variant = "primary", size: "sm" | "md" = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    size === "sm" ? "h-8 px-3 text-xs" : "h-10 px-4 text-sm",
    styles[variant],
    extra,
  );
}

export function Button({ variant = "primary", size = "md", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cn("inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent", className)} />;
}
