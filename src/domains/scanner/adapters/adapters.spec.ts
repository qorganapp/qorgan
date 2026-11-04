import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ScanModule, Severity } from '../../../common/security.types';
import { mergeDuplicates } from '../../findings/merge';
import { parseCheckov } from './checkov.adapter';
import { maskSecret, parseGitleaks } from './gitleaks.adapter';
import { parseOsv } from './osv.adapter';
import { parseSemgrep } from './semgrep.adapter';
import { parseTrivyConfig, parseTrivyVulns } from './trivy.adapter';
import { RAW_SECRET } from './types';

// Фикстуры — реальный вывод сканеров на тестовом уязвимом репозитории, смонтированном в /repo.
const WORKDIR = '/repo';
const fixture = (name: string) =>
  readFileSync(join(__dirname, '..', '__fixtures__', name), 'utf8');

const allUnique = (fps: string[]) => new Set(fps).size === fps.length;

describe('osv-scanner', () => {
  const findings = parseOsv(WORKDIR, fixture('osv.json'));

  it('normalizes vulnerable packages with repo-relative lockfile paths', () => {
    expect(findings.length).toBeGreaterThan(0);
    const lodash = findings.filter((f) => f.data.package === 'lodash');
    expect(lodash.length).toBeGreaterThan(0);
    expect(lodash[0]).toMatchObject({
      module: ScanModule.SupplyChain,
      tool: 'osv-scanner',
      filePath: 'package-lock.json',
    });
    expect(findings.some((f) => f.filePath === 'requirements.txt')).toBe(true);
  });

  it('prefers CVE ids and extracts fixed version', () => {
    const withCve = findings.filter((f) => f.ruleId.startsWith('CVE-'));
    expect(withCve.length).toBeGreaterThan(0);
    const lodash = findings.find(
      (f) => f.data.package === 'lodash' && f.data.fixedVersion,
    );
    expect(lodash?.action).toMatch(/^Обновите lodash до \d/);
  });

  it('produces unique fingerprints', () => {
    expect(allUnique(findings.map((f) => f.fingerprint))).toBe(true);
  });

  it('flags MAL-* advisories as critical malicious packages', () => {
    const raw = JSON.stringify({
      results: [
        {
          source: { path: '/repo/package-lock.json' },
          packages: [
            {
              package: { name: 'evil-pkg', version: '1.0.0', ecosystem: 'npm' },
              vulnerabilities: [
                { id: 'MAL-2024-1', summary: 'Malicious code' },
              ],
            },
          ],
        },
      ],
    });
    const [f] = parseOsv(WORKDIR, raw);
    expect(f.severity).toBe(Severity.Critical);
    expect(f.data.malicious).toBe(true);
  });
});

describe('trivy', () => {
  it('parses filesystem vulnerabilities', () => {
    const findings = parseTrivyVulns(WORKDIR, fixture('trivy-fs.json'));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.module === ScanModule.SupplyChain)).toBe(
      true,
    );
    expect(findings.some((f) => f.data.package === 'minimist')).toBe(true);
  });

  it('shares fingerprints with osv for the same CVE so they merge', () => {
    const osv = parseOsv(WORKDIR, fixture('osv.json'));
    const trivy = parseTrivyVulns(WORKDIR, fixture('trivy-fs.json'));
    const merged = mergeDuplicates([...osv, ...trivy]);
    expect(merged.length).toBeLessThan(osv.length + trivy.length);
    expect(merged.some((f) => (f.data.tools as string[]).length === 2)).toBe(
      true,
    );
  });

  it('parses misconfigurations and marks public exposure', () => {
    const findings = parseTrivyConfig(WORKDIR, fixture('trivy-config.json'));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.module === ScanModule.Infra)).toBe(true);
    expect(findings.some((f) => f.filePath === 'infra/main.tf')).toBe(true);
    expect(findings.some((f) => f.data.publicExposure === true)).toBe(true);
    expect(allUnique(findings.map((f) => f.fingerprint))).toBe(true);
  });
});

describe('gitleaks', () => {
  const findings = parseGitleaks(WORKDIR, fixture('gitleaks.json'));

  it('finds the token from git history and masks it', () => {
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.title).toBe('GitHub Personal Access Token в src/config.ts');
    expect(f).toMatchObject({
      ruleId: 'github-pat',
      filePath: 'src/config.ts',
      line: 1,
    });
    expect(f.data.masked).toBe(
      maskSecret('FAKE_TOKEN_FOR_TESTS_0123456789abcdef'),
    );
    expect(JSON.stringify(f.data)).not.toContain('FAKE_TOKEN_FOR_TESTS');
    expect(f.description).not.toContain('FAKE_TOKEN_FOR_TESTS');
    expect(f[RAW_SECRET]).toBe('FAKE_TOKEN_FOR_TESTS_0123456789abcdef');
  });

  it('collapses the same secret across commits into one finding', () => {
    const leaks = JSON.parse(fixture('gitleaks.json')) as Record<
      string,
      unknown
    >[];
    const twice = [
      ...leaks,
      {
        ...leaks[0],
        Commit: 'abc',
        File: 'other.ts',
        Date: '2020-01-01T00:00:00Z',
      },
    ];
    const [f] = parseGitleaks(WORKDIR, JSON.stringify(twice));
    expect(f.data.occurrences).toBe(2);
    expect(f.filePath).toBe('other.ts'); // самое раннее появление
  });

  it('handles empty report', () => {
    expect(parseGitleaks(WORKDIR, '[]')).toEqual([]);
  });
});

describe('semgrep', () => {
  it('maps severities and uses source lines for fingerprints', () => {
    const reader = jest.fn(
      (file: string, start: number) => `${file}:${start}:code`,
    );
    const findings = parseSemgrep(WORKDIR, fixture('semgrep.json'), reader);
    expect(findings.length).toBeGreaterThan(0);
    expect(reader).toHaveBeenCalled();
    expect(
      findings.some((f) => /tainted-sql-string|sql-injection/.test(f.ruleId)),
    ).toBe(true);
    expect(
      findings.some(
        (f) => f.severity === Severity.High || f.severity === Severity.Critical,
      ),
    ).toBe(true);
    expect(findings.every((f) => f.data.snippet !== 'requires login')).toBe(
      true,
    );
  });

  it('keeps fingerprint stable when code moves to another line', () => {
    const raw = (line: number) =>
      JSON.stringify({
        results: [
          {
            check_id: 'r.sqli',
            path: 'a.py',
            start: { line },
            end: { line },
            extra: { message: 'm', severity: 'ERROR', lines: 'requires login' },
          },
        ],
      });
    const reader = () => 'cursor.execute(q % x)';
    const [a] = parseSemgrep(WORKDIR, raw(10), reader);
    const [b] = parseSemgrep(WORKDIR, raw(42), reader);
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});

describe('checkov', () => {
  it('parses array output for multiple frameworks', () => {
    const findings = parseCheckov(WORKDIR, fixture('checkov.json'));
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some((f) => f.filePath === 'infra/main.tf')).toBe(true);
    expect(findings.some((f) => f.filePath === 'Dockerfile')).toBe(true);
    expect(findings.some((f) => f.severity === Severity.High)).toBe(true);
  });

  it('handles summary-only output when there is no IaC', () => {
    expect(parseCheckov(WORKDIR, '{"passed":0,"failed":0}')).toEqual([]);
  });
});
