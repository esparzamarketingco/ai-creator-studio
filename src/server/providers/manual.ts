import type { PublishingDestination } from "./types";

/**
 * Manual publishing: for platforms with no official posting API (e.g. OnlyFans), the app
 * prepares the approved media package and a checklist; the creator posts it themselves and
 * then confirms with the post URL. Nothing is automated against the platform.
 */
export const manualDestination: PublishingDestination = {
  key: "manual",
  displayName: "Manual publishing package",
  isSimulated: false,
  supportsDirectPublish: false,
  allowsAdultContent: true, // the creator posts personally and is responsible for the platform's rules
  requiresCredentials: false,
  notes:
    "Prepares a download package (approved file, caption, hashtags, disclosure, checklist). You post it yourself on the platform and confirm with the post link. No passwords are stored.",
  async healthCheck() {
    return { ok: true, message: "Manual packages need no connection." };
  },
  async publish() {
    return { state: "manual_required" };
  },
};
