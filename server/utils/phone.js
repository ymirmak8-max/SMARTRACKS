export const MAX_PHONE_DIGITS = 11;

export const sanitizePhone = (value) => {
  if (value == null || value === '') return null;
  return String(value).replace(/\D/g, '').slice(0, MAX_PHONE_DIGITS) || null;
};
