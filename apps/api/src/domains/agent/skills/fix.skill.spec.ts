import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Severity } from '../../../common/security.types';
import { FakeProvider } from '../llm/fake.provider';
import { Workspace } from '../runtime/workspace';
import { FixTarget, runFix, VerifyResult } from './fix.skill';

const target: FixTarget = {
  id: 'f-1',
  module: 'supply_chain',
  tool: 'osv-scanner',
  ruleId: 'CVE-2021-23337',
  severity: Severity.High,
  title: 'lodash@4.17.15: Command Injection',
  description: 'template injection',
  filePath: 'package-lock.json',
  line: null,
  data: { package: 'lodash', version: '4.17.15', fixedVersion: '4.17.21' },
  fingerprint: 'fp-1',
  fixHint: 'Upgrade lodash to 4.17.21',
};

const call = (name: string, input: unknown = {}) => ({
  toolCalls: [{ id: name, name, input }],
});
const results = (p: FakeProvider, i: number) =>
  p.sessions[0].inputs[i] as { content: string; isError?: boolean }[];

describe('runFix', () => {
  let dir: string;
  const pass: VerifyResult = { stillPresent: [], introduced: [] };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'fix-'));
    await writeFile(
      join(dir, 'package.json'),
      '{"dependencies":{"lodash":"4.17.15"}}\n',
    );
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('edits, regenerates the lockfile, verifies and submits', async () => {
    const lock = jest.fn(() =>
      Promise.resolve('Regenerated package-lock.json'),
    );
    const provider = new FakeProvider([
      call('edit_file', {
        path: 'package.json',
        old_text: '"4.17.15"',
        new_text: '"4.17.21"',
      }),
      call('update_lockfile', { manifest_path: 'package.json' }),
      call('verify_fix'),
      call('submit_fix', {
        title: 'Upgrade lodash to 4.17.21',
        summary: 'Fixes CVE-2021-23337 (command injection).',
      }),
    ]);
    const out = await runFix({
      provider,
      workspace: new Workspace(dir, true),
      targets: [target],
      verify: () => Promise.resolve(pass),
      updateLockfile: lock,
    });
    expect(out.submission?.title).toBe('Upgrade lodash to 4.17.21');
    expect(lock).toHaveBeenCalledWith('package.json');
    expect(await readFile(join(dir, 'package.json'), 'utf8')).toContain(
      '4.17.21',
    );
    expect(results(provider, 3)[0].content).toContain('PASSED');
  });

  it('refuses to submit before verification or after further edits', async () => {
    const provider = new FakeProvider([
      call('submit_fix', {
        title: 'Upgrade lodash now',
        summary: 'Upgrade lodash to fix the CVE.',
      }),
      call('verify_fix'),
      call('edit_file', {
        path: 'package.json',
        old_text: '"4.17.15"',
        new_text: '"4.17.21"',
      }),
      call('submit_fix', {
        title: 'Upgrade lodash now',
        summary: 'Upgrade lodash to fix the CVE.',
      }),
      { text: 'giving up' },
    ]);
    const out = await runFix({
      provider,
      workspace: new Workspace(dir, true),
      targets: [target],
      verify: () => Promise.resolve(pass),
      updateLockfile: () => Promise.resolve('ok'),
    });
    expect(out.submission).toBeNull();
    expect(results(provider, 1)[0].content).toContain('Cannot submit yet');
    expect(results(provider, 4)[0].content).toContain('Cannot submit yet');
  });

  it('does not pass verification when the issue remains or new high findings appear', async () => {
    const verify = jest
      .fn<Promise<VerifyResult>, []>()
      .mockResolvedValueOnce({
        stillPresent: ['lodash@4.17.15'],
        introduced: [],
      })
      .mockResolvedValueOnce({
        stillPresent: [],
        introduced: [
          {
            title: 'lodash@4.17.20: ReDoS',
            severity: 'high',
            filePath: 'package-lock.json',
          },
        ],
      });
    const provider = new FakeProvider([
      call('verify_fix'),
      call('verify_fix'),
      call('abandon_fix', { reason: 'No safe version available yet.' }),
    ]);
    const out = await runFix({
      provider,
      workspace: new Workspace(dir, true),
      targets: [target],
      verify,
      updateLockfile: () => Promise.resolve('ok'),
    });
    expect(results(provider, 1)[0].content).toContain('Still reported');
    expect(results(provider, 2)[0].content).toContain(
      'New findings introduced',
    );
    expect(out).toMatchObject({
      submission: null,
      abandoned: 'No safe version available yet.',
    });
  });

  it('cannot edit CI configuration', async () => {
    const provider = new FakeProvider([
      call('create_file', {
        path: '.github/workflows/x.yml',
        content: 'on: push',
      }),
      { text: 'ok' },
    ]);
    await runFix({
      provider,
      workspace: new Workspace(dir, true),
      targets: [target],
      verify: () => Promise.resolve(pass),
      updateLockfile: () => Promise.resolve('ok'),
    });
    const [result] = results(provider, 1);
    expect(result.isError).toBe(true);
    expect(result.content).toContain('not allowed');
  });
});
