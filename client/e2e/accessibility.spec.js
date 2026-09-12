import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const json = (route, body, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});

for (const path of ['/login', '/register']) {
  test(`${path} has no serious accessibility violations`, async ({ page }) => {
    await page.route('**/api/auth/refresh', route => json(route, {}, 401));
    await page.goto(path);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.filter(violation => ['serious', 'critical'].includes(violation.impact))).toEqual([]);
  });
}
