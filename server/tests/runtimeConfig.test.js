import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRuntimeConfig } from '../config/runtime.js';

test('runtime configuration reports all missing required values', () => {
  assert.throws(
    () => validateRuntimeConfig({}),
    /JWT_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY/
  );
});

test('production rejects weak signing secrets', () => {
  assert.throws(
    () => validateRuntimeConfig({
      NODE_ENV: 'production',
      JWT_SECRET: 'short',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role',
    }),
    /at least 32 characters/
  );
});

test('valid production configuration is accepted', () => {
  assert.doesNotThrow(() => validateRuntimeConfig({
    NODE_ENV: 'production',
    JWT_SECRET: 'a'.repeat(32),
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role',
  }));
});
