import { createHash } from 'node:crypto';

export const sha256 = (value: string): string =>
  createHash('sha256').update(value).digest('hex');

/** Fingerprint из частей; пустые части пропускаются, пробелы нормализуются. */
export const fingerprint = (...parts: (string | number | null | undefined)[]) =>
  sha256(
    parts
      .filter((p) => p !== null && p !== undefined && p !== '')
      .map((p) => String(p).replace(/\s+/g, ' ').trim())
      .join('|'),
  );
