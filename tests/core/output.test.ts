import { describe, expect, it } from 'vitest';
import { applyHead, formatOutput } from '../../src/core/output.js';

describe('applyHead', () => {
  it('truncates arrays and leaves non-arrays unchanged', () => {
    expect(applyHead([1, 2, 3], 2)).toEqual([1, 2]);
    const obj = { a: 1 };
    expect(applyHead(obj, 1)).toBe(obj);
  });
});

describe('formatOutput', () => {
  it('formats raw strings and raw JSON-compatible values', () => {
    expect(formatOutput('hello', { raw: true }).stdout).toBe('hello\n');
    expect(formatOutput({ a: 1 }, { raw: true }).stdout).toBe('{"a":1}\n');
  });

  it('pretty-prints JSON values and parses JSON strings', () => {
    expect(formatOutput({ a: 1 }, { pretty: true }).stdout).toContain('\n  "a": 1\n');
    expect(formatOutput('{"x":2}', { pretty: true }).stdout).toContain('"x": 2');
  });

  it('passes plain text through', () => {
    expect(formatOutput('plain text', { pretty: true }).stdout).toBe('plain text\n');
  });

  it('applies head before JSON formatting', () => {
    expect(JSON.parse(formatOutput([1, 2, 3], { head: 2 }).stdout)).toEqual([1, 2]);
  });
});
