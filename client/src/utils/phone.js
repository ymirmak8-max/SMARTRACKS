export const MAX_PHONE_DIGITS = 11;

export const sanitizePhone = (value) => String(value || '').replace(/\D/g, '').slice(0, MAX_PHONE_DIGITS);
