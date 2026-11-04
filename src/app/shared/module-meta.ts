import { ScanModule, Severity } from '../core/api/api.types';
import { IconName } from './icon';

export interface SectionMeta {
  title: string;
  tagline: string;
  description: string;
  icon: IconName;
  /** Пара цветов градиента: фон приложения, иконки, кнопки — всё окрашивается по разделу. */
  gradient: [string, string];
}

export interface ModuleMeta extends SectionMeta {
  id: ScanModule;
  tools: string[];
}

export const FULL_SWEEP: SectionMeta = {
  title: 'Full Sweep',
  tagline: 'Every check, one button',
  description:
    'Runs all four modules and tells you the few things worth fixing first — not a wall of alerts.',
  icon: 'sweep',
  gradient: ['#7c5cff', '#ff5ca8'],
};

export const REPOSITORIES: SectionMeta = {
  title: 'Repositories',
  tagline: 'Connected GitHub repositories',
  description: 'Connect repositories through the Qorgan GitHub App (read-only access to code).',
  icon: 'repo',
  gradient: ['#4f6bd8', '#8f9dff'],
};

export const MODULES: Record<ScanModule, ModuleMeta> = {
  supply_chain: {
    id: 'supply_chain',
    title: 'Supply Chain',
    tagline: 'Vulnerable & malicious dependencies',
    description:
      'Known CVEs in your lockfiles, malicious packages and typosquats like “reqeusts” instead of “requests”.',
    icon: 'package',
    gradient: ['#11c5a8', '#7be26b'],
    tools: ['osv-scanner', 'trivy', 'typosquat'],
  },
  code_audit: {
    id: 'code_audit',
    title: 'Code Audit',
    tagline: 'Injection, SSRF & unsafe code',
    description:
      'Static analysis for injections, command execution, unsafe deserialization, SSRF and auth bypasses.',
    icon: 'code',
    gradient: ['#3b6dff', '#3fd2ff'],
    tools: ['semgrep'],
  },
  secrets: {
    id: 'secrets',
    title: 'Secret Sweep',
    tagline: 'Keys & tokens in code and git history',
    description:
      'API keys, tokens and passwords anywhere in your git history — and whether they still work.',
    icon: 'key',
    gradient: ['#ffb23f', '#ff5f3d'],
    tools: ['gitleaks'],
  },
  infra: {
    id: 'infra',
    title: 'Infra Guard',
    tagline: 'Terraform, Kubernetes & Docker',
    description:
      'Public buckets, root containers, wide IAM permissions and ports open to the whole internet.',
    icon: 'server',
    gradient: ['#6a5cff', '#c35cff'],
    tools: ['checkov', 'trivy config'],
  },
};

export const MODULE_LIST: ModuleMeta[] = [
  MODULES.supply_chain,
  MODULES.code_audit,
  MODULES.secrets,
  MODULES.infra,
];

export const isScanModule = (value: string | null | undefined): value is ScanModule =>
  !!value && value in MODULES;

export const SEVERITY_LABEL: Record<Severity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  info: 'Info',
};
