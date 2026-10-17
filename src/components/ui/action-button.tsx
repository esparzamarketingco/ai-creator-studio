"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/server/errors";
import { Button, Spinner } from "./button";

/** A button that runs a server action, shows progress, and reports the real result. */
export function ActionButton({ action, children, confirm, variant = "secondary", size = "sm", pendingLabel, className, showSuccess = true, disabled }: {
  action: () => Promise<ActionResult<unknown>>;
  children: React.ReactNode;
  confirm?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: "sm" | "md";
  pendingLabel?: string;
  className?: string;
  showSuccess?: boolean;
  disabled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" variant={variant} size={size} className={className} disabled={pending || disabled} aria-busy={pending}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          start(async () => {
            const r = await action();
            setMsg(r.ok ? (showSuccess && r.message ? { ok: true, text: r.message } : null) : { ok: false, text: r.error });
            if (r.ok) router.refresh();
          });
        }}>
        {pending && <Spinner className="size-3" />}
        {pending ? (pendingLabel ?? "Working…") : children}
      </Button>
      {msg && <span role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-[11px] text-emerald-300" : "max-w-xs text-[11px] text-red-300"}>{msg.text}</span>}
    </span>
  );
}
