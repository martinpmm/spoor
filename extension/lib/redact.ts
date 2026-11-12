/**
 * Redaction for page titles and element labels: emails, phone numbers and long digit strings.
 * Typed values are stored as typed (plan section 8) and do not pass through here.
 */

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
// International (+34 612 345 678) or grouped local numbers ((555) 123-4567, 612 34 56 78) with 9 to 15 digits.
const PHONE = /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{1,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){1,4}/g;
const PHONE_PLUS = /\+\d[\d\s().-]{7,}\d/g;
const LONG_DIGITS = /\d{6,}/g;
const DATE_LIKE = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}$|^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/;

function digitCount(s: string): number {
  return (s.match(/\d/g) ?? []).length;
}

export function redact(text: string | undefined | null): string | undefined {
  if (text === undefined || text === null) return undefined;
  let out = text.replace(EMAIL, '[email]');
  out = out.replace(PHONE_PLUS, (m) => (digitCount(m) >= 8 && digitCount(m) <= 15 ? '[phone]' : m));
  out = out.replace(PHONE, (m) => {
    const d = digitCount(m);
    if (DATE_LIKE.test(m.trim())) return m;
    return d >= 9 && d <= 15 ? '[phone]' : m;
  });
  out = out.replace(LONG_DIGITS, '[number]');
  return out;
}
