/**
 * Every page, in both engines, loads with no Content Security Policy violation. No screenshot is taken here: WebKit
 * injects a stylesheet while it takes one, which the policy refuses, and that is the tool rather than the page.
 */
import { EMBED_PATH } from '../src/core/badge.js';
import { toNpub } from '../src/core/nostr.js';
import { PAGES, visit, watchPolicy } from './csp.js';
import { expect, phraseKeys, test } from './fixtures.js';

const badge = `${EMBED_PATH}${toNpub(phraseKeys.nostrPubkey)}`;

test('no page breaks the content security policy', async ({ page }) => {
  const violations = await watchPolicy(page);
  for (const path of [...PAGES, badge]) await visit(page, path, 500);
  expect(violations).toEqual([]);
});

test('the policy check catches an inline style', async ({ page, consoleErrors }) => {
  const violations = await watchPolicy(page);
  await visit(page, '/', 0);
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = 'body { outline: 0 }';
    document.head.append(style);
  });
  await expect.poll(() => violations.length).toBeGreaterThan(0);
  expect(violations.join('\n')).toContain('style-src');
  // The browser also logs the refusal this test provoked on purpose; anything else still fails the test.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !/style-src|Refused to apply/.test(e)));
});
