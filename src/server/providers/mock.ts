import { randomToken } from "../crypto";
import type { GenerationPoll, GenerationProvider, GenerationRequest, PublishingDestination } from "./types";

/**
 * DEVELOPMENT-ONLY simulated providers. They produce a labeled SVG placeholder — never a
 * real image or video — so the workflow can be exercised end-to-end without credentials.
 */
const pending = new Map<string, { req: GenerationRequest; polls: number }>();

function placeholderSvg(req: GenerationRequest): Buffer {
  const [w, h] = req.aspectRatio === "16:9" ? [1280, 720] : req.aspectRatio === "1:1" ? [1000, 1000] : [720, 1280];
  const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const prompt = esc(req.positivePrompt.slice(0, 140));
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="20" height="40" fill="#1c1c1f"/></pattern></defs>
  <rect width="100%" height="100%" fill="#111113"/><rect width="100%" height="100%" fill="url(#p)"/>
  <rect x="${w * 0.08}" y="${h * 0.4}" width="${w * 0.84}" height="${h * 0.2}" rx="16" fill="#000" stroke="#f59e0b" stroke-width="4"/>
  <text x="50%" y="${h * 0.47}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(w / 16)}" font-weight="700" fill="#f59e0b">SIMULATED OUTPUT</text>
  <text x="50%" y="${h * 0.53}" text-anchor="middle" font-family="sans-serif" font-size="${Math.round(w / 40)}" fill="#e5e5e5">Mock ${req.kind.toLowerCase()} provider · not a real generation</text>
  <text x="50%" y="${h * 0.57}" text-anchor="middle" font-family="monospace" font-size="${Math.round(w / 60)}" fill="#a3a3a3">${prompt}</text>
  <text x="50%" y="${h * 0.95}" text-anchor="middle" font-family="monospace" font-size="${Math.round(w / 55)}" fill="#737373">${new Date().toISOString()} · ${req.durationSec}s · ${req.resolution}</text>
</svg>`,
  );
}

function mockGenerator(key: string, displayName: string, kinds: GenerationRequest["kind"][]): GenerationProvider {
  return {
    key,
    displayName,
    kinds,
    isSimulated: true,
    // The mock never permits adult content: that requires a real provider
    // whose terms explicitly allow it (verified in Settings → Integrations). Reference images
    // passed to the mock never leave the server.
    capabilities: { allowsAdultContent: false, allowsLikeness: true, maxDurationSec: 60, aspectRatios: ["9:16", "16:9", "1:1", "4:5"] },
    async submit(req) {
      const id = `mock_${randomToken(9)}`;
      pending.set(id, { req, polls: 0 });
      return { externalJobId: id };
    },
    async poll(id): Promise<GenerationPoll> {
      const job = pending.get(id);
      if (!job) return { state: "failed", error: "Unknown mock job (the worker may have restarted). Retry the job.", retryable: true };
      job.polls += 1;
      if (job.req.positivePrompt.includes("[mock-fail]")) {
        pending.delete(id);
        return { state: "failed", error: "Simulated provider failure (prompt contained [mock-fail]).", retryable: true };
      }
      if (job.polls < 2) return { state: "running", progress: 50 };
      pending.delete(id);
      return { state: "succeeded", output: { data: placeholderSvg(job.req), mime: "image/svg+xml" }, meta: { simulated: true } };
    },
  };
}

export const mockVideoProvider = mockGenerator("mock-video", "Mock video generator (simulated)", ["VIDEO"]);
export const mockImageProvider = mockGenerator("mock-image", "Mock image & thumbnail generator (simulated)", ["IMAGE", "THUMBNAIL"]);

/** Simulated destination: records a fake confirmation clearly labeled as simulated. Posts nothing. */
export const mockDestination: PublishingDestination = {
  key: "mock-destination",
  displayName: "Simulated destination (development)",
  isSimulated: true,
  supportsDirectPublish: true,
  allowsAdultContent: false,
  requiresCredentials: false,
  notes: "Nothing is posted anywhere. Use it to rehearse the scheduling flow. Results are labeled SIMULATED.",
  async healthCheck() {
    return { ok: true, message: "Simulated destination is always available." };
  },
  async publish(req) {
    if (req.caption.includes("[mock-fail]")) return { state: "failed", error: "Simulated destination failure.", retryable: true };
    return { state: "confirmed", externalPostId: `simulated_${randomToken(8)}` };
  },
};
