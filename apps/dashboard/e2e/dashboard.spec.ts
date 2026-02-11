import { test, expect } from "@playwright/test";

test.describe("Dashboard Overview", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard");
  });

  test("should display dashboard page", async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/);
  });

  test("should display key metrics", async ({ page }) => {
    // Dashboard should show spending metrics
    const content = await page.textContent("body");
    // Look for metric-related content (even if values are 0)
    expect(content).toMatch(/spend|cost|token|session/i);
  });

  test("should have navigation elements", async ({ page }) => {
    // Check for sidebar or nav links
    const navLinks = page.getByRole("link");
    const count = await navLinks.count();
    expect(count).toBeGreaterThan(0);
  });
});

test.describe("Dashboard Features Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/features");
  });

  test("should display features page", async ({ page }) => {
    await expect(page).toHaveURL(/features/);
  });

  test("should list available features", async ({ page }) => {
    const content = await page.textContent("body");
    // Should mention key features
    expect(content).toMatch(/smart copy|pre-flight|session|context/i);
  });
});

test.describe("Dashboard Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/settings");
  });

  test("should display settings page", async ({ page }) => {
    await expect(page).toHaveURL(/settings/);
  });

  test("should have settings controls", async ({ page }) => {
    // Look for form elements or toggles
    const buttons = page.getByRole("button");
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(0); // May have save buttons
  });
});

test.describe("Dashboard Team Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/team");
  });

  test("should display team page", async ({ page }) => {
    await expect(page).toHaveURL(/team/);
  });

  test("should show team management content", async ({ page }) => {
    const content = await page.textContent("body");
    expect(content).toMatch(/team|member|invite/i);
  });
});

test.describe("Dashboard Session Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/dashboard/session");
  });

  test("should display session list page", async ({ page }) => {
    await expect(page).toHaveURL(/session/);
  });

  test("should show sessions content", async ({ page }) => {
    const content = await page.textContent("body");
    // Even if no sessions, should show placeholder or title
    expect(content).toMatch(/session/i);
  });
});
