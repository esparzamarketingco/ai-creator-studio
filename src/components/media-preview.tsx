"use client";
import { useEffect, useState } from "react";
import { signedUrlAction } from "@/app/actions/content";
import { SimulatedBadge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/button";
import { cn } from "@/lib/cn";

/**
 * Loads a short-lived signed URL for a private asset version and renders it.
 * `onComplete` fires when a video has played to the end, or when an image has been on screen
 * long enough to be reviewed (used to gate approval).
 */
export function MediaPreview({ versionId, mimeType, isSimulated, className, onComplete, controls = true }: {
  versionId: string; mimeType: string; isSimulated?: boolean; className?: string; onComplete?: () => void; controls?: boolean;
}) {
  // The loaded result remembers which version it belongs to, so switching versions shows the spinner again.
  const [loaded, setLoaded] = useState<{ versionId: string; url: string | null; error: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    signedUrlAction(versionId).then((r) => {
      if (!alive) return;
      setLoaded({ versionId, url: r.ok && r.data ? r.data : null, error: r.ok ? (r.data ? null : "Unavailable") : r.error });
    });
    return () => { alive = false; };
  }, [versionId]);
  const current = loaded?.versionId === versionId ? loaded : null;
  const url = current?.url ?? null;
  const error = current?.error ?? null;
  useEffect(() => {
    if (!url || mimeType.startsWith("video/") || !onComplete) return;
    const t = setTimeout(onComplete, 1500);
    return () => clearTimeout(t);
  }, [url, mimeType, onComplete]);
  // Media fills the box absolutely and letterboxes inside it, so a 9:16 video in a 16:9 frame is shown whole, not cropped.
  return (
    <div className={cn("relative grid place-items-center overflow-hidden rounded-xl bg-black", className)}>
      {isSimulated && <div className="absolute left-2 top-2 z-10"><SimulatedBadge /></div>}
      {!url && !error && <Spinner className="text-ink-400" />}
      {error && <p role="alert" className="p-4 text-center text-xs text-red-300">{error}</p>}
      {url && mimeType.startsWith("video/") && (
        <video key={url} src={url} controls={controls} playsInline preload="metadata" onEnded={onComplete} className="absolute inset-0 h-full w-full object-contain" />
      )}
      {url && !mimeType.startsWith("video/") && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={isSimulated ? "Simulated placeholder output" : "Asset preview"} className="absolute inset-0 h-full w-full object-contain" />
      )}
    </div>
  );
}
