import { cn } from "@/lib/cn";

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("rounded-2xl border border-ink-700 bg-ink-900/80 shadow-[0_1px_0_0_rgba(255,255,255,0.03)_inset]", className)} />;
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 border-b border-ink-800 px-5 py-4", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-wide text-white">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-ink-300">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("px-5 py-4", className)} />;
}
