import { BadRequestException } from '@nestjs/common';
import {
  decryptPersonalBackup,
  encryptPersonalBackup,
} from './personal-backup.crypto';

describe('personal backup encryption', () => {
  it('round-trips Unicode financial data without exposing plaintext', () => {
    const payload = { version: 1, note: 'Cà phê 79.000 đ', amount: '79000' };
    const encrypted = encryptPersonalBackup(payload, 'mat-khau-rat-manh');
    expect(encrypted.toString('utf8')).not.toContain(payload.note);
    expect(
      decryptPersonalBackup<typeof payload>(encrypted, 'mat-khau-rat-manh'),
    ).toEqual(payload);
  });

  it('rejects a wrong password and a tampered file', () => {
    const encrypted = encryptPersonalBackup({ value: 1 }, 'mat-khau-rat-manh');
    expect(() => decryptPersonalBackup(encrypted, 'sai-mat-khau')).toThrow(
      BadRequestException,
    );
    const envelope = JSON.parse(encrypted.toString('utf8')) as {
      ciphertext: string;
    };
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -4)}AAAA`;
    expect(() =>
      decryptPersonalBackup(
        Buffer.from(JSON.stringify(envelope)),
        'mat-khau-rat-manh',
      ),
    ).toThrow(BadRequestException);
  });
});
