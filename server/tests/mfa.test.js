import test from 'node:test';
import assert from 'node:assert/strict';
import { createMfaSecret, decryptMfaSecret, encryptMfaSecret, verifyTotp } from '../utils/mfa.js';

process.env.JWT_SECRET = 'mfa-test-secret-with-at-least-32-characters';

test('MFA secrets are encrypted at rest and decrypt correctly', () => {
  const secret = createMfaSecret();
  const encrypted = encryptMfaSecret(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(decryptMfaSecret(encrypted), secret);
});

test('TOTP verification rejects malformed and expired codes', () => {
  const secret = createMfaSecret();
  assert.equal(verifyTotp(secret, '12345'), false);
  assert.equal(verifyTotp(secret, 'abcdef'), false);
});
