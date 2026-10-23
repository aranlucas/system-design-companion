import { expect } from "e2e";
import { test } from "./fixtures.ts";
import { live } from "./web-engine.ts";

test("ChatGPT sign-in creates a board when GitHub is not configured", async ({
  app,
  screen,
  workspace,
}) => {
  workspace.signedIn = false;
  await app.open();
  await expect(screen.getByRole("button", "Continue with ChatGPT")).toBeVisible();
  await expect(screen.getByRole("link", "Sign in with GitHub")).toHaveCount(0);
  await app.screenshot("chatgpt-home-sign-in");
  const popupPromise = live.context().waitForEvent("page");
  await screen.getByRole("button", "Continue with ChatGPT").tap();
  const popup = await popupPromise;
  await popup.getByRole("button", { name: "I trust this app, continue" }).click();
  await expect(screen.getByRole("heading", "New diagram")).toBeVisible();
  await screen.getByLabel("Diagram name").fill("Practice board");
  await screen.getByRole("button", "Create diagram").tap();
  await expect(screen.getByRole("button", "Open interviewer")).toBeVisible();
  await app.screenshot("chatgpt-board-created");
});

test("drawing changes reach the interviewer, view changes do not, and answers stream", async ({
  app,
  screen,
  browser,
  workspace,
}) => {
  await app.open("/d/practice?k=edit-key");
  await screen.getByRole("button", "Open interviewer").tap();
  await screen.getByRole("button", "Start interview").tap();
  await expect(screen.getByText("Question 1:", { exact: false })).toBeVisible();
  await live.page().clock.install();
  await browser.keyboard.press("r");
  await browser.mouse.move(350, 250);
  await browser.mouse.down();
  await browser.mouse.move(550, 400);
  await browser.mouse.up();
  await expect.poll(() => workspace.elements.length).toBeGreaterThan(0);
  await live.page().clock.runFor(16_000);
  await expect(screen.getByText("Question 2:", { exact: false })).toBeVisible();
  expect(workspace.requests[1]).toContain("input_image");
  expect(workspace.requests[1]).toContain("rectangle");
  expect(workspace.requests[1]).toContain("added");
  await screen.getByRole("button", "Zoom in").tap();
  await live.page().clock.runFor(16_000);
  expect(workspace.requests).toHaveLength(2);
  await screen
    .getByLabel("Your answer")
    .fill("I would replicate the database across availability zones.");
  await screen.getByRole("button", "Send answer").tap();
  await expect(screen.getByText("Question 3:", { exact: false })).toBeVisible();
  expect(workspace.requests[2]).toContain("replicate the database");
  await app.screenshot("interviewer-drawing-and-answer");
});

test("pausing holds drawing changes until the interview resumes", async ({
  app,
  screen,
  browser,
  workspace,
}) => {
  await app.open("/d/practice?k=edit-key");
  await screen.getByRole("button", "Open interviewer").tap();
  await screen.getByRole("button", "Start interview").tap();
  await expect(screen.getByText("Question 1:", { exact: false })).toBeVisible();
  await live.page().clock.install();
  await screen.getByRole("button", "Pause interviewer").tap();
  await browser.keyboard.press("r");
  await browser.mouse.move(350, 250);
  await browser.mouse.down();
  await browser.mouse.move(550, 400);
  await browser.mouse.up();
  await expect.poll(() => workspace.elements.length).toBeGreaterThan(0);
  await live.page().clock.runFor(16_000);
  expect(workspace.requests).toHaveLength(1);
  await screen.getByRole("button", "Resume interview").tap();
  await expect(screen.getByText("Question 2:", { exact: false })).toBeVisible();
  expect(workspace.requests[1]).toContain("rectangle");
});

test("a failed model response can be retried without losing the conversation", async ({
  app,
  screen,
  workspace,
}) => {
  workspace.failResponse = true;
  await app.open("/d/practice?k=edit-key");
  await screen.getByRole("button", "Open interviewer").tap();
  await screen.getByRole("button", "Start interview").tap();
  await expect(screen.getByRole("button", "Retry response")).toBeVisible();
  workspace.failResponse = false;
  await screen.getByRole("button", "Retry response").tap();
  await expect(screen.getByText("Question 2:", { exact: false })).toBeVisible();
  await expect(screen.getByRole("button", "Retry response")).toHaveCount(0);
});

test("the interviewer is usable from the mobile canvas menu", async ({ app, screen, browser }) => {
  await browser.setViewport({ width: 390, height: 844 });
  await app.open("/d/practice?k=edit-key");
  await screen.getByRole("button", "Canvas menu").tap();
  await screen.getByRole("menuitem", "Interviewer").tap();
  await screen.getByRole("button", "Start interview").tap();
  await expect(screen.getByText("Question 1:", { exact: false })).toBeVisible();
  await screen.getByLabel("Your answer").fill("The target is one million requests per day.");
  await screen.getByRole("button", "Send answer").tap();
  await expect(screen.getByText("Question 2:", { exact: false })).toBeVisible();
  await app.screenshot("mobile-interviewer");
});

test("the fixed model starts an interview without model discovery", async ({
  app,
  screen,
  workspace,
}) => {
  workspace.failModels = true;
  await app.open("/d/practice?k=edit-key");
  await screen.getByRole("button", "Open interviewer").tap();
  await expect(screen.getByRole("button", "Start interview")).toBeEnabled();
  await screen.getByRole("button", "Start interview").tap();
  await expect(screen.getByText("Question 1:", { exact: false })).toBeVisible();
  expect(workspace.modelRequests).toBe(0);
  expect(workspace.requests).toHaveLength(1);
  expect(workspace.requests[0]).toContain('"model":"gpt-5.5"');
  await app.screenshot("fixed-model-interview");
});
