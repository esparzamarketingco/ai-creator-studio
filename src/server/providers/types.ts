/**
 * Provider-independent interfaces. Every external service (generation, publishing, analytics)
 * is reached only through one of these, so a provider can be swapped without touching the
 * workflow, approval or scheduling code.
 */

export type ProviderCapabilities = {
  /** Provider's published terms explicitly permit adult content. Required for the ADULT workspace. */
  allowsAdultContent: boolean;
  /** Provider supports reference-image / authorized-likeness workflows. */
  allowsLikeness: boolean;
  maxDurationSec?: number;
  aspectRatios?: string[];
};

export type GenerationRequest = {
  kind: "VIDEO" | "IMAGE" | "THUMBNAIL";
  positivePrompt: string;
  negativePrompt: string;
  durationSec: number;
  aspectRatio: string;
  resolution: string;
  /** Private reference images (bytes), only when an authorized likeness is attached. */
  referenceImages: { mime: string; data: Buffer }[];
  idempotencyKey: string;
};

export type GenerationPoll =
  | { state: "running"; progress?: number }
  | { state: "succeeded"; output: { data: Buffer; mime: string }; meta?: Record<string, unknown> }
  | { state: "failed"; error: string; retryable: boolean };

export interface GenerationProvider {
  key: string;
  displayName: string;
  kinds: GenerationRequest["kind"][];
  /** Simulated providers never call an external service and their output is always labeled. */
  isSimulated: boolean;
  capabilities: ProviderCapabilities;
  docsUrl?: string;
  submit(req: GenerationRequest, credentials: Record<string, string>): Promise<{ externalJobId: string }>;
  poll(externalJobId: string, credentials: Record<string, string>): Promise<GenerationPoll>;
}

export type PublishRequest = {
  media: { data: Buffer; mime: string; filename: string };
  caption: string;
  hashtags: string[];
  disclosureText: string;
  idempotencyKey: string;
};

export type PublishResult =
  | { state: "confirmed"; externalPostId: string; url?: string }
  | { state: "manual_required" }
  | { state: "failed"; error: string; retryable: boolean };

export interface PublishingDestination {
  key: string;
  displayName: string;
  isSimulated: boolean;
  /** true only when an official, documented API is used. */
  supportsDirectPublish: boolean;
  allowsAdultContent: boolean;
  requiresCredentials: boolean;
  notes: string;
  healthCheck(credentials: Record<string, string>): Promise<{ ok: boolean; message: string }>;
  publish(req: PublishRequest, credentials: Record<string, string>): Promise<PublishResult>;
}

export interface AnalyticsSource {
  key: string;
  displayName: string;
  isSimulated: boolean;
  fetch(credentials: Record<string, string>, range: { start: Date; end: Date }): Promise<
    { periodStart: Date; periodEnd: Date; metrics: Record<string, number> }[]
  >;
}
