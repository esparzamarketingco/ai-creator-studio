"use client";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const known = error.name === "AppError";
  return (
    <div className="mx-auto max-w-lg py-16">
      <Notice tone="danger" title="This page could not be loaded">
        {known ? error.message : "An unexpected error occurred. It was logged on the server."}
        {error.digest && <div className="mt-1 font-mono text-[11px] opacity-70">Reference: {error.digest}</div>}
      </Notice>
      <Button className="mt-4" variant="secondary" onClick={reset}>Try again</Button>
    </div>
  );
}
