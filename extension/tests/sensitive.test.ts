import { describe, expect, it } from 'vitest';
import { isSensitiveField, matchesSensitiveWords, normalizeText } from '../lib/sensitive';

const input = (extra: Record<string, string | boolean>) => ({ tag: 'input', type: 'text', ...extra });

describe('sensitive rules', () => {
  it('password and hidden inputs', () => {
    expect(isSensitiveField(input({ type: 'password' }))).toBe(true);
    expect(isSensitiveField(input({ type: 'PASSWORD' }))).toBe(true);
    expect(isSensitiveField(input({ type: 'hidden' }))).toBe(true);
    expect(isSensitiveField(input({ type: 'text' }))).toBe(false);
    expect(isSensitiveField({ tag: 'select' })).toBe(false);
  });

  it('autocomplete: passwords, card data, one time codes', () => {
    for (const ac of [
      'current-password',
      'new-password',
      'one-time-code',
      'cc-number',
      'cc-csc',
      'cc-exp',
      'cc-exp-month',
      'cc-exp-year',
      'cc-name',
      'section-pay billing cc-number',
    ]) {
      expect(isSensitiveField(input({ autocomplete: ac })), ac).toBe(true);
    }
    for (const ac of ['username', 'email', 'name', 'street-address', 'off', 'tel']) {
      expect(isSensitiveField(input({ autocomplete: ac })), ac).toBe(false);
    }
  });

  it('word list in name, id, label and placeholder (English)', () => {
    expect(isSensitiveField(input({ name: 'user_password' }))).toBe(true);
    expect(isSensitiveField(input({ name: 'confirmpassword' }))).toBe(true);
    expect(isSensitiveField(input({ id: 'loginPasscode' }))).toBe(true);
    expect(isSensitiveField(input({ name: 'pin' }))).toBe(true);
    expect(isSensitiveField(input({ label: 'Enter your PIN' }))).toBe(true);
    expect(isSensitiveField(input({ name: 'cvv' }))).toBe(true);
    expect(isSensitiveField(input({ label: 'Client secret' }))).toBe(true);
    expect(isSensitiveField(input({ placeholder: 'API token' }))).toBe(true);
    expect(isSensitiveField(input({ name: 'card_number' }))).toBe(true);
    expect(isSensitiveField(input({ label: 'Security code' }))).toBe(true);
    expect(isSensitiveField(input({ ariaLabel: 'Verification code' }))).toBe(true);
    expect(isSensitiveField(input({ name: 'otp' }))).toBe(true);
  });

  it('word list (Spanish, with and without accents)', () => {
    expect(isSensitiveField(input({ label: 'Contraseña' }))).toBe(true);
    expect(isSensitiveField(input({ label: 'contrasena' }))).toBe(true);
    expect(isSensitiveField(input({ label: 'Clave de acceso' }))).toBe(true);
    expect(isSensitiveField(input({ label: 'Código de seguridad' }))).toBe(true);
    expect(isSensitiveField(input({ label: 'Número de tarjeta' }))).toBe(true);
    expect(isSensitiveField(input({ name: 'secreto' }))).toBe(true);
    expect(isSensitiveField(input({ label: 'Código de verificación' }))).toBe(true);
  });

  it('does not flag ordinary fields that contain the short words inside other words', () => {
    for (const name of [
      'shipping',
      'spinner',
      'pinned',
      'opinion',
      'passenger',
      'compass',
      'username',
      'email',
      'Amount',
      'Customer',
      'Importe',
      'Concepto',
      'Apellidos',
    ]) {
      expect(isSensitiveField(input({ name })), name).toBe(false);
      expect(isSensitiveField(input({ label: name })), name).toBe(false);
    }
  });

  it('honors data-spoor="ignore"', () => {
    expect(isSensitiveField(input({ optOut: true }))).toBe(true);
  });

  it('normalizes camelCase, separators and accents', () => {
    expect(normalizeText('userPIN_Code')).toBe('user pin code');
    expect(normalizeText('Contraseña nueva')).toBe('contrasena nueva');
    expect(matchesSensitiveWords('')).toBe(false);
    expect(matchesSensitiveWords(undefined)).toBe(false);
  });
});
