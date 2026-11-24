import { execFile } from 'node:child_process';

export class ToolError extends Error {
  constructor(
    readonly tool: string,
    message: string,
  ) {
    super(`${tool}: ${message}`);
  }
}

export interface RunToolOptions {
  cwd?: string;
  timeoutMs: number;
  /** Коды выхода, которые не считаются ошибкой (многие сканеры выходят с 1, если что-то нашли). */
  okExitCodes?: number[];
  env?: NodeJS.ProcessEnv;
}

export interface ToolResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

const MAX_BUFFER = 256 * 1024 * 1024;

/** Запускает бинарник без shell (никакой интерполяции аргументов). */
export function runTool(
  cmd: string,
  args: string[],
  opts: RunToolOptions,
): Promise<ToolResult> {
  const okExitCodes = opts.okExitCodes ?? [0];
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_BUFFER,
        env: { PATH: process.env.PATH, HOME: process.env.HOME, ...opts.env },
      },
      (error, stdout, stderr) => {
        const exitCode =
          error && typeof error.code === 'number' ? error.code : error ? -1 : 0;
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          return reject(new ToolError(cmd, 'binary not found in PATH'));
        }
        if (error?.killed) {
          return reject(
            new ToolError(cmd, `timed out after ${opts.timeoutMs} ms`),
          );
        }
        if (!okExitCodes.includes(exitCode)) {
          return reject(
            new ToolError(
              cmd,
              `exit code ${exitCode}: ${tail(stderr || stdout || error?.message || '')}`,
            ),
          );
        }
        resolve({ stdout, stderr, exitCode });
      },
    );
  });
}

const versionCache = new Map<string, Promise<string | undefined>>();

/** Версия инструмента (кешируется на время жизни процесса). */
export function toolVersion(
  cmd: string,
  args = ['--version'],
): Promise<string | undefined> {
  if (!versionCache.has(cmd)) {
    versionCache.set(
      cmd,
      runTool(cmd, args, { timeoutMs: 30_000 })
        .then(({ stdout, stderr }) => {
          const text = `${stdout}\n${stderr}`;
          return text.match(/\d+\.\d+\.\d+/)?.[0];
        })
        .catch(() => undefined),
    );
  }
  return versionCache.get(cmd)!;
}

export function parseJson<T>(tool: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new ToolError(tool, `invalid JSON output: ${tail(raw)}`);
  }
}

function tail(text: string, max = 500): string {
  const t = text.trim();
  return t.length > max ? `…${t.slice(-max)}` : t;
}
