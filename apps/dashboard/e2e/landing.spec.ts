import { test, expect } from "@playwright/test";

test.describe("Landing Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should display the landing page", async ({ page }) => {
    await expect(page).toHaveTitle(/TokenLens|Prune/i);
  });

  test("should have a signup button", async ({ page }) => {
    const signupButton = page.getByRole("link", { name: /sign up|get started/i });
    await expect(signupButton).toBeVisible();
  });

  test("should navigate to signup page", async ({ page }) => {
    const signupLink = page.getByRole("link", { name: /sign up|get started/i }).first();
    await signupLink.click();
    await expect(page).toHaveURL(/signup/);
  });

  test("should display key features", async ({ page }) => {
    // Check that the page contains key value propositions
    const content = await page.textContent("body");
    expect(content).toMatch(/token|cost|usage|context/i);
  });
});

test.describe("Signup Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/signup");
  });

  test("should display signup form", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("should have email input field", async ({ page }) => {
    const emailInput = page.getByPlaceholder(/email/i).or(page.getByLabel(/email/i));
    await expect(emailInput).toBeVisible();
  });
});

test.describe("Onboard Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/onboard");
  });

  test("should display onboarding content", async ({ page }) => {
    await expect(page).toHaveURL(/onboard/);
  });
});
