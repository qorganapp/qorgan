import { ScanModule, Severity } from '../../../common/security.types';
import { fingerprint } from '../../findings/fingerprint';
import { parseJson, runTool } from '../run-tool';
import { NormalizedFinding, ScanContext, ScannerAdapter } from './types';
import {
  isPublicExposure,
  repoPath,
  severityFromLabel,
  truncate,
} from './util';

interface CheckovReport {
  check_type?: string;
  results?: {
    failed_checks?: {
      check_id: string;
      check_name: string;
      file_path: string;
      file_line_range?: [number, number];
      resource?: string;
      severity?: string | null;
      guideline?: string | null;
    }[];
  };
}

const PRIVILEGE =
  /root|privileged|admin|\bIAM\b.*\*|wildcard|full access|escalat/i;

/** В OSS-версии Checkov severity = null, поэтому оцениваем по смыслу проверки. */
function checkovSeverity(name: string, label?: string | null): Severity {
  const explicit = severityFromLabel(label);
  if (explicit) return explicit;
  if (isPublicExposure(name) || PRIVILEGE.test(name)) return Severity.High;
  return Severity.Medium;
}

export function parseCheckov(
  workdir: string,
  raw: string,
): NormalizedFinding[] {
  if (!raw.trim()) return [];
  const parsed = parseJson<CheckovReport | CheckovReport[]>('checkov', raw);
  const reports = Array.isArray(parsed) ? parsed : [parsed];
  const findings: NormalizedFinding[] = [];

  for (const report of reports) {
    for (const c of report.results?.failed_checks ?? []) {
      const file = repoPath(workdir, c.file_path);
      findings.push({
        module: ScanModule.Infra,
        tool: 'checkov',
        ruleId: c.check_id,
        severity: checkovSeverity(c.check_name, c.severity),
        title: truncate(
          c.resource ? `${c.check_name} (${c.resource})` : c.check_name,
          250,
        ),
        description: c.check_name,
        filePath: file,
        line: c.file_line_range?.[0] ?? null,
        fingerprint: fingerprint(
          'infra',
          'checkov',
          c.check_id,
          file,
          c.resource,
        ),
        data: {
          resource: c.resource,
          framework: report.check_type,
          url: c.guideline ?? undefined,
          publicExposure: isPublicExposure(c.check_name),
          endLine: c.file_line_range?.[1],
        },
        action: `Fix ${c.resource ?? file}: ${c.check_name}`,
      });
    }
  }
  return findings;
}

const FRAMEWORKS = [
  'terraform',
  'cloudformation',
  'kubernetes',
  'helm',
  'kustomize',
  'dockerfile',
  'github_actions',
  'arm',
  'serverless',
];

export class CheckovAdapter implements ScannerAdapter {
  readonly module = ScanModule.Infra;
  readonly tool = 'checkov';

  async run({ workdir, timeoutMs }: ScanContext) {
    const { stdout } = await runTool(
      'checkov',
      [
        '-d',
        '.',
        '--framework',
        ...FRAMEWORKS,
        '-o',
        'json',
        '--quiet',
        '--compact',
        '--soft-fail',
        '--skip-download',
      ],
      { cwd: workdir, timeoutMs },
    );
    return parseCheckov(workdir, stdout);
  }
}
