import { describe, expect, it } from 'vitest';
import { formatScore } from '../src/index.js';

describe('formatScore', () => {
  it('R-8.2: positive score is shown with a plus sign', () => {
    expect(formatScore(30)).toBe('+30');
  });

  it('R-8.2: negative score is shown with typographic minus U+2212', () => {
    expect(formatScore(-30)).toBe('−30');
  });

  it('R-8.2: zero score is shown without a sign', () => {
    expect(formatScore(0)).toBe('0');
  });
});
