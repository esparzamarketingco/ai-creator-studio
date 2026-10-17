/**
 * Development seed. Creates an owner account (if none exists), both workspaces, a fictional
 * adult character and a week of NON-EXPLICIT lifestyle concepts. Never run against production.
 *
 *   SEED_EMAIL=you@example.com SEED_PASSWORD='Choose-A-Strong-Pass1' npm run db:seed
 */
import { db } from "../src/server/db";
import { register } from "../src/server/services/auth";
import { createConcept } from "../src/server/services/concepts";
import { saveCharacter } from "../src/server/services/brand";
import { ensureBuiltinIntegrations } from "../src/server/services/integrations";
import { dateInTz, weekDates } from "../src/server/time";

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Refusing to seed in production.");
  if (await db.user.count()) {
    console.log("Users already exist; seed skipped.");
    return;
  }
  const email = process.env.SEED_EMAIL ?? "owner@example.com";
  const password = process.env.SEED_PASSWORD ?? "Studio-Dev-Pass-2026";
  const user = await register({ name: "Studio Owner", email, password, confirmAdult: true });
  const actor = { userId: user.id, role: user.role };
  const lifestyle = await db.workspace.findUniqueOrThrow({ where: { slug: "lifestyle" } });
  const adult = await db.workspace.findUniqueOrThrow({ where: { slug: "adult" } });
  await ensureBuiltinIntegrations(lifestyle.id);
  await ensureBuiltinIntegrations(adult.id);
  const character = await saveCharacter(actor, {
    name: "Marco (fictional)", apparentAge: 30, adultConfirmed: true, description: "Confident, warm fitness and lifestyle persona.",
    physique: "Athletic swimmer's build", styleNotes: "Clean, minimal wardrobe; earth tones", continuityRules: "Short dark hair, light stubble, small scar on left eyebrow",
  });
  const ideas = [
    ["Sunrise rooftop workout", "Fitness", "Rooftop gym at sunrise", "Warm golden-hour backlight"],
    ["Poolside morning routine", "Swimwear", "Resort pool, Miami", "Soft morning daylight"],
    ["Tailored linen editorial", "Fashion", "Minimal white studio", "High-key softbox"],
    ["Desert road trip", "Travel", "Joshua Tree highway", "Late afternoon sun"],
    ["Coffee & journaling", "Lifestyle", "Sunlit loft apartment", "Window light"],
    ["Boxing gym session", "Fitness", "Industrial boxing gym", "Moody top light"],
    ["Beach sunset walk", "Lifestyle", "Malibu beach", "Sunset rim light"],
  ];
  const week = weekDates(dateInTz(new Date(), lifestyle.defaultTimezone));
  for (const [i, [title, category, location, lighting]] of ideas.entries()) {
    await createConcept(actor, {
      workspaceId: lifestyle.id, title, category, intensityLevel: "Editorial", characterId: character.id, location, lighting,
      scene: `${title} — natural, confident movement`, camera: "Slow push-in, 35mm, eye level", visualStyle: "Cinematic, natural color",
      caption: `${title}. New drop today.`, hashtags: ["fitness", "lifestyle"], callToAction: "Subscribe for the full series",
      plannedDate: week[i], plannedTime: "18:00", timezone: "America/New_York", tags: [category.toLowerCase()],
    });
  }
  console.log(`Seeded owner ${email} / ${password} with 7 lifestyle concepts. Change the password after signing in.`);
}

main().then(() => db.$disconnect()).catch(async (e) => { console.error(e); await db.$disconnect(); process.exit(1); });
