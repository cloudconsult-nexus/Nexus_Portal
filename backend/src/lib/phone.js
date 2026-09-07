// Phase 5.4 Release 1 (Phase A2 of the NCC dev/release plan, 2026-09-07):
// normalize phone numbers to a bare 10-digit string at write time, on every
// Person/Contact phone field. This retires the ad-hoc reformatting logic
// ("people numbers" variable) Patrick had to build on the NCC side just to
// match callers to people — NCC's "get people" pull should see consistently
// formatted numbers with no downstream cleanup needed.
//
// Deliberately US/Canada-shaped (strip to exactly 10 digits): that's the
// shape NCC's matching logic expects per the plan. A number that doesn't
// reduce to exactly 10 digits (an intl number, an extension, garbage input)
// is left as-is rather than truncated/guessed — better to store something
// recognizably wrong than to silently mangle a real number.
export function normalizePhone(value) {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return trimmed;

  const digits = trimmed.replace(/\D/g, '');
  // A leading "1" country code on an 11-digit US number reduces to the same
  // 10-digit local number NCC expects.
  const tenDigits = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return tenDigits.length === 10 ? tenDigits : trimmed;
}
