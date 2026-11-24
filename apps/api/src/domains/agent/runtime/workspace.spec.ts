import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Workspace } from './workspace';

describe('Workspace', () => {
  let root: string;
  let outside: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ws-'));
    outside = await mkdtemp(join(tmpdir(), 'outside-'));
    await writeFile(join(outside, 'secret.txt'), 'TOP SECRET');
    await mkdir(join(root, 'src'));
    await mkdir(join(root, '.git'));
    await writeFile(join(root, '.git', 'config'), '[core]');
    await writeFile(
      join(root, 'src', 'app.py'),
      'import os\nquery = "SELECT * FROM users WHERE id=%s" % uid\nprint(1)\n',
    );
    await symlink(join(outside, 'secret.txt'), join(root, 'leak.txt'));
    await symlink(outside, join(root, 'outdir'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it('reads files with line numbers and searches code', async () => {
    const ws = new Workspace(root);
    expect(await ws.readLines('src/app.py', 2, 2)).toContain(
      '    2  query = "SELECT',
    );
    expect(await ws.search('select *')).toContain('src/app.py:2:');
    expect(await ws.listFiles()).toEqual(['src/app.py']);
  });

  it.each([
    '../etc/passwd',
    '/etc/passwd',
    '.git/config',
    'src/../../x',
    'leak.txt',
    'outdir/secret.txt',
  ])('refuses to read %s', async (path) => {
    await expect(new Workspace(root).readLines(path)).rejects.toThrow(
      /not allowed|Symlinks|not found/,
    );
  });

  it('refuses writes when read-only and through symlinked directories', async () => {
    await expect(
      new Workspace(root).edit('src/app.py', 'print(1)', 'x'),
    ).rejects.toThrow('read-only');
    const ws = new Workspace(root, true);
    await expect(ws.create('outdir/new.txt', 'x')).rejects.toThrow(
      /not allowed|Symlinks/,
    );
    expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe(
      'TOP SECRET',
    );
  });

  it('edits only unique matches', async () => {
    const ws = new Workspace(root, true);
    await expect(ws.edit('src/app.py', 'zzz', 'x')).rejects.toThrow('found 0');
    await ws.edit('src/app.py', 'print(1)', 'print(2)');
    expect(await readFile(join(root, 'src/app.py'), 'utf8')).toContain(
      'print(2)',
    );
  });

  it('redacts known secret values from reads and search results', async () => {
    await writeFile(
      join(root, 'src', 'config.ts'),
      'export const token = "ghp_abcdefSECRET123";\n',
    );
    const ws = new Workspace(root, false, ['ghp_abcdefSECRET123']);
    expect(await ws.readLines('src/config.ts')).not.toContain(
      'ghp_abcdefSECRET123',
    );
    expect(await ws.search('token')).toContain('[REDACTED SECRET]');
  });
});
