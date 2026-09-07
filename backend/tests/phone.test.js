import { describe, it, expect } from 'vitest';
import { normalizePhone } from '../src/lib/phone.js';

// Phase A2 of the NCC dev/release plan: phone numbers normalized to a bare
// 10-digit string at write time, retiring the ad-hoc reformatting Patrick
// had to build NCC-side to match callers to people.
describe('lib/phone#normalizePhone', () => {
  it('strips punctuation/spaces down to 10 digits', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('5551234567');
  });

  it('drops a leading US country code on an 11-digit number', () => {
    expect(normalizePhone('1-555-123-4567')).toBe('5551234567');
  });

  it('leaves an already-bare 10-digit number unchanged', () => {
    expect(normalizePhone('5551234567')).toBe('5551234567');
  });

  it('leaves a number that does not reduce to 10 digits unchanged rather than guessing', () => {
    expect(normalizePhone('+44 20 7946 0958')).toBe('+44 20 7946 0958');
    expect(normalizePhone('12345')).toBe('12345');
  });

  it('passes through null/undefined/empty untouched', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeUndefined();
    expect(normalizePhone('')).toBe('');
  });
});
