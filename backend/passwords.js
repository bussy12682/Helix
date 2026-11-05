import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;
const COST = 16384;

/**
 * Hashes a password with a per-user random salt using scrypt.
 * Format: scrypt$<N>$<saltHex>$<hashHex>
 */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(String(password), salt, KEY_LENGTH, { N: COST });
  return `scrypt$${COST}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/**
 * Verifies a password against a stored hash. Accepts legacy unsalted SHA-256 hashes
 * (`sha256(password:secret)`) so existing accounts keep working; those report `needsRehash`.
 */
export async function verifyPassword(password, storedHash, legacySecret = '') {
  if (!storedHash || typeof storedHash !== 'string') return { valid: false, needsRehash: false };

  if (storedHash.startsWith('scrypt$')) {
    const [, cost, saltHex, hashHex] = storedHash.split('$');
    const expected = Buffer.from(hashHex ?? '', 'hex');
    if (!saltHex || expected.length === 0) return { valid: false, needsRehash: false };
    const derived = await scryptAsync(String(password), Buffer.from(saltHex, 'hex'), expected.length, { N: Number(cost) || COST });
    return { valid: timingSafeEqual(derived, expected), needsRehash: Number(cost) !== COST };
  }

  const legacy = createHash('sha256').update(`${password}:${legacySecret}`).digest();
  const expected = Buffer.from(storedHash, 'hex');
  const valid = expected.length === legacy.length && timingSafeEqual(legacy, expected);
  return { valid, needsRehash: valid };
}
