"use client";
import { useFormStatus } from "react-dom";
import { Button, Spinner } from "./button";

export function SubmitButton({ children, pendingLabel, ...props }: React.ComponentProps<typeof Button> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || props.disabled} aria-busy={pending} {...props}>
      {pending && <Spinner />}
      {pending ? (pendingLabel ?? "Working…") : children}
    </Button>
  );
}
