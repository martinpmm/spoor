/**
 * Fields that are never recorded, in any mode (plan section 8):
 *   - inputs of type password and hidden inputs
 *   - autocomplete marking current/new password, card data or one time code
 *   - name, id or label matching the sensitive word list (English and Spanish)
 * A sensitive field produces no event at all: no click, no change, no copy, no paste.
 */

export interface FieldDescriptor {
  tag: string;
  type?: string;
  autocomplete?: string;
  name?: string;
  id?: string;
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  /** data-spoor="ignore" or a parent marked so */
  optOut?: boolean;
}

const SENSITIVE_AUTOCOMPLETE = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-name',
  'cc-given-name',
  'cc-additional-name',
  'cc-family-name',
  'cc-number',
  'cc-exp',
  'cc-exp-month',
  'cc-exp-year',
  'cc-csc',
  'cc-type',
]);

/** Words matched anywhere inside a normalized name ("confirmpassword", "user_passcode"). */
const SUBSTRING_WORDS = [
  'password',
  'passwd',
  'passcode',
  'passphrase',
  'secret',
  'token',
  'cvv',
  'cvc',
  'creditcard',
  'cardnumber',
  'ccnumber',
  'securitycode',
  'onetimecode',
  'otpcode',
  'apikey',
  'privatekey',
  // Spanish
  'contrasena',
  'contrasenya',
  'clave',
  'secreto',
  'codigodeseguridad',
  'codigoseguridad',
  'numerodetarjeta',
  'numerotarjeta',
  'codigodeverificacion',
  'codigoverificacion',
];

/** Short words matched only as whole tokens, so "shipping" or "spinner" do not match "pin". */
const TOKEN_WORDS = new Set([
  'pin',
  'pwd',
  'pass',
  'otp',
  'csc',
  'cvv2',
  'cvc2',
  'mfa',
  '2fa',
  'tan',
  'nip',
  'ssn',
]);

/** Multi word phrases checked on the spaced, normalized label. */
const PHRASES = [
  'card number',
  'security code',
  'one time',
  'verification code',
  'auth code',
  'authentication code',
  'numero de tarjeta',
  'codigo de seguridad',
  'codigo de verificacion',
  'codigo de un solo uso',
];

/** Lowercase, strip accents, split camelCase and separators into space separated tokens. */
export function normalizeText(s: string): string {
  return s
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function matchesSensitiveWords(raw: string | undefined): boolean {
  if (!raw) return false;
  const spaced = normalizeText(raw);
  if (!spaced) return false;
  const joined = spaced.replace(/ /g, '');
  if (SUBSTRING_WORDS.some((w) => joined.includes(w))) return true;
  if (spaced.split(' ').some((t) => TOKEN_WORDS.has(t))) return true;
  return PHRASES.some((p) => ` ${spaced} `.includes(` ${p} `));
}

export function isSensitiveField(f: FieldDescriptor): boolean {
  if (f.optOut) return true;
  const tag = f.tag.toLowerCase();
  const type = (f.type ?? '').toLowerCase();
  if (tag === 'input' && (type === 'password' || type === 'hidden')) return true;
  const ac = (f.autocomplete ?? '').toLowerCase().split(/\s+/);
  if (ac.some((t) => SENSITIVE_AUTOCOMPLETE.has(t))) return true;
  return [f.name, f.id, f.label, f.placeholder, f.ariaLabel].some(matchesSensitiveWords);
}
