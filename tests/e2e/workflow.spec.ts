import { expect, test, type Page } from "@playwright/test";
import { drainQueue } from "../../src/server/jobs/worker";
import { db } from "../../src/server/db";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByLabel("Password").fill("E2e-Test-Password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

test("signed-out visitors are redirected to sign in, and media requires a session", async ({ page, request }) => {
  await page.goto("/approval");
  await expect(page).toHaveURL(/\/login$/);
  const res = await request.get("/api/media/anything?exp=9999999999&sig=00");
  expect(res.status()).toBe(401);
});

test("wrong password shows a generic error", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("e2e@example.com");
  await page.getByLabel("Password").fill("Not-The-Password-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();
});

test("full workflow: prompt → simulated generation → full preview → approve → schedule → simulated publish", async ({ page }) => {
  await signIn(page);
  const concept = await db.contentConcept.findFirstOrThrow({ where: { title: "Sunrise rooftop workout" } });

  // Prompt builder
  await page.goto(`/studio?concept=${concept.id}`);
  await page.getByRole("button", { name: "Save prompt version" }).click();
  await expect(page.getByText("Prompt saved as a new version.")).toBeVisible();

  // Generation with the mock provider
  await page.getByRole("button", { name: "Submit generation job" }).click();
  await expect(page.getByText(/Generation job queued/)).toBeVisible();
  await drainQueue("e2e");
  const asset = await db.mediaAsset.findFirstOrThrow({ where: { conceptId: concept.id, kind: "VIDEO" } });

  // Approval: the approve button stays disabled until the preview is complete AND confirmed
  await page.goto(`/approval?asset=${asset.id}`);
  await expect(page.getByText("Simulated output", { exact: true })).toBeVisible();
  const approve = page.getByRole("button", { name: "Approve this version" });
  await expect(approve).toBeDisabled();
  await expect(page.getByText("✓ Full preview viewed.")).toBeVisible({ timeout: 10_000 });
  await expect(approve).toBeDisabled();
  await page.getByLabel(/I personally reviewed this exact version/).check();
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByText("Approved this exact version.")).toBeVisible();

  // Schedule to the simulated destination (first-use confirmation required)
  await page.goto("/calendar");
  await page.getByRole("button", { name: "Schedule", exact: true }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Destination", { exact: true })).toHaveValue(/.+/);
  const future = new Date(Date.now() + 3 * 86400_000).toISOString().slice(0, 10);
  await dialog.getByLabel("Date").fill(future);
  await dialog.getByLabel(/first publication/).check();
  await dialog.getByRole("button", { name: "Schedule" }).click();
  await expect(dialog).toBeHidden();
  // The plan moves to the scheduled day, which may be in the following week.
  await page.goto(`/calendar?date=${future}`);
  await expect(page.getByText("Queued").first()).toBeVisible();

  // Publish now → simulated confirmation, clearly labeled
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Publish now" }).click();
  await expect(page.getByText("Simulated publish").first()).toBeVisible();
  const post = await db.publishedPost.findFirstOrThrow({ where: { schedule: { conceptId: concept.id } } });
  expect(post.confirmationSource).toBe("SIMULATED_DESTINATION");
});

test("a manually uploaded thumbnail is accepted as a new asset version", async ({ page }) => {
  await signIn(page);
  const concept = await db.contentConcept.findFirstOrThrow({ where: { title: "Sunrise rooftop workout" } });
  await page.goto(`/studio?concept=${concept.id}`);
  const upload = page.locator("#upload");
  await upload.getByLabel("Type").selectOption("THUMBNAIL");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await upload.getByLabel("File").setInputFiles({ name: "thumb.png", mimeType: "image/png", buffer: png });
  await upload.getByRole("button", { name: "Upload" }).click();
  await expect(page.getByText(/Uploaded\./)).toBeVisible();
});

test("restricted workspace stays locked until attested with password", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("option", { name: /Adult \(restricted\) — locked/ })).toBeAttached();
  await page.goto("/settings/security");
  await page.getByLabel(/I am at least 18/).check();
  await page.getByLabel("Re-enter your password").fill("E2e-Test-Password-1");
  await page.getByRole("button", { name: "Unlock restricted workspace" }).click();
  // The unlock form is replaced by the confirmation and the workspace becomes selectable.
  await expect(page.getByText(/^Confirmed /)).toBeVisible();
  await expect(page.getByRole("option", { name: /Adult \(restricted\)$/ })).toBeAttached();
});

test("every page renders without console errors on a phone-sized screen", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  for (const p of ["/dashboard", "/studio", "/approval", "/calendar", "/library", "/analytics", "/settings/brand", "/settings/integrations", "/settings/security"]) {
    await page.goto(p);
    await expect(page.locator("h1").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${p} scrolls horizontally`).toBeLessThanOrEqual(1);
  }
  expect(errors).toEqual([]);
});
