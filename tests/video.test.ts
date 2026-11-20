/**
 * The demo video served with the site: config.video names files that exist under public/, the MP4 is the length the
 * pages say, carries a picture track and no sound, and starts with its index (fast start) so a browser can play it
 * before the whole file arrives. Read from the MP4 boxes, with no tool outside this repository.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { config, cspHeader, parseConfig } from '../src/config.js';

const fresh = () => JSON.parse(readFileSync(new URL('../config/tambat.json', import.meta.url), 'utf8'));
const file = (sitePath: string) => new URL(`../public${sitePath}`, import.meta.url);

type Box = { type: string; start: number; end: number };

/** The boxes directly inside buf[from, to). */
export function boxes(buf: Buffer, from = 0, to = buf.length): Box[] {
  const out: Box[] = [];
  let at = from;
  while (at + 8 <= to) {
    let size = buf.readUInt32BE(at);
    let head = 8;
    if (size === 1) {
      size = Number(buf.readBigUInt64BE(at + 8));
      head = 16;
    } else if (size === 0) size = to - at;
    if (size < head || at + size > to) throw new Error(`bad box at ${at}`);
    out.push({ type: buf.toString('latin1', at + 4, at + 8), start: at + head, end: at + size });
    at += size;
  }
  return out;
}

export function mp4Facts(buf: Buffer): { order: string[]; seconds: number; handlers: string[] } {
  const top = boxes(buf);
  const moov = top.find((b) => b.type === 'moov');
  if (!moov) throw new Error('no moov box');
  const inner = boxes(buf, moov.start, moov.end);
  const mvhd = inner.find((b) => b.type === 'mvhd')!;
  const version = buf[mvhd.start];
  const timescale = version === 1 ? buf.readUInt32BE(mvhd.start + 20) : buf.readUInt32BE(mvhd.start + 12);
  const duration = version === 1 ? Number(buf.readBigUInt64BE(mvhd.start + 24)) : buf.readUInt32BE(mvhd.start + 16);
  const handlers = inner
    .filter((b) => b.type === 'trak')
    .map((trak) => {
      const mdia = boxes(buf, trak.start, trak.end).find((b) => b.type === 'mdia')!;
      const hdlr = boxes(buf, mdia.start, mdia.end).find((b) => b.type === 'hdlr')!;
      return buf.toString('latin1', hdlr.start + 8, hdlr.start + 12);
    });
  return { order: top.map((b) => b.type), seconds: duration / timescale, handlers };
}

describe('demo video', () => {
  it('names files that exist under public/', () => {
    expect(existsSync(file(config.video.url))).toBe(true);
    expect(existsSync(file(config.video.posterUrl))).toBe(true);
  });

  it('is the length the pages say, one picture track, no sound, index first', () => {
    const f = mp4Facts(readFileSync(file(config.video.url)));
    expect(Math.abs(f.seconds - config.video.seconds)).toBeLessThan(1);
    expect(f.seconds).toBeGreaterThanOrEqual(45);
    expect(f.seconds).toBeLessThanOrEqual(60.5);
    expect(f.handlers).toEqual(['vide']);
    expect(f.order.indexOf('moov')).toBeGreaterThanOrEqual(0);
    expect(f.order.indexOf('moov')).toBeLessThan(f.order.indexOf('mdat'));
  });

  it('reads the facts from the boxes, not from the file name', () => {
    // A minimal file: ftyp, then mdat before moov, 3 s at timescale 1000, one sound track.
    const box = (type: string, body: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(8 + body.length);
      head.write(type, 4, 'latin1');
      return Buffer.concat([head, body]);
    };
    const mvhd = Buffer.alloc(100);
    mvhd.writeUInt32BE(1000, 12);
    mvhd.writeUInt32BE(3000, 16);
    const hdlr = Buffer.alloc(24);
    hdlr.write('soun', 8, 'latin1');
    const moov = box('moov', Buffer.concat([box('mvhd', mvhd), box('trak', box('mdia', box('hdlr', hdlr)))]));
    const f = mp4Facts(Buffer.concat([box('ftyp', Buffer.alloc(8)), box('mdat', Buffer.alloc(4)), moov]));
    expect(f).toEqual({ order: ['ftyp', 'mdat', 'moov'], seconds: 3, handlers: ['soun'] });
  });

  it('may be played by the page: media-src allows the site itself', () => {
    expect(cspHeader(config.server.contentSecurityPolicy)).toContain("media-src 'self'");
  });

  it.each([
    ['url', 'https://elsewhere.example/v.mp4'],
    ['url', '/media/tambat-demo.webm'],
    ['posterUrl', '/media/poster.gif'],
    ['seconds', 0],
    ['seconds', '56'],
  ])('rejects video.%s = %j', (key, value) => {
    const c = fresh();
    c.video[key] = value;
    expect(() => parseConfig(c)).toThrow(new RegExp(`video\\.${key}`));
  });
});
