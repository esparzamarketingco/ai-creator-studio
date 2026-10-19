import { mockProvidersEnabled } from "../env";
import { manualDestination } from "./manual";
import { mockDestination, mockImageProvider, mockVideoProvider } from "./mock";
import type { GenerationProvider, PublishingDestination } from "./types";
import { generationAdapters, publishingAdapters } from "./adapters";

/** Real adapters are listed in ./adapters (see README → "Connecting a real provider"). */
const realGenerators: GenerationProvider[] = [...generationAdapters];
const realDestinations: PublishingDestination[] = [...publishingAdapters];

/** Tests and plugins can also register an adapter at runtime. */
export function registerGenerationProvider(p: GenerationProvider) {
  if (!realGenerators.some((g) => g.key === p.key)) realGenerators.push(p);
}
export function registerPublishingDestination(d: PublishingDestination) {
  if (!realDestinations.some((x) => x.key === d.key)) realDestinations.push(d);
}

export function generationProviders(): GenerationProvider[] {
  return [...realGenerators, ...(mockProvidersEnabled() ? [mockVideoProvider, mockImageProvider] : [])];
}

export function publishingDestinations(): PublishingDestination[] {
  return [manualDestination, ...realDestinations, ...(mockProvidersEnabled() ? [mockDestination] : [])];
}

export const getGenerator = (key: string) => generationProviders().find((p) => p.key === key) ?? null;
export const getDestination = (key: string) => publishingDestinations().find((d) => d.key === key) ?? null;

/** Catalog shown in Settings → Integrations: what can be connected and what is not possible. */
export type CatalogEntry = {
  providerKey: string;
  kind: "VIDEO_GENERATION" | "IMAGE_GENERATION" | "STORAGE" | "PUBLISHING" | "ANALYTICS" | "NOTIFICATIONS";
  displayName: string;
  availability: "available" | "simulated" | "adapter_not_built" | "no_official_api";
  notes: string;
  docsUrl?: string;
};

export const INTEGRATION_CATALOG: CatalogEntry[] = [
  { providerKey: "mock-video", kind: "VIDEO_GENERATION", displayName: "Mock video generator", availability: "simulated", notes: "Development only. Produces a labeled SIMULATED placeholder, never a real video. Not permitted in the restricted workspace." },
  { providerKey: "mock-image", kind: "IMAGE_GENERATION", displayName: "Mock image & thumbnail generator", availability: "simulated", notes: "Development only. Produces a labeled SIMULATED placeholder." },
  { providerKey: "custom-video-api", kind: "VIDEO_GENERATION", displayName: "Your video generation provider", availability: "adapter_not_built", notes: "Add an adapter implementing GenerationProvider (src/server/providers/types.ts) after verifying the provider's API, adult-content policy, likeness rules, commercial-use rights and pricing." },
  { providerKey: "custom-image-api", kind: "IMAGE_GENERATION", displayName: "Your image generation provider", availability: "adapter_not_built", notes: "Same adapter contract as video. Thumbnails use the image provider." },
  { providerKey: "storage", kind: "STORAGE", displayName: "Private media storage", availability: "available", notes: "Configured with environment variables (STORAGE_DRIVER=local, s3 or database). Status reflects the running server." },
  { providerKey: "manual", kind: "PUBLISHING", displayName: "Manual publishing package", availability: "available", notes: manualDestination.notes },
  { providerKey: "onlyfans", kind: "PUBLISHING", displayName: "OnlyFans", availability: "no_official_api", notes: "OnlyFans does not offer a public, officially supported posting API for creators. Use the manual publishing package; the app will not automate the website or store your password.", docsUrl: "https://onlyfans.com/terms" },
  { providerKey: "mock-destination", kind: "PUBLISHING", displayName: "Simulated destination", availability: "simulated", notes: mockDestination.notes },
  { providerKey: "csv-import", kind: "ANALYTICS", displayName: "CSV statement import", availability: "available", notes: "Import statistics you export from your platform. Each import is labeled with its file name and import date." },
  { providerKey: "email", kind: "NOTIFICATIONS", displayName: "Email (SMTP)", availability: "available", notes: "Set SMTP_URL to send password resets and alerts by email. In-app notifications always work." },
];
