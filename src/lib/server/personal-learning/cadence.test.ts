import { describe, expect, it } from 'vitest';
import { canContinue, isReviewBoundary, isValidExtension } from './cadence';

describe('study-session cadence', () => {
  it.each([
    [1, 1, true],
    [7, 7, true],
    [30, 7, true],
    [30, 8, false],
    [30, 14, true],
    [30, 21, true],
    [30, 28, true],
    [30, 29, false],
    [30, 30, true]
  ])('offers review for target %i at session %i: %s', (target, index, expected) => {
    expect(isReviewBoundary(target, index)).toBe(expected);
  });

  it('continues only before the selected session target', () => {
    expect(canContinue(6, 7)).toBe(true);
    expect(canContinue(7, 7)).toBe(false);
    expect(canContinue(30, 30)).toBe(false);
  });

  it('allows only explicit target extensions', () => {
    expect(isValidExtension(1, 7)).toBe(true);
    expect(isValidExtension(1, 30)).toBe(true);
    expect(isValidExtension(7, 30)).toBe(true);
    expect(isValidExtension(7, 14)).toBe(false);
    expect(isValidExtension(30, 30)).toBe(false);
  });
});
