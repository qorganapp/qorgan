import { ScanModule } from '../../../common/security.types';
import { CheckovAdapter } from './checkov.adapter';
import { GitleaksAdapter } from './gitleaks.adapter';
import { OsvAdapter } from './osv.adapter';
import { SemgrepAdapter } from './semgrep.adapter';
import { TrivyConfigAdapter, TrivyFsAdapter } from './trivy.adapter';
import { TyposquatAdapter } from './typosquat.adapter';
import { ScannerAdapter } from './types';

/** Какие инструменты составляют каждый модуль. */
export const ADAPTERS: Record<ScanModule, ScannerAdapter[]> = {
  [ScanModule.SupplyChain]: [
    new OsvAdapter(),
    new TrivyFsAdapter(),
    new TyposquatAdapter(),
  ],
  [ScanModule.Secrets]: [new GitleaksAdapter()],
  [ScanModule.CodeAudit]: [new SemgrepAdapter()],
  [ScanModule.Infra]: [new CheckovAdapter(), new TrivyConfigAdapter()],
};

/** Бинарник и флаг версии для отчёта в ScanModuleRun. */
export const TOOL_BINARIES: Record<string, [string, string[]] | undefined> = {
  'osv-scanner': ['osv-scanner', ['--version']],
  trivy: ['trivy', ['--version']],
  'trivy-config': ['trivy', ['--version']],
  gitleaks: ['gitleaks', ['version']],
  semgrep: ['semgrep', ['--version']],
  checkov: ['checkov', ['--version']],
};
