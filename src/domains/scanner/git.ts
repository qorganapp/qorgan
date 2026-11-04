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
