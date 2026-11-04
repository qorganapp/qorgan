import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertBranchName, commitAndPush, workingDiffStat } from './git';

describe('git helpers', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'git-'));
    const g = (...args: string[]) => execFileSync('git', ['-C', dir, ...args]);
    g('init', '-q', '-b', 'main');
    await writeFile(join(dir, 'a.txt'), 'one\n');
    g('add', '-A');
    g('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('reports modified and new files in the working copy', async () => {
    await writeFile(join(dir, 'a.txt'), 'one\ntwo\n');
    await writeFile(join(dir, 'b.txt'), 'new\n');
    const stat = await workingDiffStat(dir);
    expect(stat.files.map((f) => f.path).sort()).toEqual(['a.txt', 'b.txt']);
    expect(stat.totalChanged).toBe(2);
  });

  it('refuses to push to the base branch or to suspicious branch names', async () => {
    await expect(
      commitAndPush({
        dir,
        branch: 'main',
        baseBranch: 'main',
        message: 'x',
        authorName: 'b',
        authorEmail: 'b@b',
        token: 't',
      }),
    ).rejects.toThrow('base branch');
    expect(() => assertBranchName('--upload-pack=evil')).toThrow();
    expect(() => assertBranchName('qorgan/../main')).toThrow();
    expect(() => assertBranchName('qorgan/fix-lodash-1234')).not.toThrow();
  });
});
