import { Finding } from '../../core/api/api.types';

export interface Fact {
  label: string;
  value: string;
  mono?: boolean;
  href?: string;
  tone?: 'ok' | 'bad' | 'warn';
}

const str = (v: unknown): string | undefined =>
  v === undefined || v === null || v === '' ? undefined : String(v);
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);

/** Модуль-специфичные поля находки в человекочитаемом виде (только то, что есть). */
export function findingFacts(f: Finding): Fact[] {
  const d = f.data;
  const facts: (Fact | null)[] = [];
  const add = (label: string, value: string | undefined, extra: Partial<Fact> = {}) =>
    facts.push(value ? { label, value, ...extra } : null);

  switch (f.module) {
    case 'supply_chain':
      add('Package', str(d['package']) && `${str(d['package'])}@${str(d['version'])}`, {
        mono: true,
      });
      add('Fixed in', str(d['fixedVersion']), { mono: true, tone: 'ok' });
      add('Ecosystem', str(d['ecosystem']));
      add('Advisory', str(d['vulnId']), { mono: true, href: str(d['url']) });
      add(
        'Also known as',
        list(d['aliases'])
          .filter((a) => a !== d['vulnId'])
          .join(', ') || undefined,
        {
          mono: true,
        },
      );
      add('Looks like', str(d['lookalikeOf']), { mono: true, tone: 'warn' });
      if (d['malicious'] === true) add('Malicious', 'Yes — remove immediately', { tone: 'bad' });
      break;
    case 'secrets': {
      const validity = str(d['validity']);
      add('Secret', str(d['masked']), { mono: true });
      add('Type', str(d['secretType']), { mono: true });
      add(
        'Still valid?',
        validity === 'live'
          ? `Yes — live ${str(d['provider']) ?? ''} key`.trim()
          : validity === 'revoked'
            ? 'No — already revoked'
            : 'Not verified',
        { tone: validity === 'live' ? 'bad' : validity === 'revoked' ? 'ok' : undefined },
      );
      add('First commit', str(d['firstCommit'])?.slice(0, 10), { mono: true });
      add('Author', str(d['author']));
      add('Occurrences', str(d['occurrences']));
      add('Files', list(d['files']).join(', ') || undefined, { mono: true });
      break;
    }
    case 'code_audit':
      add('CWE', list(d['cwe']).join(', ') || undefined);
      add('OWASP', list(d['owasp']).join(', ') || undefined);
      add('Confidence', str(d['confidence']));
      add('Impact', str(d['impact']));
      break;
    case 'infra':
      add('Resource', str(d['resource']), { mono: true });
      add('Framework', str(d['framework']));
      if (d['publicExposure'] === true)
        add('Exposure', 'Reachable from the internet', { tone: 'bad' });
      add('Guide', str(d['url']) ? 'Open documentation' : undefined, { href: str(d['url']) });
      break;
  }
  const tools = list(d['tools']);
  add('Detected by', (tools.length ? tools : [f.tool]).join(', '));
  add('Rule', f.ruleId, { mono: true });
  return facts.filter((x): x is Fact => x !== null);
}

export const findingSnippet = (f: Finding): string | undefined => str(f.data['snippet']);
export const findingReferences = (f: Finding): string[] =>
  list(f.data['references'])
    .filter((r) => /^https?:\/\//.test(r))
    .slice(0, 5);
