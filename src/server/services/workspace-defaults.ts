import type { Prisma } from "@prisma/client";

export const DEFAULT_WORKSPACES: Prisma.WorkspaceCreateInput[] = [
  {
    slug: "lifestyle",
    name: "A · Sensual, Fitness & Lifestyle",
    kind: "LIFESTYLE",
    description: "Fitness, swimwear, fashion, travel, lifestyle and suggestive editorial concepts with adult male models.",
    disclosureText: "AI-assisted content. Scenes are synthetic.",
    categories: ["Fitness", "Swimwear", "Fashion", "Travel", "Lifestyle", "Editorial"],
    intensityLevels: ["Everyday", "Editorial", "Suggestive"],
    exportSettings: { defaultAspectRatio: "9:16", defaultResolution: "1080x1920" },
  },
  {
    slug: "adult",
    name: "B · Adult (restricted)",
    kind: "ADULT",
    description: "Restricted workspace for lawful adult content. Generation only through providers whose terms explicitly permit it.",
    disclosureText: "AI-generated adult content featuring a synthetic, adult (21+) character. Created with authorized likeness.",
    categories: ["Solo", "Artistic nude", "Explicit"],
    intensityLevels: ["Implied", "Nude", "Explicit"],
    exportSettings: { defaultAspectRatio: "9:16", defaultResolution: "1080x1920" },
  },
];
