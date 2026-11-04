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

interface TrivyOutput {
  Results?: {
    Target: string;
    Type?: string;
    Vulnerabilities?: {
      VulnerabilityID: string;
      PkgName: string;
      InstalledVersion: string;
      FixedVersion?: string;
      Severity?: string;
      Title?: string;
      Description?: string;
      PrimaryURL?: string;
    }[];
    Misconfigurations?: {
      ID: string;
      AVDID?: string;
      Title: string;
      Description?: string;
      Message?: string;
      Resolution?: string;
      Severity?: string;
      Status?: string;
      PrimaryURL?: string;
      CauseMetadata?: { Resource?: string; StartLine?: number };
    }[];
  }[];
}

export function parseTrivyVulns(
  workdir: string,
  raw: string,
): NormalizedFinding[] {
  if (!raw.trim()) return [];
  const out = parseJson<TrivyOutput>('trivy', raw);
  const findings: NormalizedFinding[] = [];
  for (const result of out.Results ?? []) {
    const file = repoPath(workdir, result.Target);
    for (const v of result.Vulnerabilities ?? []) {
      // Trivy перечисляет несколько исправленных веток через запятую: "4.17.21, 5.0.1".
      const fixedVersion = v.FixedVersion?.split(',')[0]?.trim() || undefined;
      findings.push({
        module: ScanModule.SupplyChain,
        tool: 'trivy',
        ruleId: v.VulnerabilityID,
        severity: severityFromLabel(v.Severity) ?? Severity.Low,
        title: truncate(
          `${v.PkgName}@${v.InstalledVersion}: ${v.Title ?? v.VulnerabilityID}`,
          250,
        ),
        description: v.Description ?? '',
        filePath: file,
        line: null,
        fingerprint: fingerprint(
          'supply_chain',
          file,
          v.PkgName,
          v.InstalledVersion,
          v.VulnerabilityID,
        ),
        data: {
          package: v.PkgName,
          version: v.InstalledVersion,
          ecosystem: result.Type,
          vulnId: v.VulnerabilityID,
          fixedVersion,
          malicious: false,
          url: v.PrimaryURL,
        },
        action: fixedVersion
          ? `Upgrade ${v.PkgName} to ${fixedVersion} or later`
          : `No fixed version of ${v.PkgName} yet — consider replacing the package`,
      });
    }
  }
  return findings;
}

export function parseTrivyConfig(
  workdir: string,
  raw: string,
): NormalizedFinding[] {
  if (!raw.trim()) return [];
  const out = parseJson<TrivyOutput>('trivy', raw);
  const findings: NormalizedFinding[] = [];
  for (const result of out.Results ?? []) {
    const file = repoPath(workdir, result.Target);
    for (const m of result.Misconfigurations ?? []) {
      if (m.Status && m.Status !== 'FAIL') continue;
      const resource = m.CauseMetadata?.Resource;
      findings.push({
        module: ScanModule.Infra,
        tool: 'trivy-config',
        ruleId: m.AVDID ?? m.ID,
        severity: severityFromLabel(m.Severity) ?? Severity.Medium,
        title: truncate(resource ? `${m.Title} (${resource})` : m.Title, 250),
        description: m.Message ?? m.Description ?? '',
        filePath: file,
        line: m.CauseMetadata?.StartLine ?? null,
        fingerprint: fingerprint(
          'infra',
          'trivy',
          m.AVDID ?? m.ID,
          file,
          resource ?? m.CauseMetadata?.StartLine,
        ),
        data: {
          resource,
          framework: result.Type,
          url: m.PrimaryURL,
          publicExposure: isPublicExposure(m.Title, m.Message, m.Description),
        },
        action: m.Resolution ?? `Fix the configuration: ${m.Title}`,
      });
    }
  }
  return findings;
}

export class TrivyFsAdapter implements ScannerAdapter {
  readonly module = ScanModule.SupplyChain;
  readonly tool = 'trivy';

  async run({ workdir, timeoutMs }: ScanContext) {
    const { stdout } = await runTool(
      'trivy',
      ['fs', '--scanners', 'vuln', '--format', 'json', '--quiet', '.'],
      { cwd: workdir, timeoutMs, env: trivyEnv() },
    );
    return parseTrivyVulns(workdir, stdout);
  }
}

export class TrivyConfigAdapter implements ScannerAdapter {
  readonly module = ScanModule.Infra;
  readonly tool = 'trivy-config';

  async run({ workdir, timeoutMs }: ScanContext) {
    const { stdout } = await runTool(
      'trivy',
      ['config', '--format', 'json', '--quiet', '.'],
      { cwd: workdir, timeoutMs, env: trivyEnv() },
    );
    return parseTrivyConfig(workdir, stdout);
  }
}

const trivyEnv = () =>
  process.env.TRIVY_CACHE_DIR
    ? { TRIVY_CACHE_DIR: process.env.TRIVY_CACHE_DIR }
    : {};
