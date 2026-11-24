import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ScanModule, Severity } from '../../../common/security.types';
import { fingerprint, sha256 } from '../../findings/fingerprint';
import { parseJson, runTool } from '../run-tool';
import {
  RAW_SECRET,
  ScanContext,
  ScannerAdapter,
  SecretFinding,
} from './types';
import { repoPath } from './util';

interface GitleaksLeak {
  RuleID: string;
  Description: string;
  File: string;
  StartLine: number;
  Secret: string;
  Commit?: string;
  Author?: string;
  Date?: string;
}

/** "Uncovered a GitHub Personal Access Token, potentially…" → "GitHub Personal Access Token" */
const secretKind = (leak: GitleaksLeak) =>
  (leak.Description || leak.RuleID)
    .split(',')[0]
    .replace(
      /^(uncovered|identified|detected|found|discovered)\s+(an?\s+)?/i,
      '',
    )
    .trim();

export const maskSecret = (secret: string) =>
  secret.length >= 12
    ? `${secret.slice(0, 4)}…${secret.slice(-2)}`
    : '*'.repeat(Math.min(secret.length, 8));

/**
 * Один секрет = одна находка, даже если он встречается в десятках коммитов:
 * ротировать надо ключ, а не каждое его вхождение.
 */
export function parseGitleaks(workdir: string, raw: string): SecretFinding[] {
  if (!raw.trim()) return [];
  const leaks = parseJson<GitleaksLeak[] | null>('gitleaks', raw) ?? [];
  const bySecret = new Map<
    string,
    { leak: GitleaksLeak; all: GitleaksLeak[] }
  >();

  for (const leak of leaks) {
    if (!leak.Secret) continue;
    const key = `${leak.RuleID}|${leak.Secret}`;
    const entry = bySecret.get(key);
    if (!entry) bySecret.set(key, { leak, all: [leak] });
    else {
      entry.all.push(leak);
      // Представитель — самое раннее появление (там секрет утёк впервые).
      if ((leak.Date ?? '') < (entry.leak.Date ?? '')) entry.leak = leak;
    }
  }

  return [...bySecret.values()].map(({ leak, all }) => {
    const file = repoPath(workdir, leak.File);
    const secretHash = sha256(leak.Secret);
    const files = [...new Set(all.map((l) => repoPath(workdir, l.File)))];
    return {
      module: ScanModule.Secrets,
      tool: 'gitleaks',
      ruleId: leak.RuleID,
      severity: Severity.High,
      title: `${secretKind(leak)} in ${file ?? 'repository'}`,
      description: `Found ${all.length} occurrence(s) in ${files.length} file(s) across git history. Value: ${maskSecret(leak.Secret)}`,
      filePath: file,
      line: leak.StartLine ?? null,
      fingerprint: fingerprint('secrets', leak.RuleID, secretHash),
      data: {
        secretType: leak.RuleID,
        masked: maskSecret(leak.Secret),
        secretHash,
        firstCommit: leak.Commit,
        firstSeenAt: leak.Date,
        author: leak.Author,
        occurrences: all.length,
        files: files.slice(0, 20),
        validity: 'unknown',
      },
      action:
        'Revoke and reissue the key with the provider, then remove it from the code and git history (git filter-repo / BFG)',
      [RAW_SECRET]: leak.Secret,
    };
  });
}

export class GitleaksAdapter implements ScannerAdapter {
  readonly module = ScanModule.Secrets;
  readonly tool = 'gitleaks';

  async run({ workdir, timeoutMs, reportDir }: ScanContext) {
    const report = join(reportDir, 'gitleaks.json');
    await runTool(
      'gitleaks',
      [
        'git',
        '--report-format',
        'json',
        '--report-path',
        report,
        '--exit-code',
        '0',
        '--no-banner',
        '--log-level',
        'error',
        workdir,
      ],
      { timeoutMs },
    );
    return parseGitleaks(workdir, await readFile(report, 'utf8'));
  }
}
