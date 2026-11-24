import { Severity } from '../../common/security.types';
import { RAW_SECRET, SecretFinding } from './adapters/types';

export type SecretValidity = 'live' | 'revoked' | 'unknown';

interface Probe {
  rule: RegExp;
  provider: string;
  check(secret: string, signal: AbortSignal): Promise<SecretValidity>;
}

const byStatus = (
  res: Response,
  live: number[],
  dead: number[],
): SecretValidity =>
  live.includes(res.status)
    ? 'live'
    : dead.includes(res.status)
      ? 'revoked'
      : 'unknown';

/**
 * Только read-only запросы к официальным API «кто я?»: ничего не меняем у провайдера.
 * AWS не проверяем: gitleaks находит Access Key ID, а для STS нужна ещё и secret-часть.
 */
export const PROBES: Probe[] = [
  {
    rule: /^github-(pat|fine-grained-pat|oauth|app-token)/,
    provider: 'GitHub',
    check: async (secret, signal) =>
      byStatus(
        await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `token ${secret}`,
            'User-Agent': 'qorgan-scanner',
          },
          signal,
        }),
        [200],
        [401],
      ),
  },
  {
    rule: /^gitlab-pat/,
    provider: 'GitLab',
    check: async (secret, signal) =>
      byStatus(
        await fetch('https://gitlab.com/api/v4/user', {
          headers: { 'PRIVATE-TOKEN': secret },
          signal,
        }),
        [200],
        [401],
      ),
  },
  {
    rule: /^slack-.*token/,
    provider: 'Slack',
    check: async (secret, signal) => {
      const res = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
        signal,
      });
      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (body.ok) return 'live';
      return [
        'invalid_auth',
        'token_revoked',
        'account_inactive',
        'token_expired',
      ].includes(body.error ?? '')
        ? 'revoked'
        : 'unknown';
    },
  },
  {
    rule: /^stripe-access-token/,
    provider: 'Stripe',
    check: async (secret, signal) =>
      // 403 — ограниченный ключ без прав на balance, но сам ключ действующий.
      byStatus(
        await fetch('https://api.stripe.com/v1/balance', {
          headers: { Authorization: `Bearer ${secret}` },
          signal,
        }),
        [200, 403],
        [401],
      ),
  },
];

/** Проставляет data.validity и поднимает severity для живых ключей. Всегда удаляет сырой секрет. */
export async function validateSecrets(
  findings: SecretFinding[],
  opts: { enabled: boolean; onError?: (provider: string, e: Error) => void },
): Promise<void> {
  await Promise.all(
    findings.map(async (finding) => {
      const secret = finding[RAW_SECRET];
      delete finding[RAW_SECRET];
      if (!opts.enabled || !secret) return;

      const probe = PROBES.find((p) => p.rule.test(finding.ruleId));
      if (!probe) return;

      let validity: SecretValidity = 'unknown';
      try {
        validity = await probe.check(secret, AbortSignal.timeout(5_000));
      } catch (e) {
        opts.onError?.(probe.provider, e as Error);
      }
      finding.data.validity = validity;
      finding.data.provider = probe.provider;
      if (validity === 'live') {
        finding.severity = Severity.Critical;
        finding.title = `Live ${probe.provider} key: ${finding.title}`;
      } else if (validity === 'revoked') {
        finding.severity = Severity.Low;
        finding.action =
          'The key is already revoked. Remove it from the code so it does not confuse scanners and people';
      }
    }),
  );
}
