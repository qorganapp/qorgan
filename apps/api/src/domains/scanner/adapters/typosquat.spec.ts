import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  editDistance,
  findLookalike,
  pythonRequirements,
  TyposquatAdapter,
} from './typosquat.adapter';

describe('typosquat', () => {
  it('computes Damerau–Levenshtein with transpositions', () => {
    expect(editDistance('requests', 'reqeusts')).toBe(1);
    expect(editDistance('lodash', 'lodahs')).toBe(1);
    expect(editDistance('express', 'expres')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
  });

  it('flags lookalikes but not the popular packages themselves', () => {
    expect(findLookalike('reqeusts', 'PyPI')).toBe('requests');
    expect(findLookalike('expres', 'npm')).toBe('express');
    expect(findLookalike('express', 'npm')).toBeNull();
    expect(findLookalike('preact', 'npm')).toBeNull();
    expect(findLookalike('Python_Dateutil', 'PyPI')).toBeNull();
    expect(findLookalike('@scope/expres', 'npm')).toBeNull();
    expect(findLookalike('qs', 'npm')).toBeNull();
  });

  it('parses requirements files', () => {
    expect(
      pythonRequirements('# c\nflask==2.0\n-r other.txt\nreqeusts>=1 # x\n\n'),
    ).toEqual(['flask', 'reqeusts']);
  });

  it('scans manifests in a repository, skipping node_modules', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'typo-'));
    try {
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ dependencies: { expres: '1', lodash: '4' } }),
      );
      await writeFile(join(dir, 'requirements.txt'), 'reqeusts==2.0\n');
      await mkdir(join(dir, 'node_modules', 'x'), { recursive: true });
      await writeFile(
        join(dir, 'node_modules', 'x', 'package.json'),
        JSON.stringify({ dependencies: { lodahs: '1' } }),
      );

      const findings = await new TyposquatAdapter().run({
        workdir: dir,
        reportDir: dir,
        timeoutMs: 1000,
      });
      expect(findings.map((f) => f.data.package).sort()).toEqual([
        'expres',
        'reqeusts',
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
