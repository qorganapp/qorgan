import type { Dirent } from 'node:fs';
import {
  lstat,
  readdir,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ToolInputError } from './agent-tool';

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
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_READ_LINES = 400;
const MAX_SEARCH_HITS = 80;

/**
 * Доступ агента к клону репозитория. Все пути — недоверенный вывод модели:
 * только внутри корня, без `..`, абсолютных путей, симлинков и каталога .git.
 */
export class Workspace {
  constructor(
    readonly root: string,
    private readonly writable = false,
    /** Известные значения секретов: в тексте для модели заменяются маской — к LLM не уходят. */
    private readonly secrets: string[] = [],
  ) {}

  private redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) {
      if (secret.length >= 6) out = out.split(secret).join('[REDACTED SECRET]');
    }
    return out;
  }

  async resolvePath(path: string): Promise<string> {
    const clean = path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (
      !clean ||
      isAbsolute(clean) ||
      clean.split('/').some((p) => p === '..' || p === '.git')
    ) {
      throw new ToolInputError(`Path not allowed: ${path}`);
    }
    const target = resolve(this.root, clean);
    const rel = relative(this.root, target);
    if (rel.startsWith('..') || isAbsolute(rel))
      throw new ToolInputError(`Path not allowed: ${path}`);
    // Реальный путь ближайшего существующего предка (для новых файлов — их каталога) должен
    // оставаться внутри корня: симлинк-каталог в репозитории не уведёт чтение или запись наружу.
    const realRoot = await realpath(this.root);
    let probe = target;
    for (;;) {
      const info = await lstat(probe).catch(() => null);
      if (info) {
        if (info.isSymbolicLink())
          throw new ToolInputError(`Symlinks are not followed: ${path}`);
        const real = await realpath(probe);
        if (real !== realRoot && !real.startsWith(realRoot + sep)) {
          throw new ToolInputError(`Path not allowed: ${path}`);
        }
        break;
      }
      const parent = dirname(probe);
      if (parent === probe)
        throw new ToolInputError(`Path not allowed: ${path}`);
      probe = parent;
    }
    return target;
  }

  async listFiles(dir = '.', limit = 300): Promise<string[]> {
    const start =
      dir === '.' || dir === '' ? this.root : await this.resolvePath(dir);
    const out: string[] = [];
    const walk = async (abs: string, depth: number): Promise<void> => {
      if (out.length >= limit || depth > 8) return;
      let entries: Dirent[];
      try {
        entries = await readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (out.length >= limit) return;
        if (e.isSymbolicLink()) continue;
        const full = join(abs, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) await walk(full, depth + 1);
        } else if (e.isFile()) {
          out.push(relative(this.root, full));
        }
      }
    };
    await walk(start, 0);
    return out;
  }

  async readLines(
    path: string,
    startLine = 1,
    endLine?: number,
  ): Promise<string> {
    const abs = await this.resolvePath(path);
    const info = await lstat(abs).catch(() => null);
    if (!info?.isFile()) throw new ToolInputError(`File not found: ${path}`);
    if (info.size > MAX_FILE_BYTES)
      throw new ToolInputError(`File too large to read: ${path}`);
    const lines = (await readFile(abs, 'utf8')).split('\n');
    const from = Math.max(1, startLine);
    const to = Math.min(
      lines.length,
      endLine ?? from + MAX_READ_LINES - 1,
      from + MAX_READ_LINES - 1,
    );
    const body = lines
      .slice(from - 1, to)
      .map((l, i) => `${String(from + i).padStart(5)}  ${l}`)
      .join('\n');
    const more =
      to < lines.length
        ? `\n… (${lines.length - to} more lines, file has ${lines.length})`
        : '';
    return this.redact(
      `${path} (lines ${from}-${to} of ${lines.length})\n${body}${more}`,
    );
  }

  /** Поиск по коду. По умолчанию — подстрока без учёта регистра (без риска ReDoS). */
  async search(
    query: string,
    opts: { regex?: boolean; pathPrefix?: string } = {},
  ): Promise<string> {
    let test: (line: string) => boolean;
    if (opts.regex) {
      let re: RegExp;
      try {
        re = new RegExp(query, 'i');
      } catch {
        throw new ToolInputError('Invalid regular expression');
      }
      test = (line) => line.length <= 2000 && re.test(line);
    } else {
      const needle = query.toLowerCase();
      test = (line) => line.toLowerCase().includes(needle);
    }
    const files = await this.listFiles(opts.pathPrefix ?? '.', 5000);
    const hits: string[] = [];
    for (const file of files) {
      if (hits.length >= MAX_SEARCH_HITS) break;
      const abs = join(this.root, file);
      const info = await lstat(abs).catch(() => null);
      if (!info || info.size > MAX_FILE_BYTES) continue;
      const text = await readFile(abs, 'utf8').catch(() => '');
      if (text.includes('\u0000')) continue; // бинарный файл
      text.split('\n').forEach((line, i) => {
        if (hits.length < MAX_SEARCH_HITS && test(line))
          hits.push(`${file}:${i + 1}: ${line.trim().slice(0, 240)}`);
      });
    }
    return hits.length
      ? this.redact(hits.join('\n')) +
          (hits.length >= MAX_SEARCH_HITS ? '\n… (more results truncated)' : '')
      : 'No matches';
  }

  /**
   * CI, секреты репозитория и настройки GitHub агент не меняет никогда: prompt injection в коде
   * не должен суметь подсунуть изменение пайплайна под видом «фикса».
   */
  private assertWritable(path: string): void {
    if (!this.writable) throw new ToolInputError('Workspace is read-only');
    const clean = path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (
      /^\.(github|gitlab|circleci)\//i.test(clean) ||
      /(^|\/)\.gitmodules$/.test(clean)
    ) {
      throw new ToolInputError(`Editing ${path} is not allowed for the agent`);
    }
  }

  /** Точечная правка: old должен встречаться ровно один раз. */
  async edit(path: string, oldText: string, newText: string): Promise<string> {
    this.assertWritable(path);
    const abs = await this.resolvePath(path);
    const before = await readFile(abs, 'utf8').catch(() => {
      throw new ToolInputError(`File not found: ${path}`);
    });
    const count = before.split(oldText).length - 1;
    if (count !== 1) {
      throw new ToolInputError(
        `old_text must occur exactly once in ${path} (found ${count})`,
      );
    }
    await writeFile(
      abs,
      before.replace(oldText, () => newText),
    );
    return `Edited ${path}`;
  }

  async create(path: string, content: string): Promise<string> {
    this.assertWritable(path);
    const abs = await this.resolvePath(path);
    if (await lstat(abs).catch(() => null))
      throw new ToolInputError(`File already exists: ${path}`);
    await writeFile(abs, content);
    return `Created ${path}`;
  }
}
