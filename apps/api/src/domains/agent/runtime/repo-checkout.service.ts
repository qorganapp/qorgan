import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GithubAppService } from '../../github/github-app.service';
import { GitRepository } from '../../repositories/git-repository.entity';
import { parseGitleaks } from '../../scanner/adapters/gitleaks.adapter';
import { RAW_SECRET } from '../../scanner/adapters/types';
import { cloneRepository, git } from '../../scanner/git';
import { runTool } from '../../scanner/run-tool';

export interface Checkout {
  workdir: string;
  /** Значения секретов в текущем коде — для маскирования перед отправкой в модель. */
  secrets: string[];
}

/** Клоны, занятые одним запуском агента; `close()` отпускает их для вытеснения. */
export interface CheckoutSession {
  get(repo: GitRepository): Promise<Checkout>;
  close(): void;
}

interface Entry {
  checkout: Checkout | null;
  users: number;
  lastUsed: number;
  /** Очередь операций над каталогом: fetch/reset двух запусков не должны пересекаться. */
  queue: Promise<unknown>;
}

/**
 * Кеш клонов default-веток для чтения кода агентом (чат, карта связей).
 * Клон делается лениво, при первом обращении; агент пространства трогает
 * только те репозитории, которые нужны для ответа.
 */
@Injectable()
export class RepoCheckoutService {
  private readonly logger = new Logger(RepoCheckoutService.name);
  private readonly cacheRoot = join(tmpdir(), 'qorgan-chat');
  private readonly timeoutMs: number;
  private readonly maxCached: number;
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly github: GithubAppService,
    config: ConfigService,
  ) {
    this.timeoutMs = Number(config.get('SCAN_TIMEOUT_MS', 15 * 60_000));
    // tmpfs воркера ограничен несколькими гигабайтами: держим не больше N клонов.
    this.maxCached = Math.max(1, Number(config.get('AGENT_REPO_CACHE_MAX', 8)));
  }

  session(): CheckoutSession {
    const held = new Map<string, Promise<Checkout>>();
    return {
      get: (repo) => {
        let checkout = held.get(repo.id);
        if (!checkout) {
          checkout = this.acquire(repo);
          held.set(repo.id, checkout);
          // Неудачный клон не должен «залипнуть»: следующий вызов попробует снова.
          checkout.catch(() => held.delete(repo.id));
        }
        return checkout;
      },
      close: () => {
        for (const id of held.keys()) {
          const entry = this.entries.get(id);
          if (entry) entry.users = Math.max(0, entry.users - 1);
        }
        held.clear();
      },
    };
  }

  private acquire(repo: GitRepository): Promise<Checkout> {
    const entry = this.entries.get(repo.id) ?? {
      checkout: null,
      users: 0,
      lastUsed: 0,
      queue: Promise.resolve(),
    };
    this.entries.set(repo.id, entry);
    entry.users += 1;
    entry.lastUsed = Date.now();

    const task = entry.queue.then(async () => {
      // Пока клоном пользуется другой запуск, не переписываем файлы у него под руками.
      if (entry.checkout && entry.users > 1) return entry.checkout;
      entry.checkout = await this.refresh(repo);
      await this.evict();
      return entry.checkout;
    });
    entry.queue = task.catch(() => undefined);
    return task.catch((e) => {
      entry.users = Math.max(0, entry.users - 1);
      throw e;
    });
  }

  private async refresh(repo: GitRepository): Promise<Checkout> {
    const workdir = join(this.cacheRoot, repo.id);
    const token = await this.github.installationToken(
      repo.installation.githubInstallationId,
    );
    const cloned = await access(join(workdir, '.git')).then(
      () => true,
      () => false,
    );
    if (cloned) {
      await git(workdir, ['fetch', '--quiet', 'origin', repo.defaultBranch], {
        token,
        timeoutMs: this.timeoutMs,
      });
      await git(workdir, ['reset', '--quiet', '--hard', 'FETCH_HEAD']);
      await git(workdir, ['clean', '-qfdx']);
    } else {
      await mkdir(this.cacheRoot, { recursive: true });
      await rm(workdir, { recursive: true, force: true });
      await cloneRepository({
        fullName: repo.fullName,
        branch: repo.defaultBranch,
        token,
        dir: workdir,
        timeoutMs: this.timeoutMs,
      });
    }

    const reportDir = await mkdtemp(join(tmpdir(), 'qorgan-chat-report-'));
    try {
      const report = join(reportDir, 'gitleaks.json');
      await runTool(
        'gitleaks',
        [
          'dir',
          workdir,
          '--report-format',
          'json',
          '--report-path',
          report,
          '--exit-code',
          '0',
          '--no-banner',
          '--log-level',
          'error',
        ],
        { timeoutMs: this.timeoutMs },
      );
      const secrets = parseGitleaks(workdir, await readFile(report, 'utf8'))
        .map((f) => f[RAW_SECRET])
        .filter((v): v is string => !!v);
      return { workdir, secrets };
    } catch (e) {
      // Без проверки на секреты код в модель не отдаём.
      throw new Error(`Secret pre-scan failed: ${(e as Error).message}`);
    } finally {
      await rm(reportDir, { recursive: true, force: true });
    }
  }

  /** Удаляет давно не использованные клоны сверх лимита; занятые не трогает. */
  private async evict(): Promise<void> {
    const dirs = await readdir(this.cacheRoot).catch(() => [] as string[]);
    const excess = dirs.length - this.maxCached;
    if (excess <= 0) return;
    const idle = dirs
      .map((id) => ({ id, entry: this.entries.get(id) }))
      .filter(({ entry }) => !entry || entry.users === 0)
      .sort((a, b) => (a.entry?.lastUsed ?? 0) - (b.entry?.lastUsed ?? 0))
      .slice(0, excess);
    for (const { id } of idle) {
      await rm(join(this.cacheRoot, id), { recursive: true, force: true });
      this.entries.delete(id);
      this.logger.log(`Evicted cached clone ${id}`);
    }
  }
}
