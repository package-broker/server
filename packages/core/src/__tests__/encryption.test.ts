import { describe, it, expect } from 'vitest';
import { encryptCredentials, decryptCredentials, generateEncryptionKey } from '../utils/encryption';

describe('Encryption Utilities', () => {
  it('should generate a valid encryption key', async () => {
    const key = await generateEncryptionKey();
    expect(key).toBeDefined();
    expect(typeof key).toBe('string');
    // Base64 encoded 32-byte key should be ~44 characters
    expect(key.length).toBeGreaterThan(40);
  });

  it('should encrypt and decrypt credentials', async () => {
    const key = await generateEncryptionKey();
    const original = JSON.stringify({ username: 'test', password: 'secret123' });

    const encrypted = await encryptCredentials(original, key);
    expect(encrypted).not.toBe(original);

    const decrypted = await decryptCredentials(encrypted, key);
    expect(decrypted).toBe(original);
  });

  it('should produce different ciphertexts for same plaintext (random IV)', async () => {
    const key = await generateEncryptionKey();
    const original = 'test-data';

    const encrypted1 = await encryptCredentials(original, key);
    const encrypted2 = await encryptCredentials(original, key);

    expect(encrypted1).not.toBe(encrypted2);

    // Both should decrypt to same value
    expect(await decryptCredentials(encrypted1, key)).toBe(original);
    expect(await decryptCredentials(encrypted2, key)).toBe(original);
  });

  it('should fail decryption with wrong key', async () => {
    const key1 = await generateEncryptionKey();
    const key2 = await generateEncryptionKey();
    const original = 'sensitive-data';

    const encrypted = await encryptCredentials(original, key1);

    await expect(decryptCredentials(encrypted, key2)).rejects.toThrow();
  });
});




