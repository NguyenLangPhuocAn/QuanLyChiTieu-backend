/** Keep multi-word Vietnamese names intact across CRUD and transaction filters. */
export const normalizeTagName = (value: string) =>
  value
    .normalize('NFC')
    .trim()
    .replace(/^#+/, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, 50);
