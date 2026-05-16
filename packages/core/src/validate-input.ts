import type { InputValidationResult, RequiredInputType } from './types';

// Source: Annex C regex column, verbatim. "none" is never in the array form.
const FORMAT_PATTERNS: Record<Exclude<RequiredInputType, 'none'>, RegExp> = {
  com_frequency: /^[1-9][0-9]{2}\.[0-9]{1,3}$/,
  squawk: /^[0-7]{4}$/,
  heading: /^[0-9]{3}$/,
  altitude: /^[0-9]+$/,
};

export function validateInputFormat(
  type: Exclude<RequiredInputType, 'none'>,
  value: string,
): boolean {
  return FORMAT_PATTERNS[type].test(value);
}

export function validateInput(
  type: Exclude<RequiredInputType, 'none'>,
  expectedValue: string,
  submittedValue: string,
): InputValidationResult {
  if (!validateInputFormat(type, submittedValue)) {
    return { correct: false, reason: 'format_invalid' };
  }
  // Exact-match, case-sensitive, no trimming beyond UI sanitation (Annex C §C.2).
  if (submittedValue !== expectedValue) {
    return { correct: false, reason: 'value_mismatch' };
  }
  return { correct: true };
}
