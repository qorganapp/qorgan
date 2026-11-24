import { ScanModule, Severity } from '../../common/security.types';
import { priorityScore } from './priority';
import { buildFixNow, SummaryFinding } from './summary';

const f = (over: Partial<SummaryFinding> & { id: string }): SummaryFinding => {
  const base = {
    module: ScanModule.CodeAudit,
    severity: Severity.Medium,
    title: over.id,
    action: `fix ${over.id}`,
    filePath: 'src/app.ts',
    line: null,
    data: {},
    ...over,
  };
  return { ...base, priorityScore: over.priorityScore ?? priorityScore(base) };
};

describe('priorityScore', () => {
  it('puts malicious packages above everything', () => {
    expect(
      priorityScore(
        f({
          id: 'a',
          module: ScanModule.SupplyChain,
          severity: Severity.Low,
          data: { malicious: true },
        }),
      ),
    ).toBe(1000);
  });

  it('boosts live secrets and discounts revoked ones', () => {
    const base = {
      id: 's',
      module: ScanModule.Secrets,
      severity: Severity.High,
    };
    const live = priorityScore(f({ ...base, data: { validity: 'live' } }));
    const unknown = priorityScore(
      f({ ...base, data: { validity: 'unknown' } }),
    );
    const revoked = priorityScore(
      f({ ...base, data: { validity: 'revoked' } }),
    );
    expect(live).toBeGreaterThan(unknown);
    expect(unknown).toBeGreaterThan(revoked);
  });

  it('discounts test code but not secrets in tests', () => {
    const prod = priorityScore(f({ id: 'p', severity: Severity.High }));
    const test = priorityScore(
      f({ id: 't', severity: Severity.High, filePath: 'test/app.spec.ts' }),
    );
    expect(test).toBeLessThan(prod);
    const secret = (filePath: string) =>
      priorityScore(
        f({
          id: 's',
          module: ScanModule.Secrets,
          severity: Severity.High,
          filePath,
        }),
      );
    expect(secret('test/fixtures/key.pem')).toBe(secret('src/key.pem'));
  });

  it('boosts publicly exposed infrastructure', () => {
    const base = { id: 'i', module: ScanModule.Infra, severity: Severity.High };
    expect(
      priorityScore(f({ ...base, data: { publicExposure: true } })),
    ).toBeGreaterThan(
      priorityScore(f({ ...base, data: { publicExposure: false } })),
    );
  });
});

describe('buildFixNow', () => {
  it('groups many CVEs of one package into a single upgrade action', () => {
    const vulns = ['1', '2', '3'].map((n, i) =>
      f({
        id: `cve${n}`,
        module: ScanModule.SupplyChain,
        severity: i === 0 ? Severity.Critical : Severity.High,
        filePath: 'package-lock.json',
        data: {
          package: 'lodash',
          version: '4.17.15',
          vulnId: `CVE-${n}`,
          fixedVersion: ['4.17.19', '4.17.21', '4.17.16'][i],
        },
      }),
    );
    const items = buildFixNow([
      ...vulns,
      f({ id: 'x', severity: Severity.Low }),
    ]);
    expect(items[0]).toMatchObject({
      severity: Severity.Critical,
      findingIds: ['cve1', 'cve2', 'cve3'],
    });
    expect(items[0].action).toContain('4.17.21');
    expect(items).toHaveLength(2);
  });

  it('limits to 6 items ordered by score', () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      f({ id: `f${i}`, priorityScore: i }),
    );
    const items = buildFixNow(many);
    expect(items).toHaveLength(6);
    expect(items.map((i) => i.findingIds[0])).toEqual([
      'f9',
      'f8',
      'f7',
      'f6',
      'f5',
      'f4',
    ]);
  });

  it('does not let one module take the whole list', () => {
    const infra = Array.from({ length: 6 }, (_, i) =>
      f({ id: `i${i}`, module: ScanModule.Infra, priorityScore: 100 - i }),
    );
    const secret = f({
      id: 's',
      module: ScanModule.Secrets,
      priorityScore: 10,
    });
    const items = buildFixNow([...infra, secret]);
    expect(items.map((i) => i.findingIds[0])).toContain('s');
    expect(items).toHaveLength(6);
  });

  it('groups infra problems by resource and code findings by line', () => {
    const items = buildFixNow([
      f({
        id: 'a',
        module: ScanModule.Infra,
        filePath: 'main.tf',
        data: { resource: 'aws_s3_bucket.x' },
      }),
      f({
        id: 'b',
        module: ScanModule.Infra,
        filePath: 'main.tf',
        data: { resource: 'aws_s3_bucket.x' },
      }),
      f({ id: 'c', line: 9, filePath: 'app.py' }),
      f({ id: 'd', line: 9, filePath: 'app.py' }),
      f({ id: 'e', line: 12, filePath: 'app.py' }),
    ]);
    expect(items).toHaveLength(3);
    expect(
      items.find((i) => i.module === ScanModule.Infra)?.findingIds,
    ).toHaveLength(2);
  });
});

describe('priorityScore with agent verdicts', () => {
  const base = {
    module: ScanModule.CodeAudit,
    severity: Severity.High,
    filePath: 'src/a.ts',
    data: {},
  };
  it('pushes confirmed reachable issues up and false positives down', () => {
    const plain = priorityScore(base);
    const confirmed = priorityScore({
      ...base,
      agentVerdict: {
        verdict: 'true_positive',
        reachable: 'yes',
        severity: Severity.High,
      },
    });
    const fp = priorityScore({
      ...base,
      agentVerdict: {
        verdict: 'false_positive',
        reachable: 'no',
        severity: Severity.Low,
      },
    });
    expect(confirmed).toBeGreaterThan(plain);
    expect(fp).toBeLessThan(plain / 10);
  });
  it('uses the severity the agent assessed for this repository', () => {
    const raised = priorityScore({
      ...base,
      agentVerdict: {
        verdict: 'true_positive',
        reachable: 'unknown',
        severity: Severity.Critical,
      },
    });
    expect(raised).toBeGreaterThan(priorityScore(base));
  });
});
