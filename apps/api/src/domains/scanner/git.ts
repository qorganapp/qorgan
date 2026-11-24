import { runTool } from './run-tool';

const FULL_NAME = /^[\w.-]+\/[\w.-]+$/;
const BRANCH = /^(?!-)[\w./-]+$/;
const SHA = /^[0-9a-f]{40}$/;

export interface CloneOptions {
  fullName: string;
  branch: string;
  commitSha?: string | null;
  token: string;
  dir: string;
  timeoutMs: number;
}

/**
 * Клонирует репозиторий с полной историей ветки (gitleaks ищет секреты по всем коммитам).
 * Токен передаётся через GIT_CONFIG_* env, а не в URL/argv, чтобы не светиться в `ps` и логах.
 * Возвращает фактический SHA HEAD.
 */
export async function cloneRepository(opts: CloneOptions): Promise<string> {
  if (!FULL_NAME.test(opts.fullName))
    throw new Error(`Bad repository name: ${opts.fullName}`);
  if (!BRANCH.test(opts.branch))
    throw new Error(`Bad branch name: ${opts.branch}`);
  if (opts.commitSha && !SHA.test(opts.commitSha))
    throw new Error('Bad commit sha');

  const basic = Buffer.from(`x-access-token:${opts.token}`).toString('base64');
  const env = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
  // Симлинки чекаутятся обычными файлами: иначе ссылка на /etc/passwd в репозитории
  // заставила бы сканеры прочитать файлы воркера. Хуки отключены.
  const hardening = [
    '-c',
    'core.symlinks=false',
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'protocol.file.allow=never',
  ];

  await runTool(
    'git',
    [
      ...hardening,
      'clone',
      '--quiet',
      '--single-branch',
      '--no-tags',
      '--branch',
      opts.branch,
      `https://github.com/${opts.fullName}.git`,
      opts.dir,
    ],
    { timeoutMs: opts.timeoutMs, env },
  );

  if (opts.commitSha) {
    await runTool(
      'git',
      [
        ...hardening,
        '-C',
        opts.dir,
        'checkout',
        '--quiet',
        '--detach',
        opts.commitSha,
      ],
      {
        timeoutMs: 60_000,
      },
    );
  }
  const { stdout } = await runTool(
    'git',
    ['-C', opts.dir, 'rev-parse', 'HEAD'],
    {
      timeoutMs: 30_000,
    },
  );
  return stdout.trim();
}

const HARDENING = [
  '-c',
  'core.symlinks=false',
  '-c',
  'core.hooksPath=/dev/null',
  '-c',
  'protocol.file.allow=never',
];

function authEnv(token?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_CONFIG_NOSYSTEM: '1',
  };
  if (token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    Object.assign(env, {
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    });
  }
  return env;
}

/** git в клоне с теми же защитами (без хуков и симлинков). Токен — только через env. */
export async function git(
  dir: string,
  args: string[],
  opts: { token?: string; timeoutMs?: number } = {},
): Promise<string> {
  const { stdout } = await runTool('git', [...HARDENING, '-C', dir, ...args], {
    timeoutMs: opts.timeoutMs ?? 120_000,
    env: authEnv(opts.token),
  });
  return stdout;
}

export function assertBranchName(branch: string): void {
  if (!BRANCH.test(branch) || branch.includes('..'))
    throw new Error(`Bad branch name: ${branch}`);
}

export interface DiffStat {
  files: { path: string; added: number; removed: number }[];
  totalChanged: number;
}

/** Изменения рабочей копии относительно HEAD (включая новые файлы). */
export async function workingDiffStat(dir: string): Promise<DiffStat> {
  await git(dir, ['add', '-A', '--intent-to-add']);
  const out = await git(dir, ['diff', '--numstat', 'HEAD']);
  const files = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [added, removed, path] = line.split('\t');
      return { path, added: Number(added) || 0, removed: Number(removed) || 0 };
    });
  return {
    files,
    totalChanged: files.reduce((n, f) => n + f.added + f.removed, 0),
  };
}

export async function workingDiff(
  dir: string,
  maxChars = 60_000,
): Promise<string> {
  const out = await git(dir, ['diff', 'HEAD']);
  return out.length > maxChars
    ? `${out.slice(0, maxChars)}\n…[diff truncated]`
    : out;
}

/** Коммит от имени бота и push новой ветки. Никогда не пушит в существующую ветку с --force. */
export async function commitAndPush(opts: {
  dir: string;
  branch: string;
  baseBranch: string;
  message: string;
  authorName: string;
  authorEmail: string;
  token: string;
}): Promise<string> {
  assertBranchName(opts.branch);
  if (opts.branch === opts.baseBranch)
    throw new Error('Refusing to push to the base branch');
  await git(opts.dir, ['checkout', '--quiet', '-b', opts.branch]);
  await git(opts.dir, ['add', '-A']);
  await git(opts.dir, [
    '-c',
    `user.name=${opts.authorName}`,
    '-c',
    `user.email=${opts.authorEmail}`,
    'commit',
    '--quiet',
    '--no-verify',
    '-m',
    opts.message,
  ]);
  const sha = (await git(opts.dir, ['rev-parse', 'HEAD'])).trim();
  await git(
    opts.dir,
    ['push', '--quiet', 'origin', `HEAD:refs/heads/${opts.branch}`],
    {
      token: opts.token,
      timeoutMs: 180_000,
    },
  );
  return sha;
}
