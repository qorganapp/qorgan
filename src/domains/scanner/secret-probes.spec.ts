import { ScanModule, Severity } from '../../common/security.types';
import { RAW_SECRET, SecretFinding } from './adapters/types';
import { validateSecrets } from './secret-probes';

const finding = (ruleId: string): SecretFinding => ({
  module: ScanModule.Secrets,
  tool: 'gitleaks',
  ruleId,
  severity: Severity.High,
  title: 't',
  description: '',
  filePath: 'a.ts',
  line: 1,
  fingerprint: 'fp',
  data: { validity: 'unknown' },
  action: 'rotate',
  [RAW_SECRET]: 'ghp_secret',
});

const validator = (enabled: boolean) => ({
  validate: (fs: SecretFinding[]) => validateSecrets(fs, { enabled }),
});

describe('validateSecrets', () => {
  afterEach(() => jest.restoreAllMocks());

  it('always strips the raw secret, even when disabled', async () => {
    const f = finding('github-pat');
    const fetchSpy = jest.spyOn(global, 'fetch');
    await validator(false).validate([f]);
    expect(f[RAW_SECRET]).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('marks a live GitHub token as critical', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const f = finding('github-pat');
    await validator(true).validate([f]);
    expect(f.data.validity).toBe('live');
    expect(f.severity).toBe(Severity.Critical);
  });

  it('downgrades a revoked token', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('{}', { status: 401 }));
    const f = finding('github-pat');
    await validator(true).validate([f]);
    expect(f.data.validity).toBe('revoked');
    expect(f.severity).toBe(Severity.Low);
  });

  it('leaves unknown providers untouched', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const f = finding('aws-access-token');
    await validator(true).validate([f]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(f.data.validity).toBe('unknown');
  });
});
