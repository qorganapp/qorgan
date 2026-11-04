import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScanModule, Severity } from '../../../common/security.types';
import { fingerprint } from '../../findings/fingerprint';
import { parseJson, runTool } from '../run-tool';
import { NormalizedFinding, ScanContext, ScannerAdapter } from './types';
import { repoPath, severityFromLabel, truncate } from './util';

interface SemgrepOutput {
  results?: {
    check_id: string;
    path: string;
    start: { line: number };
    end?: { line: number };
    extra: {
      message: string;
      severity?: string;
      lines?: string;
      fix?: string;
      metadata?: {
        cwe?: string | string[];
        owasp?: string | string[];
        confidence?: string;
        impact?: string;
        likelihood?: string;
        references?: string[];
        category?: string;
      };
    };
  }[];
}

const firstSentence = (text: string) =>
  truncate(text.split('\n')[0].split(/(?<=\.)\s/)[0], 200);

const asArray = (v: string | string[] | undefined) =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

/** Достаёт строки кода из клона: без логина Semgrep отдаёт вместо них "requires login". */
export type SourceReader = (
  file: string,
  start: number,
  end: number,
) => string | undefined;

export function fileSourceReader(workdir: string): SourceReader {
  const cache = new Map<string, string[] | null>();
  return (file, start, end) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, readFileSync(join(workdir, file), 'utf8').split('\n'));
      } catch {
        cache.set(file, null);
      }
    }
    return cache
      .get(file)
      ?.slice(start - 1, end)
      .join('\n');
  };
}

export function parseSemgrep(
  workdir: string,
  raw: string,
  readSource?: SourceReader,
): NormalizedFinding[] {
  if (!raw.trim()) return [];
  const out = parseJson<SemgrepOutput>('semgrep', raw);
  return (out.results ?? []).map((r) => {
    const file = repoPath(workdir, r.path);
    const meta = r.extra.metadata ?? {};
    let severity = severityFromLabel(r.extra.severity) ?? Severity.Medium;
    // ERROR с высокой уверенностью и влиянием — почти наверняка эксплуатируемо.
    if (
      severity === Severity.High &&
      meta.impact === 'HIGH' &&
      meta.confidence === 'HIGH'
    ) {
      severity = Severity.Critical;
    }
    if (meta.confidence === 'LOW' && severity !== Severity.Low) {
      severity =
        severity === Severity.Critical ? Severity.High : Severity.Medium;
    }
    // `lines` без логина в Semgrep может быть заглушкой "requires login".
    const code =
      r.extra.lines && r.extra.lines !== 'requires login'
        ? r.extra.lines
        : file
          ? readSource?.(file, r.start.line, r.end?.line ?? r.start.line)
          : undefined;
    const rule = r.check_id.split('.').pop() ?? r.check_id;

    return {
      module: ScanModule.CodeAudit,
      tool: 'semgrep',
      ruleId: r.check_id,
      severity,
      title: truncate(`${rule} в ${file}:${r.start.line}`, 250),
      description: r.extra.message,
      filePath: file,
      line: r.start.line,
      // Привязка к коду, а не к номеру строки: сдвиг кода не создаёт «новую» находку.
      fingerprint: fingerprint(
        'code_audit',
        r.check_id,
        file,
        code ?? r.start.line,
      ),
      data: {
        endLine: r.end?.line,
        cwe: asArray(meta.cwe),
        owasp: asArray(meta.owasp),
        confidence: meta.confidence,
        impact: meta.impact,
        references: meta.references ?? [],
        snippet: code ? truncate(code, 1000) : undefined,
        fix: r.extra.fix,
      },
      action: r.extra.fix
        ? `Замените код на: ${truncate(r.extra.fix, 300)}`
        : `Исправьте ${file}:${r.start.line} — ${firstSentence(r.extra.message)}`,
    };
  });
}

export class SemgrepAdapter implements ScannerAdapter {
  readonly module = ScanModule.CodeAudit;
  readonly tool = 'semgrep';

  async run({ workdir, timeoutMs }: ScanContext) {
    const configs = (process.env.SEMGREP_CONFIGS ?? 'p/default')
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean)
      .flatMap((c) => ['--config', c]);
    const { stdout } = await runTool(
      'semgrep',
      [
        'scan',
        ...configs,
        '--json',
        '--metrics',
        'off',
        '--quiet',
        '--disable-version-check',
        '--timeout',
        '30',
        '.',
      ],
      { cwd: workdir, timeoutMs, okExitCodes: [0, 1] },
    );
    return parseSemgrep(workdir, stdout, fileSourceReader(workdir));
  }
}
