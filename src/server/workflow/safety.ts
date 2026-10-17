import { AppError } from "../errors";

/**
 * Server-side content safety checks applied to every prompt, concept and character
 * before it can be saved or sent to a provider. These are hard blocks, not warnings.
 * They complement (never replace) the provider's own moderation.
 */
const MINOR_TERMS = [
  "child", "children", "kid", "kids", "minor", "minors", "underage", "under-age", "teen", "teens", "teenage",
  "teenager", "preteen", "pre-teen", "schoolboy", "schoolgirl", "school uniform", "highschool", "high school",
  "juvenile", "adolescent", "boy", "boys", "young-looking", "youthful-looking", "barely legal", "jailbait",
  "loli", "shota", "infant", "toddler", "baby-faced", "babyface",
  "13yo", "14yo", "15yo", "16yo", "17yo",
];
const AGE_PATTERN = /\b(1[0-7]|[1-9])\s*(?:-|\s)?(?:years?|yrs?|yo|y\/o)(?:\s*-?\s*old)?\b/i;

const IMPERSONATION_TERMS = ["deepfake of", "face swap with", "faceswap with", "looks exactly like", "in the likeness of"];

export type SafetyFinding = { field: string; reason: string };

export function scanText(field: string, text: string | null | undefined): SafetyFinding[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const findings: SafetyFinding[] = [];
  for (const term of MINOR_TERMS) {
    const re = new RegExp(`(^|[^a-z])${term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}([^a-z]|$)`, "i");
    if (re.test(lower)) {
      findings.push({ field, reason: `References minors or youthful appearance ("${term}"). Every depicted person must be a clearly adult.` });
      break;
    }
  }
  if (AGE_PATTERN.test(text)) findings.push({ field, reason: "Mentions an age under 18." });
  for (const term of IMPERSONATION_TERMS) {
    if (lower.includes(term)) {
      findings.push({ field, reason: `Looks like a request to use another person's likeness ("${term}"). Only your authorized references may be used.` });
      break;
    }
  }
  return findings;
}

export function scanFields(fields: Record<string, string | null | undefined>): SafetyFinding[] {
  return Object.entries(fields).flatMap(([k, v]) => scanText(k, v));
}

export function assertSafe(fields: Record<string, string | null | undefined>) {
  const findings = scanFields(fields);
  if (findings.length) {
    throw new AppError("POLICY_BLOCKED", `Blocked by content safety rules: ${findings.map((f) => `${f.field}: ${f.reason}`).join(" ")}`, { findings });
  }
}

export const MIN_CHARACTER_AGE = 21;
