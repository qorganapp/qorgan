import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import {
  npmDependencies,
  pythonRequirements,
} from '../../scanner/adapters/typosquat.adapter';
import { Ecosystem, ManifestEntry, RepoManifest } from './graph.types';

const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'vendor',
  '.venv',
  'venv',
  'dist',
  'build',
  '.next',
  'coverage',
]);
const MAX_DEPTH = 6;
const MAX_MANIFESTS = 400;
const MAX_MANIFEST_BYTES = 1024 * 1024;

/** PEP 503: имена пакетов PyPI сравниваются без учёта регистра и разделителей. */
export function normalizeName(name: string, ecosystem: Ecosystem): string {
  return ecosystem === 'pypi'
    ? name.toLowerCase().replace(/[-_.]+/g, '-')
    : name.toLowerCase();
}

export const packageKey = (e: { name: string; ecosystem: Ecosystem }) =>
  `${e.ecosystem}:${normalizeName(e.name, e.ecosystem)}`;

function npmPackageName(packageJson: string): string | null {
  try {
    const name = (JSON.parse(packageJson) as { name?: unknown }).name;
    return typeof name === 'string' && name.trim() ? name.trim() : null;
  } catch {
    return null;
  }
}

/** Имя из `[project]` или `[tool.poetry]` в pyproject.toml — без полноценного разбора TOML. */
export function pyprojectName(text: string): string | null {
  let section = '';
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    if (section !== 'project' && section !== 'tool.poetry') continue;
    const name = line.match(/^name\s*=\s*["']([^"']+)["']/);
    if (name) return name[1];
  }
  return null;
}

async function* walk(dir: string, depth = 0): AsyncGenerator<string> {
  if (depth > MAX_DEPTH) return;
  let entries: Dirent[];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.isDirectory() && !SKIP_DIRS.has(e.name))
      yield* walk(join(dir, e.name), depth + 1);
    else if (
      e.isFile() &&
      (e.name === 'package.json' ||
        e.name === 'pyproject.toml' ||
        /^requirements.*\.txt$/.test(e.name))
    )
      yield join(dir, e.name);
  }
}

/**
 * Что репозиторий публикует и от чего зависит — по манифестам npm и Python.
 * Содержимое манифестов недоверенное: читаем только имена, ничего не исполняем.
 */
export async function extractManifest(root: string): Promise<RepoManifest> {
  const packages = new Map<string, ManifestEntry>();
  const dependencies = new Map<string, ManifestEntry>();
  const add = (
    into: Map<string, ManifestEntry>,
    name: string,
    ecosystem: Ecosystem,
    filePath: string,
  ) => {
    const key = packageKey({ name, ecosystem });
    if (!into.has(key)) into.set(key, { name, ecosystem, filePath });
  };

  let seen = 0;
  for await (const file of walk(root)) {
    if (++seen > MAX_MANIFESTS) break;
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }
    if (text.length > MAX_MANIFEST_BYTES) continue;
    const filePath = relative(root, file);
    if (file.endsWith('package.json')) {
      const name = npmPackageName(text);
      if (name) add(packages, name, 'npm', filePath);
      for (const dep of npmDependencies(text))
        add(dependencies, dep, 'npm', filePath);
    } else if (file.endsWith('pyproject.toml')) {
      const name = pyprojectName(text);
      if (name) add(packages, name, 'pypi', filePath);
    } else {
      for (const dep of pythonRequirements(text))
        add(dependencies, dep, 'pypi', filePath);
    }
  }
  return {
    packages: [...packages.values()],
    dependencies: [...dependencies.values()],
  };
}
