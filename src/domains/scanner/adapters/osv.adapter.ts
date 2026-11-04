import { ScanModule, Severity } from '../../../common/security.types';
import { fingerprint } from '../../findings/fingerprint';
import { parseJson, runTool } from '../run-tool';
import { NormalizedFinding, ScanContext, ScannerAdapter } from './types';
import {
  maxVersion,
  repoPath,
  severityFromCvss,
  severityFromLabel,
  truncate,
} from './util';

interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  affected?: {
    package?: { name?: string };
    ranges?: {
      type?: string;
      events?: { introduced?: string; fixed?: string }[];
    }[];
  }[];
  database_specific?: { severity?: string };
}

interface OsvOutput {
  results?: {
    source?: { path?: string };
    packages?: {
      package: { name: string; version: string; ecosystem: string };
      vulnerabilities?: OsvVuln[];
      groups?: { ids: string[]; max_severity?: string }[];
    }[];
  }[];
}

/** CVE — общий знаменатель между OSV (GHSA-*) и Trivy (CVE-*). */
export const canonicalVulnId = (id: string, aliases: string[] = []) =>
  [id, ...aliases].find((a) => a.startsWith('CVE-')) ?? id;

export function parseOsv(workdir: string, raw: string): NormalizedFinding[] {
  if (!raw.trim()) return [];
  const out = parseJson<OsvOutput>('osv-scanner', raw);
  const findings: NormalizedFinding[] = [];

  for (const result of out.results ?? []) {
    const file = repoPath(workdir, result.source?.path);
    for (const pkg of result.packages ?? []) {
      const { name, version, ecosystem } = pkg.package;
      const seen = new Set<string>();
      for (const vuln of pkg.vulnerabilities ?? []) {
        const vulnId = canonicalVulnId(vuln.id, vuln.aliases);
        if (seen.has(vulnId)) continue;
        seen.add(vulnId);

        const malicious = vuln.id.startsWith('MAL-');
        const group = pkg.groups?.find((g) => g.ids.includes(vuln.id));
        const severity = malicious
          ? Severity.Critical
          : (severityFromCvss(Number(group?.max_severity)) ??
            severityFromLabel(vuln.database_specific?.severity) ??
            Severity.Medium);
        const fixedVersion = maxVersion(
          (vuln.affected ?? [])
            .filter((a) => !a.package?.name || a.package.name === name)
            .flatMap((a) => a.ranges ?? [])
            // GIT-диапазоны содержат хеши коммитов, а не версии пакета.
            .filter((r) => r.type !== 'GIT')
            .flatMap((r) => r.events ?? [])
            .map((e) => e.fixed)
            .filter((v): v is string => !!v),
        );

        findings.push({
          module: ScanModule.SupplyChain,
          tool: 'osv-scanner',
          ruleId: vulnId,
          severity,
          title: malicious
            ? `Вредоносный пакет ${name}@${version}`
            : truncate(`${name}@${version}: ${vuln.summary ?? vulnId}`, 250),
          description: vuln.details ?? vuln.summary ?? '',
          filePath: file,
          line: null,
          fingerprint: fingerprint('supply_chain', file, name, version, vulnId),
          data: {
            package: name,
            version,
            ecosystem,
            vulnId,
            aliases: [vuln.id, ...(vuln.aliases ?? [])],
            fixedVersion,
            malicious,
            url: `https://osv.dev/vulnerability/${vuln.id}`,
          },
          action: malicious
            ? `Немедленно удалите ${name} из зависимостей и проверьте машины, где он устанавливался`
            : fixedVersion
              ? `Обновите ${name} до ${fixedVersion} или новее`
              : `Исправленной версии ${name} пока нет — оцените замену пакета или изоляцию уязвимого кода`,
        });
      }
    }
  }
  return findings;
}

export class OsvAdapter implements ScannerAdapter {
  readonly module = ScanModule.SupplyChain;
  readonly tool = 'osv-scanner';

  async run({ workdir, timeoutMs }: ScanContext) {
    // 1 — найдены уязвимости, 128 — в репозитории нет lock-файлов.
    const { stdout, exitCode } = await runTool(
      'osv-scanner',
      ['scan', 'source', '--recursive', '--format', 'json', workdir],
      { timeoutMs, okExitCodes: [0, 1, 128] },
    );
    return exitCode === 128 ? [] : parseOsv(workdir, stdout);
  }
}
