// Calls in the Mirli app, end to end against the local back end.
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { FIXTURES, PORTS } from "./playwright.config.mjs";

const API = `http://127.0.0.1:${PORTS.mirli}/api`;

test.beforeAll(async () => {
  // A scratch data dir is a first run: skip onboarding so its dialog doesn't cover the page.
  await fetch(`${API}/settings`, { method: "PATCH", headers: { "Content-Type": "application/json", "X-Soundbox": "1" }, body: JSON.stringify({ onboarded_at: new Date().toISOString() }) });
});

async function talkTyped(page, text) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("Calls is in the app's navigation, with Santa built in and both workers up", async ({ page }) => {
  await page.goto("/#/dashboard");
  await page.getByRole("link", { name: "Calls" }).first().click();
  await expect(page).toHaveURL(/#\/calls$/);
  await expect(page.getByRole("heading", { name: "Calls", exact: true }).last()).toBeVisible();
  await expect(page.getByTestId("call-service")).toContainText("voice server running");
  await expect(page.getByTestId("call-service")).toContainText("face server running (fake)");
  await expect(page.getByTestId("character-card").first()).toHaveAttribute("data-id", "santa");
});

/** Ring, pick up, and the character says hello first (FaceTime-style, after Jingle Line). */
async function placeVideoCall(page) {
  await page.getByTestId("call-button").click();
  await expect(page.getByTestId("ringing")).toBeVisible();
  await expect(page.locator("[data-phase='live']")).toBeVisible({ timeout: 15_000 });
  // The character answers the "Hello?" the app sends when it picks up.
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  const chat = page.getByTestId("call-chat");
  await expect(chat.locator('[data-kind="you"]').first()).toHaveText("Hello?");
  await expect(chat.locator('[data-kind="bot"]').first()).toContainText("You said Hello?", { timeout: 10_000 });
  return chat;
}
async function chatTyped(page, text) {
  await page.getByLabel("Message").fill(text);
  await page.getByRole("button", { name: "Send" }).click();
}

test("video call with Santa: ringing, pick up, full-bleed face, chat, hang up", async ({ page }) => {
  await page.goto("/#/calls");
  await page.getByRole("link", { name: "Call Santa", exact: true }).click();
  await expect(page).toHaveURL(/#\/calls\/video\/santa/);
  const chat = await placeVideoCall(page);
  await chatTyped(page, "hi Santa");
  await expect(chat.locator('[data-kind="bot"]').nth(1)).toContainText("Ho ho ho", { timeout: 10_000 });
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await expect(page.getByTestId("face-canvas")).not.toHaveClass(/opacity-0/, { timeout: 10_000 });
  await expect(page.getByTestId("call-frame")).toBeVisible();
  await page.getByTestId("end-button").click();
  const ended = page.getByRole("dialog", { name: "Call ended" });
  await expect(ended.getByRole("button", { name: "Call Santa again" })).toBeVisible();
  await ended.getByRole("button", { name: "Back to start" }).click();
  await expect(page).toHaveURL(/#\/calls$/);
  await expect(page.getByTestId("recent-call").first()).toContainText("Santa");
});

test("cancel while it rings goes back to the call button", async ({ page }) => {
  await page.goto("/#/calls/video/santa");
  await page.getByTestId("call-button").click();
  await page.getByRole("button", { name: "Cancel call" }).click();
  await expect(page.getByTestId("call-button")).toBeVisible();
});

test("Santa's avatar pack: import it, then the call plays pose clips and hands over to the live face", async ({ page }) => {
  await page.goto("/#/calls/characters/santa");
  await expect(page.getByTestId("pack-status")).toHaveText("none");
  await page.getByLabel("Pack folder").fill(join(FIXTURES, "pack"));
  await page.getByRole("button", { name: "Import" }).click();
  await expect(page.getByTestId("pack-status")).toHaveText("ready · 4 clips");

  await page.getByRole("link", { name: "Video call" }).click();
  await expect(page.locator("[data-pack='1']")).toBeVisible();
  await page.getByTestId("call-button").click();
  await expect(page.locator("[data-phase='live']")).toBeVisible({ timeout: 15_000 });
  // On the talk pose with frames flowing, the live face is pasted into the talk still.
  await expect(page.getByTestId("face-canvas")).toHaveAttribute("data-live", "1", { timeout: 15_000 });
  const played = await page.getByTestId("pose-video").evaluateAll((vs) => vs.some((v) => v.currentSrc.includes("/api/characters/santa/pack/clips/")));
  expect(played).toBe(true);
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await chatTyped(page, "tell me a joke");
  await expect(page.getByTestId("call-chat").locator('[data-kind="bot"]').last()).toContainText("tell me a joke", { timeout: 10_000 });
  await page.getByTestId("end-button").click();
  await expect(page.getByRole("dialog", { name: "Call ended" })).toBeVisible();
});

test("create your own character, then call them by voice and by video", async ({ page }) => {
  await page.goto("/#/calls");
  await page.getByTestId("create-character-card").click();
  await expect(page).toHaveURL(/#\/calls\/new/);
  await page.getByTestId("portrait-file").setInputFiles(join(FIXTURES, "rosa.png"));
  await expect(page.getByTestId("portrait-preview")).toBeVisible();
  await page.getByLabel("Name").fill("Rosa");
  await page.getByLabel("Persona").fill("You are Rosa, a friendly barista. Plain spoken sentences only.");
  await page.getByLabel("Voice").selectOption("fake-b");
  await page.getByTestId("save-character").click();
  await expect(page).toHaveURL(/#\/calls\/characters\/rosa-/);
  await expect(page.getByRole("heading", { name: "Rosa" })).toBeVisible();

  // The avatar pack: the cloud path refuses without spending; local needs ComfyUI.
  await page.getByRole("button", { name: "Render in the cloud" }).click();
  await expect(page.getByTestId("pack-panel").getByRole("alert")).toContainText("isn't available yet");

  await page.getByRole("link", { name: "Voice call" }).click();
  await page.getByTestId("call-button").click();
  await expect(page.getByTestId("call-state")).toContainText("your turn", { timeout: 15_000 });
  await page.getByRole("button", { name: "Type" }).click();
  await talkTyped(page, "hello Rosa");
  await expect(page.getByTestId("reply")).toContainText("hello", { timeout: 10_000 });
  await page.getByTestId("end-button").click();
  await page.getByRole("dialog", { name: "Call ended" }).getByRole("button", { name: "Back to start" }).click();

  await page.getByRole("link", { name: "Video call Rosa" }).click();
  await placeVideoCall(page);
  await page.getByRole("button", { name: "Video", exact: true }).click();
  await expect(page.getByTestId("face-canvas")).not.toHaveClass(/opacity-0/, { timeout: 10_000 });
  await page.getByTestId("end-button").click();
  await expect(page.getByRole("dialog", { name: "Call ended" })).toBeVisible();
});

test("voice call with Mirli: big reply text that fits, typing, end", async ({ page }) => {
  await page.goto("/#/calls/voice");
  await page.getByTestId("call-button").click();
  await expect(page.getByTestId("call-state")).toContainText("your turn", { timeout: 15_000 });
  await page.getByRole("button", { name: "Type" }).click();
  await talkTyped(page, "hello voice");
  await expect(page.getByTestId("you-said")).toHaveText("hello voice");
  await expect(page.getByTestId("reply")).toContainText("This is call", { timeout: 10_000 });
  await expect(page.getByTestId("call-state")).toContainText("your turn", { timeout: 10_000 });
  const m = await page.getByTestId("reply").evaluate((el) => ({ font: parseFloat(getComputedStyle(el).fontSize), h: el.scrollHeight, box: el.parentElement.clientHeight }));
  expect(m.font, JSON.stringify(m)).toBeGreaterThanOrEqual(18);
  expect(m.h, JSON.stringify(m)).toBeLessThanOrEqual(m.box);
  await page.getByTestId("end-button").click();
  await expect(page.getByRole("dialog", { name: "Call ended" }).getByRole("button", { name: "Call Mirli again" })).toBeVisible();
});

test("the back end switch: Mirli Cloud without sign-in says so, then back to this computer", async ({ page }) => {
  await page.goto("/#/calls");
  const picker = page.getByRole("radiogroup", { name: "Where calls run" });
  await picker.getByRole("radio", { name: "Mirli Cloud" }).click();
  await expect(page.getByLabel("Mirli Cloud device token")).toBeVisible();
  await expect(page.getByTestId("call-service")).toContainText("not reachable or not signed in", { timeout: 10_000 });
  await picker.getByRole("radio", { name: "This computer" }).click();
  await expect(page.getByTestId("call-service")).toContainText("voice server running", { timeout: 10_000 });
});
