/**
 * The page policy allows styles from the site's own files only (style-src 'self'), so the web app keeps every style
 * in its stylesheets: no style attribute in the HTML entry pages and no style prop in the React components.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../config/tambat.json' with { type: 'json' };

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name), ext) : ext.test(e.name) ? [join(dir, e.name)] : [],
  );
}

function inlineStyles(source: string): string[] {
  return [...source.matchAll(/(?:\sstyle\s*=|<style\b)[^\n<]{0,40}/g)].map((m) => m[0].trim());
}

describe('styles stay in stylesheets', () => {
  it('the policy allows no inline style', () => {
    expect(config.server.contentSecurityPolicy['style-src']).not.toContain("'unsafe-inline'");
  });

  it('no component or entry page carries an inline style', () => {
    const found = [...files('web', /\.(tsx|html)$/), 'index.html']
      .flatMap((f) => inlineStyles(readFileSync(f, 'utf8')).map((s) => `${f}: ${s}`));
    expect(found).toEqual([]);
  });

  it('finds a style prop and a style element', () => {
    expect(inlineStyles('<p className="a" style={WRAP}>x</p>')).toHaveLength(1);
    expect(inlineStyles('<div style="color:red"></div><style>p{}</style>')).toHaveLength(2);
    expect(inlineStyles('<p className="style">styles.css</p>')).toEqual([]);
  });
});
