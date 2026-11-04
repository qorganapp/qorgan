import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ScanModule, Severity } from '../../../common/security.types';
import { fingerprint } from '../../findings/fingerprint';
import { NormalizedFinding, ScanContext, ScannerAdapter } from './types';
import { POPULAR_NPM, POPULAR_PYPI } from './popular-packages';

type Ecosystem = 'npm' | 'PyPI';

/** Расстояние Дамерау–Левенштейна (вариант OSA: перестановка соседних символов = 1 правка). */
export function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) =>
      i === 0 ? j : j === 0 ? i : 0,
    ),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

/** PEP 503: Foo_Bar.baz == foo-bar-baz */
const normalizePypi = (name: string) =>
  name.toLowerCase().replace(/[-_.]+/g, '-');

const POPULAR: Record<Ecosystem, Set<string>> = {
  npm: new Set(POPULAR_NPM),
  PyPI: new Set(POPULAR_PYPI.map(normalizePypi)),
};

export function findLookalike(
  name: string,
  ecosystem: Ecosystem,
): string | null {
  const normalized =
    ecosystem === 'PyPI' ? normalizePypi(name) : name.toLowerCase();
  // Скоупы (@org/pkg) принадлежат организации, коротким именам слишком легко совпасть случайно.
  if (normalized.startsWith('@') || normalized.length < 4) return null;
  const popular = POPULAR[ecosystem];
  if (popular.has(normalized)) return null;
  for (const target of popular) {
    if (Math.abs(target.length - normalized.length) > 1) continue;
    if (editDistance(normalized, target) === 1) return target;
  }
  return null;
}

export function npmDependencies(packageJson: string): string[] {
  try {
    const pkg = JSON.parse(packageJson) as Record<
      string,
      Record<string, string> | undefined
    >;
    return [
      ...Object.keys(pkg.dependencies ?? {}),
      ...Object.keys(pkg.devDependencies ?? {}),
      ...Object.keys(pkg.optionalDependencies ?? {}),
    ];
  } catch {
    return [];
  }
}

export function pythonRequirements(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/#.*/, '').trim())
    .filter((l) => l && !l.startsWith('-'))
    .map((l) => l.match(/^[A-Za-z0-9][A-Za-z0-9._-]*/)?.[0])
    .filter((n): n is string => !!n);
}

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  'dist',
  'build',
]);

async function* manifests(dir: string, depth = 0): AsyncGenerator<string> {
  if (depth > 6) return;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name))
      yield* manifests(join(dir, e.name), depth + 1);
    else if (
      e.isFile() &&
      (e.name === 'package.json' || /^requirements.*\.txt$/.test(e.name))
    )
      yield join(dir, e.name);
  }
}

export class TyposquatAdapter implements ScannerAdapter {
  readonly module = ScanModule.SupplyChain;
  readonly tool = 'typosquat';

  async run({ workdir }: ScanContext): Promise<NormalizedFinding[]> {
    const findings: NormalizedFinding[] = [];
    for await (const path of manifests(workdir)) {
      const file = relative(workdir, path);
      const ecosystem: Ecosystem = path.endsWith('package.json')
        ? 'npm'
        : 'PyPI';
      const text = await readFile(path, 'utf8');
      const names =
        ecosystem === 'npm' ? npmDependencies(text) : pythonRequirements(text);
      for (const name of new Set(names)) {
        const target = findLookalike(name, ecosystem);
        if (!target) continue;
        findings.push({
          module: ScanModule.SupplyChain,
          tool: this.tool,
          ruleId: 'typosquat',
          severity: Severity.Medium,
          title: `Possible typosquat: "${name}" looks like "${target}"`,
          description: `Package ${name} is one character away from the popular ${target}. Attackers publish such packages hoping for a typo.`,
          filePath: file,
          line: null,
          fingerprint: fingerprint('supply_chain', 'typosquat', file, name),
          data: { package: name, lookalikeOf: target, ecosystem },
          action: `Make sure you really meant "${name}" and not "${target}"`,
        });
      }
    }
    return findings;
  }
}
