# Workspace and MySQL backup

Each dated folder contains an AES-256-GCM encrypted archive split into parts below GitHub's per-file limit. The manifest includes checksums. The GitHub repositories are public; only ciphertext is uploaded for private data.

The archive includes the three project source directories, the MySQL schema/data export (`database.sql`), uploads, private environment files, local documents and supporting workspace files. Dependencies, Git history, generated builds/caches and Codex temporary/quarantine directories are excluded. Install dependencies again with `npm.cmd ci`.

The 256-bit decryption key is NOT in Git. Copy `RESTORE-KEY.txt` separately from the original machine's `.codex-quarantine/backup-<timestamp>/` to your laptop or a secure offline location. Losing this key makes this archive unrecoverable. Do not commit it or paste its contents into chat.

## Restore on another laptop

1. Clone the three repositories. Clone backend first to obtain this archive and `scripts/decrypt-backup.cjs`.
2. Copy the matching key separately.
3. From backend, run:

```powershell
node scripts/decrypt-backup.cjs backups/<timestamp>/manifest.json C:/private/RESTORE-KEY.txt C:/private/restored-workspace.tar.gz
```

4. Extract into a **new empty directory**, never directly over an existing checkout. The archive contains `backend/`, `mobile/`, `web_admin/`, other workspace files and `database.sql`.
5. Install MySQL and restore `database.sql` into a separately created database using MySQL Workbench or the mysql client. Do not run `prisma migrate reset` or seed scripts. The dump does not create your MySQL server login; create/configure that login on the destination machine.
6. Restore `backend/uploads` and the appropriate local configuration. Adjust database host/login/database name in `.env` for the new machine. Keep secrets private.
7. Install dependencies, build backend, then check login, wallet totals, transactions, savings, loans and an uploaded image. Configure the new HTTPS endpoint before rebuilding the APK.

Verification performed during backup: mysqldump exit status/completion marker, InnoDB consistency prerequisite, AES-GCM decryption and SHA-256 round trip. This verifies the archive, **not a successful MySQL restore on another machine**. No database restore/reset was performed during backup.

Source repositories:
- https://github.com/NguyenLangPhuocAn/QuanLyChiTieu-backend
- https://github.com/NguyenLangPhuocAn/QuanLyChiTieu-mobile
- https://github.com/NguyenLangPhuocAn/QuanLyChiTieu-AdminWeb
