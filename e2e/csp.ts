/**
 * Content Security Policy sweep: every page of the site, loaded with no screenshot taken, must report no policy
 * violation. Violations are read from the page's own securitypolicyviolation events and from the console, so a
 * violation fails the test whichever way the engine reports it.
 */
import type { Page } from '@playwright/test';

/** Every page a visitor can open; the badge path is completed with an id by the caller. */
export const PAGES = ['/', '/link', '/lookup', '/pay', '/wall', '/demo', '/judges', '/verify/'] as const;

const REFUSED = /Content Security Policy|Refused to (apply|load|execute|connect|frame)/i;

/** Starts recording violations on `page`; call before the first navigation. Returns the list it fills. */
export async function watchPolicy(page: Page): Promise<string[]> {
  const found: string[] = [];
  await page.exposeFunction('__tambatViolation', (line: string) => found.push(line));
  await page.addInitScript(() => {
    const report = (window as unknown as { __tambatViolation: (line: string) => void }).__tambatViolation;
    document.addEventListener(
      'securitypolicyviolation',
      (e) => report(`${location.pathname}: ${e.violatedDirective} blocked=${e.blockedURI} sample=${e.sample}`),
      true,
    );
  });
  page.on('console', (msg) => {
    if (REFUSED.test(msg.text())) found.push(`${new URL(page.url()).pathname}: ${msg.text()}`);
  });
  return found;
}

/** Opens `path`, waits for the app to render and its first network work to settle. */
export async function visit(page: Page, path: string, settleMs: number): Promise<void> {
  await page.goto(path, { waitUntil: 'load' });
  await page.locator('h1, .embed').first().waitFor({ state: 'attached' });
  await page.waitForTimeout(settleMs);
}
