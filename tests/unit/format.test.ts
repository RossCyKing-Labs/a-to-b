import { describe, expect, it } from 'vitest';
import { formatBytes, sizeDelta } from '~/lib/format';

describe('formatBytes', () => {
  it('renders bytes under 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1)).toBe('1 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('renders kilobytes', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1500)).toBe('1.5 KB');
  });

  it('renders megabytes', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB');
  });

  it('renders gigabytes', () => {
    expect(formatBytes(1024 ** 3)).toBe('1.00 GB');
  });
});

describe('sizeDelta', () => {
  it('returns positive delta when output is larger', () => {
    expect(sizeDelta(100, 150)).toBe('+50%');
    expect(sizeDelta(100, 244)).toBe('+144%');
  });

  it('returns negative delta when output is smaller', () => {
    expect(sizeDelta(100, 50)).toBe('-50%');
    expect(sizeDelta(1000, 100)).toBe('-90%');
  });

  it('returns +0% when sizes match', () => {
    expect(sizeDelta(100, 100)).toBe('+0%');
  });

  it('returns empty string when before is zero (avoid divide-by-zero)', () => {
    expect(sizeDelta(0, 100)).toBe('');
  });
});
