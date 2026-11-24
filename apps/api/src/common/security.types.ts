/**
 * Модули сканирования Qorgan.
 * Full Sweep — это не отдельный модуль, а запуск всех модулей + триаж.
 */
export enum ScanModule {
  /** Supply Chain: уязвимые/вредоносные зависимости, тайпсквоттинг */
  SupplyChain = 'supply_chain',
  /** Code Audit: SAST — инъекции, IDOR, SSRF и т.п. */
  CodeAudit = 'code_audit',
  /** Secret Sweep: ключи и токены в коде и истории git */
  Secrets = 'secrets',
  /** Infra Guard: Terraform / k8s / Dockerfile */
  Infra = 'infra',
}

export const ALL_SCAN_MODULES = Object.values(ScanModule);

export const SCAN_MODULE_TITLES: Record<ScanModule, string> = {
  [ScanModule.SupplyChain]: 'Supply Chain',
  [ScanModule.CodeAudit]: 'Code Audit',
  [ScanModule.Secrets]: 'Secret Sweep',
  [ScanModule.Infra]: 'Infra Guard',
};

export enum Severity {
  Critical = 'critical',
  High = 'high',
  Medium = 'medium',
  Low = 'low',
  Info = 'info',
}

export const SEVERITY_ORDER: Severity[] = [
  Severity.Critical,
  Severity.High,
  Severity.Medium,
  Severity.Low,
  Severity.Info,
];
