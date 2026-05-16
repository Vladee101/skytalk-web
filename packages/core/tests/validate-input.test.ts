import { describe, expect, it } from 'vitest';

import { fc, it as itProp } from '@fast-check/vitest';

import { validateInput, validateInputFormat } from '../src/validate-input';

// ============================================================
// validateInputFormat — §7.1 mandatory cases + extra Annex C examples
// ============================================================

describe('validateInputFormat', () => {
  describe('com_frequency — ^[1-9][0-9]{2}\\.[0-9]{1,3}$', () => {
    it.each([
      // §7.1 mandatory valid
      ['118.7', true],
      ['121.900', true],
      ['118.725', true],
      // extra Annex C valid
      ['118.70', true],
      ['100.0', true],
      ['999.999', true],
      // §7.1 mandatory invalid
      ['011.7', false], // leading zero on integer part
      ['118', false], // no decimal point
      ['118,7', false], // comma instead of period
      // extra invalid
      ['0118.7', false], // 4-digit prefix
      ['118.7000', false], // 4 decimal digits
      ['18.70', false], // only 2-digit integer part
      ['', false],
    ])('("%s") → %s', (value, expected) => {
      expect(validateInputFormat('com_frequency', value)).toBe(expected);
    });
  });

  describe('squawk — ^[0-7]{4}$', () => {
    it.each([
      // §7.1 mandatory valid + extra Annex C
      ['4721', true],
      ['1200', true],
      ['7500', true],
      ['0000', true],
      ['7777', true],
      // §7.1 mandatory invalid
      ['8888', false], // digit 8 is not octal (0-7 only)
      ['129', false], // 3 digits
      ['47210', false], // 5 digits
      // extra invalid
      ['abcd', false],
      ['47 1', false], // space
      ['', false],
    ])('("%s") → %s', (value, expected) => {
      expect(validateInputFormat('squawk', value)).toBe(expected);
    });
  });

  describe('heading — ^[0-9]{3}$', () => {
    it.each([
      // §7.1 mandatory valid + extra Annex C
      ['090', true],
      ['999', true], // valid format — Annex C has NO range enforcement
      ['270', true],
      ['360', true],
      ['000', true],
      // §7.1 mandatory invalid
      ['90', false], // 2 digits
      ['270°', false], // degree suffix
      // extra invalid
      ['27', false], // 2 digits
      ['0090', false], // 4 digits
      ['abc', false],
      ['', false],
    ])('("%s") → %s', (value, expected) => {
      expect(validateInputFormat('heading', value)).toBe(expected);
    });
  });

  describe('altitude — ^[0-9]+$', () => {
    it.each([
      // §7.1 mandatory valid + extra Annex C
      ['5000', true],
      ['0', true],
      ['35000', true],
      ['12000', true],
      ['1', true],
      // §7.1 mandatory invalid
      ['FL350', false],
      ['35,000', false], // comma separator
      // extra invalid — Annex C explicit examples
      ['5000ft', false], // unit suffix
      ['-1000', false], // negative sign
      ['', false],
    ])('("%s") → %s', (value, expected) => {
      expect(validateInputFormat('altitude', value)).toBe(expected);
    });
  });
});

// ============================================================
// validateInput — §7.2 and §7.3
// ============================================================

describe('validateInput', () => {
  describe('§7.2 — trailing-zero is exact-match discipline, not a format rule', () => {
    it('118.70 expected, 118.7 submitted → value_mismatch (both pass format check)', () => {
      expect(validateInput('com_frequency', '118.70', '118.7')).toEqual({
        correct: false,
        reason: 'value_mismatch',
      });
    });

    it('118.70 expected, 118.70 submitted → correct', () => {
      expect(validateInput('com_frequency', '118.70', '118.70')).toEqual({ correct: true });
    });
  });

  describe('§7.3 — format check runs before value comparison', () => {
    it('format invalid → format_invalid, regardless of expected value', () => {
      expect(validateInput('squawk', '4721', '129')).toEqual({
        correct: false,
        reason: 'format_invalid',
      });
    });

    it('format valid but wrong value → value_mismatch', () => {
      expect(validateInput('squawk', '4721', '4720')).toEqual({
        correct: false,
        reason: 'value_mismatch',
      });
    });
  });

  describe('extra coverage', () => {
    it('heading exact match → correct', () => {
      expect(validateInput('heading', '090', '090')).toEqual({ correct: true });
    });

    it('altitude format invalid → format_invalid', () => {
      expect(validateInput('altitude', '5000', 'FL350')).toEqual({
        correct: false,
        reason: 'format_invalid',
      });
    });

    it('altitude value mismatch → value_mismatch', () => {
      expect(validateInput('altitude', '5000', '5001')).toEqual({
        correct: false,
        reason: 'value_mismatch',
      });
    });
  });
});

// ============================================================
// Property-based tests — for any format-valid x, validateInput(type, x, x) === correct
// ============================================================

describe('property: validateInput(type, x, x) is always correct for format-valid x', () => {
  itProp.prop([fc.stringMatching(/^[1-9][0-9]{2}\.[0-9]{1,3}$/)])('com_frequency', (x) => {
    expect(validateInput('com_frequency', x, x)).toEqual({ correct: true });
  });

  itProp.prop([fc.stringMatching(/^[0-7]{4}$/)])('squawk', (x) => {
    expect(validateInput('squawk', x, x)).toEqual({ correct: true });
  });

  itProp.prop([fc.stringMatching(/^[0-9]{3}$/)])('heading', (x) => {
    expect(validateInput('heading', x, x)).toEqual({ correct: true });
  });

  itProp.prop([fc.stringMatching(/^[0-9]+$/)])('altitude', (x) => {
    expect(validateInput('altitude', x, x)).toEqual({ correct: true });
  });
});
