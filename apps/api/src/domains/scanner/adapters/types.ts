import { ScanModule, Severity } from '../../../common/security.types';

/** Находка в едином формате — то, во что каждый адаптер превращает вывод своего инструмента. */
export interface NormalizedFinding {
  module: ScanModule;
  tool: string;
  ruleId: string;
  severity: Severity;
  title: string;
  description: string;
  filePath: string | null;
  line: number | null;
  /** Стабильный ключ для дедупликации между сканами и инструментами (sha256 hex). */
  fingerprint: string;
  data: Record<string, unknown>;
  action: string;
}

export interface ScanContext {
  /** Абсолютный путь к клону репозитория. */
  workdir: string;
  /** Каталог для отчётов вне клона (чтобы сканеры не видели свои же отчёты). */
  reportDir: string;
  timeoutMs: number;
}

export interface ScannerAdapter {
  readonly module: ScanModule;
  readonly tool: string;
  run(ctx: ScanContext): Promise<NormalizedFinding[]>;
}

/** Внутреннее поле: значение секрета нужно валидатору, но никогда не сохраняется. */
export const RAW_SECRET = Symbol('rawSecret');

export type SecretFinding = NormalizedFinding & { [RAW_SECRET]?: string };
