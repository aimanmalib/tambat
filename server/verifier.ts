/**
 * Serves the one-file verifier at /verify/ and as a download. The page gets a stricter policy than its own meta tag:
 * the inline script and style are allowed by SHA-256 hash instead of 'unsafe-inline', and nothing may frame it.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import type { FastifyInstance } from 'fastify';

export const VERIFIER_PATH = '/verify/';

const sha256 = (data: string | Buffer, encoding: 'hex' | 'base64') => createHash('sha256').update(data).digest(encoding);

/** Hash sources for every inline block of one tag, as CSP expects them (base64 SHA-256 of the exact text). */
function inlineHashes(html: string, tag: 'script' | 'style'): string[] {
  const blocks = [...html.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g'))];
  return blocks.map((m) => `'sha256-${sha256(m[1] ?? '', 'base64')}'`);
}

/**
 * The page's own meta policy with 'unsafe-inline' replaced by hashes of the blocks actually in the file, plus
 * frame-ancestors (which a meta policy cannot set).
 */
export function verifierPolicy(html: string): string {
  const meta = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
  if (!meta) throw new Error('verifier file has no Content-Security-Policy meta tag');
  const directives = meta.split(';').map((d) => d.trim()).filter((d) => d !== '');
  const policy = directives.map((d) => {
    const [name = '', ...sources] = d.split(/\s+/);
    if (name !== 'script-src' && name !== 'style-src') return d;
    const hashes = inlineHashes(html, name === 'script-src' ? 'script' : 'style');
    return [name, ...sources.filter((s) => s !== "'unsafe-inline'"), ...hashes].join(' ');
  });
  return [...policy, "frame-ancestors 'none'"].join('; ');
}

/** Registers the verifier routes when the built file exists. */
export function registerVerifier(app: FastifyInstance, file: string): void {
  if (!existsSync(file)) return;
  const bytes = readFileSync(file);
  const html = bytes.toString('utf8');
  const policy = verifierPolicy(html);
  const name = basename(file);
  const digest = `${sha256(bytes, 'hex')}  ${name}\n`;

  app.get('/verify', async (_req, reply) => reply.redirect(VERIFIER_PATH, 301));
  app.get(VERIFIER_PATH, async (_req, reply) =>
    reply.header('content-security-policy', policy).type('text/html; charset=utf-8').send(bytes),
  );
  app.get(`${VERIFIER_PATH}${name}`, async (_req, reply) =>
    reply
      .header('content-security-policy', policy)
      .header('content-disposition', `attachment; filename="${name}"`)
      .type('text/html; charset=utf-8')
      .send(bytes),
  );
  app.get(`${VERIFIER_PATH}${name}.sha256`, async (_req, reply) => reply.type('text/plain; charset=utf-8').send(digest));
}
