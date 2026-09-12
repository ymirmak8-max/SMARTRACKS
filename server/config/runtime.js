export const validateRuntimeConfig = (env = process.env) => {
  const required = ['JWT_SECRET', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter(name => !env[name]?.trim());
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  if (env.NODE_ENV === 'production' && env.JWT_SECRET.length < 32) {
    throw new Error('JWT_SECRET must contain at least 32 characters in production.');
  }

  if (env.COOKIE_SAME_SITE === 'none' && env.NODE_ENV !== 'production') {
    throw new Error('COOKIE_SAME_SITE=none requires production HTTPS cookies.');
  }
};
