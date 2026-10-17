import { BadRequestException } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto';

const ENVELOPE_FORMAT = 'SO_THU_CHI_NOVA_ENCRYPTED_BACKUP';

type BackupEnvelope = {
  format: typeof ENVELOPE_FORMAT;
  version: 1;
  kdf: { name: 'scrypt'; salt: string };
  cipher: { name: 'aes-256-gcm'; iv: string; tag: string };
  ciphertext: string;
};

const invalidBackup = () =>
  new BadRequestException('Mật khẩu hoặc file backup không đúng.');

export const encryptPersonalBackup = (payload: unknown, password: string) => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(password, salt, 32);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const envelope: BackupEnvelope = {
    format: ENVELOPE_FORMAT,
    version: 1,
    kdf: { name: 'scrypt', salt: salt.toString('base64') },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    },
    ciphertext: ciphertext.toString('base64'),
  };
  return Buffer.from(JSON.stringify(envelope), 'utf8');
};

export const decryptPersonalBackup = <T>(file: Buffer, password: string): T => {
  try {
    const envelope = JSON.parse(file.toString('utf8')) as BackupEnvelope;
    if (
      envelope.format !== ENVELOPE_FORMAT ||
      envelope.version !== 1 ||
      envelope.kdf?.name !== 'scrypt' ||
      envelope.cipher?.name !== 'aes-256-gcm'
    ) {
      throw invalidBackup();
    }
    const key = scryptSync(
      password,
      Buffer.from(envelope.kdf.salt, 'base64'),
      32,
    );
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.cipher.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.cipher.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
    return JSON.parse(plaintext.toString('utf8')) as T;
  } catch (error) {
    if (error instanceof BadRequestException) throw error;
    throw invalidBackup();
  }
};
