import { FakeProvider } from '../llm/fake.provider';
import { runAgent } from '../runtime/agent-runtime';
import { insightTools, InsightSource } from './insight-tools';

const source: InsightSource = {
  latestSummary: () =>
    Promise.resolve({
      totals: { open: 3 },
      fixNow: [{ title: 'minimist@1.2.0' }],
    }),
  findings: (filter) =>
    Promise.resolve(
      [
        {
          id: '1',
          module: 'secrets',
          severity: 'high',
          title: 'GitHub token in src/config.ts',
          filePath: 'src/config.ts',
          line: 1,
          status: 'open',
          action: 'Revoke the token',
          verdict: {
            verdict: 'true_positive',
            reachable: 'yes',
            explanation: 'Token is in git history.',
          },
        },
      ].filter((f) => !filter.module || f.module === filter.module),
    ),
  activity: () =>
    Promise.resolve([
      {
        kind: 'fix',
        status: 'done',
        title: 'Fix lodash',
        summary: 'Opened PR #3',
        createdAt: new Date('2026-11-04T10:00:00Z'),
      },
    ]),
  fixPrs: () =>
    Promise.resolve([
      {
        title: 'Upgrade lodash',
        prNumber: 3,
        prUrl: 'https://github.com/a/b/pull/3',
        status: 'open',
      },
    ]),
};

describe('chat insight tools', () => {
  it('lets the agent look up findings, verdicts, activity and its PRs', async () => {
    const provider = new FakeProvider([
      {
        toolCalls: [
          { id: 'a', name: 'list_findings', input: { module: 'secrets' } },
          { id: 'b', name: 'recent_activity', input: {} },
          { id: 'c', name: 'list_fix_prs', input: {} },
          { id: 'd', name: 'latest_scan_summary', input: {} },
        ],
      },
      { text: 'Rotate the GitHub token first.' },
    ]);
    const res = await runAgent({
      provider,
      system: 's',
      tools: insightTools(source),
      task: 'what first?',
    });
    const [findings, activity, prs, summary] = provider.sessions[0]
      .inputs[1] as { content: string }[];
    expect(findings.content).toContain('your verdict: true_positive');
    expect(activity.content).toContain('Opened PR #3');
    expect(prs.content).toContain('#3 [open] Upgrade lodash');
    expect(summary.content).toContain('minimist');
    expect(res.finalText).toBe('Rotate the GitHub token first.');
  });
});
