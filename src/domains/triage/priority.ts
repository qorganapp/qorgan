import { ScanModule, Severity } from '../../common/security.types';

const SEVERITY_WEIGHT: Record<Severity, number> = {
  [Severity.Critical]: 100,
  [Severity.High]: 40,
  [Severity.Medium]: 15,
  [Severity.Low]: 5,
  [Severity.Info]: 1,
};

/** Тесты, примеры, документация: код, который обычно не попадает в прод. */
const NON_PRODUCTION_PATH =
  /(^|\/)(tests?|__tests__|spec|specs|examples?|samples?|fixtures?|docs?|testdata)\//i;

export interface Prioritizable {
  module: ScanModule;
  severity: Severity;
  filePath: string | null;
  data: Record<string, unknown>;
}

/**
 * Правила Full Sweep (без LLM). Чем выше — тем раньше чинить.
 * Вредоносный пакет всегда на первом месте, живой секрет почти всегда следующий.
 */
export function priorityScore(f: Prioritizable): number {
  if (f.data.malicious === true) return 1000;

  let score = SEVERITY_WEIGHT[f.severity];

  if (f.module === ScanModule.Secrets) {
    if (f.data.validity === 'live') score *= 3;
    // Не проверили — исходим из того, что ключ рабочий: утечка уже случилась.
    if (f.data.validity === 'unknown' || f.data.validity === undefined)
      score *= 1.5;
    if (f.data.validity === 'revoked') score *= 0.2;
  }
  if (f.module === ScanModule.SupplyChain && f.data.fixedVersion) score *= 1.5;
  if (f.module === ScanModule.Infra && f.data.publicExposure === true)
    score *= 1.5;
  // Секрет в тестовом файле всё равно утёк, поэтому скидку даём только коду и конфигам.
  if (
    f.module !== ScanModule.Secrets &&
    f.filePath &&
    NON_PRODUCTION_PATH.test(f.filePath)
  ) {
    score *= 0.3;
  }
  return Math.round(score * 100) / 100;
}
