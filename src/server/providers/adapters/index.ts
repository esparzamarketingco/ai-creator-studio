import type { GenerationProvider, PublishingDestination } from "../types";

/**
 * Real provider adapters. Add one here only after verifying the provider's official API,
 * content policy (adult content, likeness rules), commercial-use rights and pricing.
 * Credentials are never read here: they are passed in per call from encrypted storage.
 * See README → "Connecting a real provider".
 */
export const generationAdapters: GenerationProvider[] = [];
export const publishingAdapters: PublishingDestination[] = [];
