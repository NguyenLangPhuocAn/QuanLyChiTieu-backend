// Usage: node scripts/decrypt-backup.cjs <manifest.json> <RESTORE-KEY.txt> <new-output.tar.gz>
// Only decrypts an archive. Does not extract files or import a database.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [manifestPath, keyPath, outputPath] = process.argv.slice(2);
if (!manifestPath || !keyPath || !outputPath) {
  console.error('Usage: node scripts/decrypt-backup.cjs <manifest.json> <key-file> <new-output.tar.gz>');
  process.exit(1);
}
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const keyText = fs.readFileSync(keyPath, 'utf8').trim();
  if (manifest.format !== 1 || manifest.cipher !== 'aes-256-gcm' || !/^[a-f0-9]{64}$/i.test(keyText)) throw Error('Unsupported backup or invalid key');
  if (fs.existsSync(outputPath)) throw Error('Output already exists; choose a new path');
  const encrypted = Buffer.concat(manifest.parts.map(part => {
    if (!/^backup\.part\d+\.enc$/.test(part.name)) throw Error('Invalid part name');
    const bytes = fs.readFileSync(path.join(path.dirname(manifestPath), part.name));
    if (bytes.length !== part.bytes || crypto.createHash('sha256').update(bytes).digest('hex') !== part.sha256) throw Error('Backup part checksum mismatch');
    return bytes;
  }));
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(keyText, 'hex'), Buffer.from(manifest.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(manifest.tag, 'hex'));
  const plain = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  if (crypto.createHash('sha256').update(plain).digest('hex') !== manifest.plainSha256) throw Error('Archive checksum mismatch');
  fs.writeFileSync(outputPath, plain, {flag:'wx'});
  console.log('Backup verified and decrypted. Extract into a NEW folder; import database only into a separate database first.');
} catch (error) {
  console.error('Restore failed:', error instanceof Error ? error.message : 'Unknown error');
  process.exitCode = 1;
}
