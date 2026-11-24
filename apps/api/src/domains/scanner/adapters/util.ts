import { isAbsolute, relative } from 'node:path';
import { Severity } from '../../../common/security.types';

/** Путь относительно корня репозитория, всегда с прямыми слэшами и без ведущего "/". */
export function repoPath(workdir: string, path: string | undefined | null) {
  if (!path) return null;
  const rel =
    isAbsolute(path) && path.startsWith(workdir)
      ? relative(workdir, path)
      : path;
  return rel.replace(/\\/g, '/').replace(/^\.?\//, '') || null;
}

export function severityFromCvss(score: number | undefined): Severity | null {
  if (score === undefined || Number.isNaN(score)) return null;
  if (score >= 9) return Severity.Critical;
  if (score >= 7) return Severity.High;
  if (score >= 4) return Severity.Medium;
  if (score > 0) return Severity.Low;
  return null;
}

export function severityFromLabel(
  label: string | undefined | null,
): Severity | null {
  switch (label?.toUpperCase()) {
    case 'CRITICAL':
      return Severity.Critical;
    case 'HIGH':
    case 'ERROR':
      return Severity.High;
    case 'MEDIUM':
    case 'MODERATE':
    case 'WARNING':
      return Severity.Medium;
    case 'LOW':
    case 'INFO':
      return Severity.Low;
    default:
      return null;
  }
}

const PUBLIC_EXPOSURE =
  /public|0\.0\.0\.0\/0|::\/0|internet|anonymous|world[- ]?readable|unrestricted|any ip/i;

export const isPublicExposure = (...texts: (string | undefined | null)[]) =>
  texts.some((t) => !!t && PUBLIC_EXPOSURE.test(t));

/** Грубое сравнение версий вида 1.2.10 > 1.2.9 (для выбора «до какой версии обновиться»). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/);
  const pb = b.split(/[.+-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    const diff =
      !Number.isNaN(nx) && !Number.isNaN(ny) ? nx - ny : x.localeCompare(y);
    if (diff !== 0) return diff;
  }
  return 0;
}

export const maxVersion = (versions: string[]) =>
  versions.length
    ? versions.reduce((m, v) => (compareVersions(v, m) > 0 ? v : m))
    : undefined;

export const truncate = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max - 1)}…` : s;
