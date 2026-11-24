import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractManifest, packageKey, pyprojectName } from './manifest-extract';

describe('extractManifest', () => {
  let dir: string;
  beforeEach(async () => (dir = await mkdtemp(join(tmpdir(), 'manifest-'))));
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('collects published packages and dependencies from npm and Python manifests', async () => {
    await mkdir(join(dir, 'packages', 'sdk'), { recursive: true });
    await mkdir(join(dir, 'node_modules', 'left-pad'), { recursive: true });
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        name: 'shop',
        dependencies: { express: '^4', '@acme/sdk': '1.0.0' },
        devDependencies: { vitest: '^1' },
      }),
    );
    await writeFile(
      join(dir, 'packages', 'sdk', 'package.json'),
      JSON.stringify({ name: '@acme/sdk', dependencies: { express: '^4' } }),
    );
    await writeFile(
      join(dir, 'node_modules', 'left-pad', 'package.json'),
      JSON.stringify({ name: 'left-pad' }),
    );
    await writeFile(
      join(dir, 'requirements.txt'),
      'Flask==2.0\n# comment\nrequests>=2\n',
    );
    await writeFile(
      join(dir, 'pyproject.toml'),
      '[project]\nname = "acme_worker"\n',
    );

    const manifest = await extractManifest(dir);
    expect(manifest.packages.map((p) => p.name).sort()).toEqual([
      '@acme/sdk',
      'acme_worker',
      'shop',
    ]);
    expect(manifest.dependencies.map(packageKey).sort()).toEqual([
      'npm:@acme/sdk',
      'npm:express',
      'npm:vitest',
      'pypi:flask',
      'pypi:requests',
    ]);
    expect(
      manifest.dependencies.find((d) => d.name === 'express')?.filePath,
    ).toBe('package.json');
  });

  it('survives broken manifests', async () => {
    await writeFile(join(dir, 'package.json'), '{ not json');
    expect(await extractManifest(dir)).toEqual({
      packages: [],
      dependencies: [],
    });
  });

  it('reads the project name only from the project sections of pyproject.toml', () => {
    expect(pyprojectName('[tool.poetry]\nname = "svc"\n')).toBe('svc');
    expect(pyprojectName('[tool.other]\nname = "nope"\n')).toBeNull();
    expect(packageKey({ name: 'Acme_Worker', ecosystem: 'pypi' })).toBe(
      'pypi:acme-worker',
    );
  });
});
