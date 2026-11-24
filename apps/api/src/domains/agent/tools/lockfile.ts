import { access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runTool } from '../../scanner/run-tool';

const exists = (p: string) =>
  access(p).then(
    () => true,
    () => false,
  );

/**
 * Перегенерирует lockfile без запуска install-скриптов пакетов. Реестр задаётся через env —
 * он важнее .npmrc проекта, поэтому репозиторий не может подменить реестр на свой.
 */
export async function updateLockfile(
  workdir: string,
  manifestPath: string,
  timeoutMs = 180_000,
): Promise<string> {
  if (!manifestPath.endsWith('package.json')) {
    return 'No lockfile step needed for this manifest (only npm/pnpm lockfiles are regenerated).';
  }
  const dir = join(workdir, dirname(manifestPath));
  const env = {
    npm_config_registry: 'https://registry.npmjs.org/',
    npm_config_ignore_scripts: 'true',
    npm_config_audit: 'false',
    npm_config_fund: 'false',
    npm_config_update_notifier: 'false',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
    CI: 'true',
  };
  if (await exists(join(dir, 'pnpm-lock.yaml'))) {
    await runTool(
      'corepack',
      ['pnpm', 'install', '--lockfile-only', '--ignore-scripts'],
      { cwd: dir, timeoutMs, env },
    );
    return `Regenerated ${join(dirname(manifestPath), 'pnpm-lock.yaml')}`;
  }
  if (await exists(join(dir, 'package-lock.json'))) {
    await runTool(
      'npm',
      [
        'install',
        '--package-lock-only',
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
      ],
      {
        cwd: dir,
        timeoutMs,
        env,
      },
    );
    return `Regenerated ${join(dirname(manifestPath), 'package-lock.json')}`;
  }
  if (await exists(join(dir, 'yarn.lock'))) {
    return 'yarn.lock is not regenerated automatically yet: mention in the PR summary that reviewers must run `yarn install`.';
  }
  return 'No lockfile found next to this manifest.';
}
