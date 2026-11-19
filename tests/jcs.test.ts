import { describe, expect, it } from 'vitest';
import { canonicalize } from '../src/core/jcs.js';

// Vectors from RFC 8785 sections 3.2.2 (values) and 3.2.3 (member order).
describe('JSON canonicalization (RFC 8785)', () => {
  it('serializes numbers, strings and literals as the RFC example does', () => {
    const input = JSON.parse(
      '{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],' +
        '"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}',
    );
    expect(canonicalize(input)).toBe(
      '{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}',
    );
  });

  it('sorts members by UTF-16 code units', () => {
    const input = JSON.parse(
      '{"\\u20ac":"Euro Sign","\\r":"Carriage Return","\\ufb33":"Hebrew Letter Dalet With Dagesh","1":"One",' +
        '"\\ud83d\\ude00":"Emoji: Grinning Face","\\u0080":"Control","\\u00f6":"Latin Small Letter O With Diaeresis"}',
    );
    expect(canonicalize(input).match(/"[^"]*":/g)!.map((m) => JSON.parse(m.slice(0, -1)) as string)).toEqual(['\r', '1', '\u0080', 'ö', '€', '😀', 'דּ']);
  });

  it('drops undefined members and refuses values JSON cannot hold', () => {
    expect(canonicalize({ b: 1, a: undefined, c: [1, { z: 0, y: '' }] })).toBe('{"b":1,"c":[1,{"y":"","z":0}]}');
    expect(() => canonicalize({ n: Infinity })).toThrow();
    expect(() => canonicalize({ f: () => 0 })).toThrow();
  });
});
