import { describe, expect, it } from 'vitest';
import { round2, signedAmount } from './money';

describe('round2', () => {
  it('rounds half-cents away from zero, symmetrically', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-1.005)).toBe(-1.01);
    expect(round2(1234.565)).toBe(1234.57);
    expect(round2(10.005)).toBe(10.01);
    expect(round2(2.675)).toBe(2.68);
    expect(round2(1.004)).toBe(1);
    expect(round2(-1.004)).toBe(-1);
  });

  it('cleans floating-point sums without moving exact amounts', () => {
    expect(round2(1234.56 + 100.1)).toBe(1334.66);
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(19.99)).toBe(19.99);
    expect(round2(1e9 + 0.01)).toBe(1e9 + 0.01);
    expect(round2(42)).toBe(42);
  });

  it('never returns a negative zero, and leaves non-finite values alone', () => {
    expect(Object.is(round2(-0.001), 0)).toBe(true);
    expect(Object.is(round2(-0), 0)).toBe(true);
    expect(round2(Number.NaN)).toBeNaN();
    expect(round2(Infinity)).toBe(Infinity);
  });
});

describe('signedAmount', () => {
  it('is positive for money in, negative for money out', () => {
    expect(signedAmount({ type: 'IN', amount: 5 })).toBe(5);
    expect(signedAmount({ type: 'OUT', amount: 5 })).toBe(-5);
  });
});
