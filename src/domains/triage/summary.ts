import {
  SCAN_MODULE_TITLES,
  ScanModule,
  SEVERITY_ORDER,
  Severity,
} from '../../common/security.types';
import { maxVersion } from '../scanner/adapters/util';

export interface SummaryFinding {
  id: string;
  module: ScanModule;
  severity: Severity;
  title: string;
  action: string;
  filePath: string | null;
  line: number | null;
  priorityScore: number;
  data: Record<string, unknown>;
}

export interface FixNowItem {
  module: ScanModule;
  moduleTitle: string;
  severity: Severity;
  title: string;
  action: string;
  filePath: string | null;
  score: number;
  findingIds: string[];
}

export const FIX_NOW_LIMIT = 6;
/** Сколько пунктов одного модуля пускаем в топ, пока есть кандидаты из других. */
const PER_MODULE_SOFT_LIMIT = 2;

/**
 * Что считается «одним действием»:
 * все CVE одного пакета — одно обновление; все проблемы одного IaC-ресурса — одна правка;
 * несколько правил Semgrep на одной строке — одна уязвимость.
 */
function groupKey(f: SummaryFinding): string {
  const file = f.filePath ?? '';
  switch (f.module) {
    case ScanModule.SupplyChain:
      return f.data.package && !f.data.malicious && f.data.vulnId
        ? `pkg|${file}|${f.data.package as string}`
        : f.id;
    case ScanModule.Infra:
      return f.data.resource
        ? `res|${file}|${f.data.resource as string}`
        : f.id;
    case ScanModule.CodeAudit:
      return f.line ? `loc|${file}|${f.line}` : f.id;
    default:
      return f.id;
  }
}

function toItem(group: SummaryFinding[]): FixNowItem {
  const sorted = [...group].sort((a, b) => b.priorityScore - a.priorityScore);
  const top = sorted[0];
  const base = {
    module: top.module,
    moduleTitle: SCAN_MODULE_TITLES[top.module],
    severity: top.severity,
    filePath: top.filePath,
    // Группа весит как худшая находка + небольшой бонус за каждую следующую.
    score:
      top.priorityScore +
      0.1 * sorted.slice(1).reduce((sum, f) => sum + f.priorityScore, 0),
    findingIds: sorted.map((f) => f.id),
  };
  if (group.length === 1)
    return { ...base, title: top.title, action: top.action };

  if (top.module === ScanModule.SupplyChain) {
    const pkg = top.data.package as string;
    const fixed = maxVersion(
      group.map((f) => f.data.fixedVersion as string).filter(Boolean),
    );
    return {
      ...base,
      title: `${pkg}@${top.data.version as string}: ${group.length} уязвимост(и/ей)`,
      action: fixed
        ? `Обновите ${pkg} до ${fixed} или новее — это закроет все ${group.length}`
        : top.action,
    };
  }
  if (top.module === ScanModule.Infra) {
    return {
      ...base,
      title: `${top.data.resource as string}: ${group.length} проблем(ы) конфигурации`,
      action: `${top.action} (и ещё ${group.length - 1} в этом ресурсе)`,
    };
  }
  return {
    ...base,
    title: `${top.title} (+${group.length - 1} правил(а))`,
    action: top.action,
  };
}

/**
 * «Вот 6 вещей, которые надо исправить сейчас».
 * Сначала группируем находки в действия, потом берём лучшие, следя, чтобы один модуль
 * не занял весь список, если в других тоже есть что чинить.
 */
export function buildFixNow(
  findings: SummaryFinding[],
  limit = FIX_NOW_LIMIT,
): FixNowItem[] {
  const groups = new Map<string, SummaryFinding[]>();
  for (const f of findings) {
    const key = groupKey(f);
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  const ranked = [...groups.values()]
    .map(toItem)
    .sort(
      (a, b) =>
        b.score - a.score ||
        SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
    );

  const picked: FixNowItem[] = [];
  const perModule = new Map<ScanModule, number>();
  for (const item of ranked) {
    if (picked.length >= limit) break;
    const n = perModule.get(item.module) ?? 0;
    if (n >= PER_MODULE_SOFT_LIMIT && item.score < 1000) continue;
    picked.push(item);
    perModule.set(item.module, n + 1);
  }
  // Если разнообразия не хватило — добираем лучшими из оставшихся.
  for (const item of ranked) {
    if (picked.length >= limit) break;
    if (!picked.includes(item)) picked.push(item);
  }

  return picked
    .sort((a, b) => b.score - a.score)
    .map((item) => ({ ...item, score: Math.round(item.score * 100) / 100 }));
}
