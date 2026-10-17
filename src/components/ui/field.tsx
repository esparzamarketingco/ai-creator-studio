"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

const control = "w-full rounded-lg border border-ink-600 bg-ink-850 px-3 text-sm text-white placeholder:text-ink-400 focus:border-gold-400 focus:outline-none focus:ring-1 focus:ring-gold-400 disabled:opacity-60 aria-[invalid=true]:border-red-500";

export function Label({ children, htmlFor, hint }: { children: React.ReactNode; htmlFor?: string; hint?: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-ink-200">
      {children}
      {hint && <span className="ml-1 font-normal text-ink-400">{hint}</span>}
    </label>
  );
}

export function FieldError({ errors }: { errors?: string[] }) {
  if (!errors?.length) return null;
  return <p className="mt-1 text-xs text-red-300" role="alert">{errors.join(" ")}</p>;
}

type Common = { label?: React.ReactNode; hint?: React.ReactNode; errors?: string[]; className?: string };

export function Input({ label, hint, errors, className, id, ...props }: Common & React.InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <div className={className}>
      {label && <Label htmlFor={fid} hint={hint}>{label}</Label>}
      <input id={fid} aria-invalid={errors?.length ? true : undefined} {...props} className={cn(control, "h-10")} />
      <FieldError errors={errors} />
    </div>
  );
}

export function Textarea({ label, hint, errors, className, id, ...props }: Common & React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <div className={className}>
      {label && <Label htmlFor={fid} hint={hint}>{label}</Label>}
      <textarea id={fid} aria-invalid={errors?.length ? true : undefined} rows={3} {...props} className={cn(control, "py-2 leading-relaxed")} />
      <FieldError errors={errors} />
    </div>
  );
}

export function Select({ label, hint, errors, className, id, children, ...props }: Common & React.SelectHTMLAttributes<HTMLSelectElement>) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <div className={className}>
      {label && <Label htmlFor={fid} hint={hint}>{label}</Label>}
      <select id={fid} aria-invalid={errors?.length ? true : undefined} {...props} className={cn(control, "h-10")}>
        {children}
      </select>
      <FieldError errors={errors} />
    </div>
  );
}

export function Checkbox({ label, errors, className, id, ...props }: Common & React.InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId();
  const fid = id ?? autoId;
  return (
    <div className={className}>
      <label htmlFor={fid} className="flex cursor-pointer items-start gap-2.5 text-sm text-ink-200">
        <input id={fid} type="checkbox" {...props} className="mt-0.5 size-4 shrink-0 rounded border-ink-500 bg-ink-850 accent-[var(--color-gold-400)]" />
        <span>{label}</span>
      </label>
      <FieldError errors={errors} />
    </div>
  );
}
