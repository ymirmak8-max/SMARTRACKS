import test from 'node:test';
import assert from 'node:assert/strict';
import { hashRefreshToken } from '../models/userModel.js';

test('refresh tokens are stored as deterministic SHA-256 hashes', () => {
  const token = 'a-sensitive-refresh-token';
  const hash = hashRefreshToken(token);

  assert.equal(hash.length, 64);
  assert.notEqual(hash, token);
  assert.equal(hashRefreshToken(token), hash);
  assert.notEqual(hashRefreshToken(`${token}-different`), hash);
});
