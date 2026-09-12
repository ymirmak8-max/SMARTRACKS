import crypto from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export const createMfaSecret = () => {
  const bytes = crypto.randomBytes(20);
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  return bits.match(/.{1,5}/g).map(chunk => BASE32[parseInt(chunk.padEnd(5, '0'), 2)]).join('');
};

const decodeBase32 = (value) => {
  let bits = '';
  for (const char of value.replace(/=+$/g, '').toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('Invalid MFA secret.');
    bits += index.toString(2).padStart(5, '0');
  }
  return Buffer.from((bits.match(/.{8}/g) || []).map(byte => parseInt(byte, 2)));
};

const totpAt = (secret, counter) => {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(buffer).digest();
  const offset = digest[digest.length - 1] & 0xf;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(value).padStart(6, '0');
};

export const verifyTotp = (secret, code, now = Date.now()) => {
  if (!/^\d{6}$/.test(String(code || ''))) return false;
  const counter = Math.floor(now / 30000);
  return [-1, 0, 1].some(window => {
    const expected = Buffer.from(totpAt(secret, counter + window));
    const received = Buffer.from(String(code));
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  });
};

const encryptionKey = () => crypto.createHash('sha256').update(process.env.JWT_SECRET).digest();

export const encryptMfaSecret = (secret) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
};

export const decryptMfaSecret = (value) => {
  const [iv, tag, ciphertext] = String(value || '').split('.').map(part => Buffer.from(part, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
};

export const buildOtpAuthUrl = ({ email, secret }) =>
  `otpauth://totp/${encodeURIComponent(`Smartrack:${email}`)}?secret=${secret}&issuer=Smartrack&algorithm=SHA1&digits=6&period=30`;
