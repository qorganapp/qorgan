import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Severity } from '../../../common/security.types';
import { FakeProvider } from '../llm/fake.provider';
import { Workspace } from '../runtime/workspace';
import { describeFinding, runTriage, TriageInput } from './triage.skill';

const finding = (
  id: string,
  extra: Partial<TriageInput> = {},
): TriageInput => ({
  id,
  module: 'code_audit',
  tool: 'semgrep',
  ruleId: 'python.sqli',
  severity: Severity.High,
  title: 'SQL injection in handler',
  description: 'SQL injection',
  filePath: 'app.py',
  line: 2,
  data: {},
  ...extra,
});

const verdict = (ref: string, v: 'true_positive' | 'false_positive') => ({
  id: `call-${ref}`,
  name: 'submit_verdict',
  input: {
    finding: ref,
    verdict: v,
    reachable: v === 'true_positive' ? 'yes' : 'no',
    severity: 'high',
    confidence: 'high',
    explanation: 'Checked the route handler in app.py.',
  },
});

describe('runTriage', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'triage-'));
    await writeFile(
      join(dir, 'app.py'),
      'uid = request.args["id"]\ncur.execute("SELECT %s" % uid)\n',
    );
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('reads code, collects one verdict per finding and stops when all are submitted', async () => {
    const provider = new FakeProvider([
      {
        toolCalls: [{ id: 'r', name: 'read_file', input: { path: 'app.py' } }],
      },
      {
        toolCalls: [
          verdict('F1', 'true_positive'),
          verdict('f2', 'false_positive'),
        ],
      },
    ]);
    const { result, verdicts } = await runTriage({
      provider,
      workspace: new Workspace(dir),
      findings: [finding('uuid-1'), finding('uuid-2')],
    });

    expect(result.status).toBe('done');
    expect(verdicts.get('uuid-1')?.verdict).toBe('true_positive');
    expect(verdicts.get('uuid-2')?.verdict).toBe('false_positive');
    const task = provider.sessions[0].inputs[0] as string;
    expect(task).toContain('F1 [code_audit] HIGH');
    expect(task).not.toContain('uuid-1');
    const readResult = provider.sessions[0].inputs[1] as { content: string }[];
    expect(readResult[0].content).toContain('cur.execute');
  });

  it('tells the model about unknown references and remaining findings', async () => {
    const provider = new FakeProvider([
      { toolCalls: [verdict('F9', 'true_positive')] },
      { toolCalls: [verdict('F1', 'true_positive')] },
      { text: 'stopping early' },
    ]);
    const { verdicts } = await runTriage({
      provider,
      workspace: new Workspace(dir),
      findings: [finding('a'), finding('b')],
    });
    const [first] = provider.sessions[0].inputs[1] as { content: string }[];
    expect(first.content).toContain('Unknown finding "F9"');
    const [second] = provider.sessions[0].inputs[2] as { content: string }[];
    expect(second.content).toContain('Remaining: F2');
    expect(verdicts.size).toBe(1);
  });

  it('never puts raw secrets or unknown data fields into the prompt', () => {
    const text = describeFinding(
      'F1',
      finding('x', {
        module: 'secrets',
        data: {
          masked: 'ghp_…ab',
          secretHash: 'deadbeef',
          rawValue: 'ghp_REAL',
          author: 'someone',
        },
      }),
    );
    expect(text).toContain('ghp_…ab');
    expect(text).not.toMatch(/deadbeef|ghp_REAL|someone/);
  });
});
