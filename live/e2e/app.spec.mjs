// The main flows in the web app (app/live.html) against the local back end.
import { expect, test } from "@playwright/test";

const APP = "/live.html#";

test("landing page: service status, characters, both ways to call", async ({ page }) => {
  await page.goto(`${APP}/`);
  await expect(page.getByTestId("service-status").first()).toContainText("running on this machine");
  await expect(page.getByRole("heading", { name: /Real-time calls/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Start a video call" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Voice only" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Call Santa/ })).toBeVisible();
});

test("video call: pick a character, talk by typing, see the face, end the call", async ({ page }) => {
  await page.goto(`${APP}/characters`);
  await page.getByTestId("character-card").filter({ hasText: "Ben" }).click();
  await page.getByTestId("start-video").click();
  await expect(page).toHaveURL(/#\/call\/Ben/);

  await page.getByTestId("call-button").click();
  await expect(page.getByTestId("call-state")).toContainText("your turn", { timeout: 15_000 });
  // Frames are flowing from the face worker: the canvas is shown over the still portrait.
  await expect(page.getByTestId("face-canvas")).not.toHaveClass(/opacity-0/, { timeout: 10_000 });

  await page.getByRole("button", { name: "Log" }).click();
  await page.getByLabel("Message").fill("hello Ben");
  await page.getByRole("button", { name: "Send" }).click();
  const log = page.getByTestId("call-log");
  await expect(log.locator('[data-kind="you"]').first()).toHaveText("hello Ben");
  await expect(log.locator('[data-kind="bot"]').first()).toContainText("You said hello Ben", { timeout: 10_000 });

  // Switch face mid-call: a new person, a new conversation.
  await page.getByRole("button", { name: "Faces" }).click();
  await page.getByRole("dialog", { name: "Pick a face" }).getByTestId("character-card").filter({ hasText: "Ada" }).click();
  await expect(log).toContainText("Now talking to Ada", { timeout: 10_000 });
  await expect(page).toHaveURL(/#\/call\/Ada/);

  await page.getByTestId("end-button").click();
  const ended = page.getByRole("dialog", { name: "Call ended" });
  await expect(ended).toContainText("Call ended.");
  await expect(ended.getByRole("button", { name: "Call Ada again" })).toBeVisible();
  await ended.getByRole("button", { name: "Back to start" }).click();
  await expect(page).toHaveURL(/live\.html#\/$/);
});

test("Santa gets Santa's persona", async ({ page }) => {
  await page.goto(`${APP}/call/0fea11caf8194e3d86b337b9-56ea891b`);
  await page.getByTestId("call-button").click();
  await expect(page.getByTestId("call-state")).toContainText("your turn", { timeout: 15_000 });
  await page.getByLabel("Message").fill("hi Santa");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("caption")).toContainText("Ho ho ho", { timeout: 10_000 });
  await page.getByTestId("end-button").click();
  await expect(page.getByRole("dialog", { name: "Call ended" })).toBeVisible();
});

test("voice call: big reply text, typed message, end", async ({ page }) => {
  await page.goto(`${APP}/voice`);
  await page.getByTestId("call-button").click();
  await expect(page.getByTestId("call-state")).toContainText("your turn", { timeout: 15_000 });
  await page.getByRole("button", { name: "Type" }).click();
  await page.getByLabel("Message").fill("hello voice");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByTestId("you-said")).toHaveText("hello voice");
  await expect(page.getByTestId("reply")).toContainText("hello", { timeout: 10_000 });
  await expect(page.getByTestId("reply")).toContainText("This is call", { timeout: 10_000 });
  await expect(page.getByTestId("call-state")).toContainText("your turn", { timeout: 10_000 });
  // The reply is fitted to its box: big, but never overflowing.
  const m = await page.getByTestId("reply").evaluate((el) => ({
    font: parseFloat(getComputedStyle(el).fontSize), h: el.scrollHeight, box: el.parentElement.clientHeight,
  }));
  expect(m.font, JSON.stringify(m)).toBeGreaterThanOrEqual(18);
  expect(m.h, JSON.stringify(m)).toBeLessThanOrEqual(m.box);
  await page.getByRole("button", { name: "Smaller text" }).click();
  await page.getByTestId("end-button").click();
  const ended = page.getByRole("dialog", { name: "Call ended" });
  await expect(ended.getByRole("button", { name: "Call Mirli again" })).toBeVisible();
});

test("minutes page shows the calls this machine made", async ({ page }) => {
  await page.goto(`${APP}/account`);
  await expect(page.getByTestId("stat-plan")).toHaveText("This computer");
  await expect(page.getByTestId("stat-left")).toHaveText("Unlimited");
  await expect(page.getByRole("cell", { name: "voice" }).first()).toBeVisible();
});
