import {
  AgentConversation,
  AgentFix,
  AgentMessage,
  AgentRun,
  AgentRunDetails,
  AgentVerdict,
  Finding,
  SpaceEdge,
  SpaceGraph,
} from '../api/api.types';

/** Демо-данные агента поверх реальных находок фикстуры. */

const v = (
  verdict: AgentVerdict['verdict'],
  reachable: AgentVerdict['reachable'],
  severity: AgentVerdict['severity'],
  explanation: string,
  extra: Partial<AgentVerdict> = {},
): AgentVerdict => ({
  verdict,
  reachable,
  severity,
  confidence: 'high',
  explanation,
  runId: 'run-triage',
  at: '2026-11-03T10:00:00Z',
  ...extra,
});

const CMD = v(
  'true_positive',
  'yes',
  'critical',
  'The `cmd` query parameter of GET /run is passed straight to `subprocess.check_output(..., shell=True)` in src/app.py:13. Any visitor can run shell commands on the server.',
  {
    exploitScenario: 'GET /run?cmd=cat%20/etc/passwd returns the server’s password file.',
    fixHint: 'Remove the endpoint or run a fixed command with an argument list and shell=False.',
  },
);
const SQL = v(
  'true_positive',
  'yes',
  'high',
  'GET /user formats the `id` query parameter into the SQL string with `%` (src/app.py:9). It reaches the database unescaped.',
  {
    exploitScenario: "GET /user?id=1' OR '1'='1 dumps every user.",
    fixHint: 'Use a parameterized query: conn.execute("SELECT * FROM users WHERE id = ?", (uid,)).',
  },
);
const PICKLE = v(
  'true_positive',
  'yes',
  'critical',
  'POST /load calls `pickle.loads(request.data)` on the raw request body (src/app.py:17). Unpickling attacker data executes arbitrary code.',
  {
    exploitScenario: 'A crafted pickle payload in the request body runs code as the web server.',
    fixHint: 'Accept JSON and validate it instead of pickle.',
  },
);
const S3 = v(
  'true_positive',
  'yes',
  'high',
  'aws_s3_bucket.data uses `acl = "public-read"` and has no public access block (infra/main.tf:1-4): every object is readable by anyone on the internet.',
  {
    fixHint:
      'Set acl = "private" and add an aws_s3_bucket_public_access_block with all four flags true.',
  },
);
const SSH = v(
  'true_positive',
  'yes',
  'high',
  'Security group "ssh" opens port 22 to 0.0.0.0/0 (infra/main.tf:5-13). SSH is exposed to the whole internet.',
  {
    fixHint: 'Restrict cidr_blocks to your office/VPN range or use SSM Session Manager.',
  },
);
const LODASH = v(
  'true_positive',
  'unknown',
  'high',
  'lodash 4.17.15 is a direct dependency in package.json. The vulnerable `_.template` and `_.set` paths are not called in the Python service, but any future JS code inherits them; the upgrade is a patch release with no breaking changes.',
  {
    confidence: 'medium',
    fixHint: 'Upgrade lodash to 4.17.21.',
  },
);
const MINIMIST = v(
  'true_positive',
  'no',
  'medium',
  'minimist 1.2.0 is listed in package.json but nothing in the repository imports it, so the prototype pollution is not reachable today. Still worth upgrading: it is a drop-in patch.',
  {
    fixHint: 'Upgrade minimist to 1.2.6 or remove it if unused.',
  },
);
const TOKEN = v(
  'true_positive',
  'yes',
  'critical',
  'A GitHub personal access token was committed in src/config.ts in commit de2c8f5. It was removed in the next commit, but it is still in git history, so anyone with read access to the repository can extract it.',
  {
    fixHint:
      'Revoke the token in GitHub settings, issue a new one via an environment variable, then purge it from history.',
  },
);
const NO_HEALTHCHECK = v(
  'false_positive',
  'no',
  'info',
  'A missing Docker HEALTHCHECK affects availability monitoring, not security. The orchestrator config provides health probes.',
  {
    confidence: 'high',
  },
);

const VERDICTS: Record<string, AgentVerdict> = {
  f023: CMD,
  f024: CMD,
  f025: CMD,
  f022: SQL,
  f018: SQL,
  f019: SQL,
  f020: SQL,
  f021: SQL,
  f026: PICKLE,
  f027: PICKLE,
  f034: S3,
  f039: S3,
  f043: S3,
  f044: S3,
  f047: S3,
  f048: S3,
  f049: S3,
  f052: SSH,
  f030: SSH,
  f002: LODASH,
  f003: LODASH,
  f004: LODASH,
  f012: LODASH,
  f007: MINIMIST,
  f006: MINIMIST,
  f015: TOKEN,
  f029: NO_HEALTHCHECK,
  f042: NO_HEALTHCHECK,
};

export function applyDemoVerdicts(findings: Finding[]): Finding[] {
  return findings.map((f) => {
    const verdict = VERDICTS[f.id];
    if (!verdict) return f;
    const autoIgnored = verdict.verdict === 'false_positive';
    return {
      ...f,
      agentVerdict: verdict,
      status: autoIgnored ? 'ignored' : f.status,
      statusReason: autoIgnored ? 'Auto-ignored by Qorgan agent: false positive' : null,
    };
  });
}

export const DEMO_FIXES: AgentFix[] = [
  {
    id: 'fix-1',
    module: 'supply_chain',
    findingIds: ['f007', 'f006'],
    title: 'Upgrade minimist to 1.2.6 (prototype pollution)',
    branch: 'qorgan/fix-upgrade-minimist-to-1-2-6-1a2b3c4d',
    prNumber: 14,
    prUrl: 'https://github.com/qorganapp/demo-shop/pull/14',
    status: 'open',
    createdAt: '2026-11-03T10:06:00Z',
  },
  {
    id: 'fix-2',
    module: 'infra',
    findingIds: ['f034', 'f039', 'f043', 'f044', 'f047', 'f048', 'f049'],
    title: 'Make the data S3 bucket private and block public access',
    branch: 'qorgan/fix-make-the-data-s3-bucket-private-5e6f7a8b',
    prNumber: 15,
    prUrl: 'https://github.com/qorganapp/demo-shop/pull/15',
    status: 'open',
    createdAt: '2026-11-03T10:11:00Z',
  },
];

export function demoActivity(repositoryId: string, lastScanFinishedAt: string | null): AgentRun[] {
  const run = (id: string, minutesAgo: number, fields: Partial<AgentRun>): AgentRun => ({
    id,
    repositoryId,
    spaceId: null,
    kind: 'triage',
    status: 'done',
    title: '',
    summary: '',
    target: {},
    model: 'claude-opus-5-5',
    inputTokens: 0,
    outputTokens: 0,
    steps: 0,
    error: null,
    createdAt: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
    finishedAt: new Date(Date.now() - minutesAgo * 60_000 + 90_000).toISOString(),
    ...fields,
  });
  if (!lastScanFinishedAt) return [];
  return [
    run('run-review-2', 35, {
      kind: 'review',
      title: 'Review of PR #16: Add CSV export for orders',
      summary:
        'Requested changes on PR #16: 1 issue. The export endpoint builds a file path from the `name` query parameter — path traversal.',
      target: { prNumber: 16, prUrl: 'https://github.com/qorganapp/demo-shop/pull/16' },
      steps: 6,
    }),
    run('run-review-1', 180, {
      kind: 'review',
      title: 'Review of PR #13: Update README',
      summary: 'No security issues in PR #13. Documentation-only change.',
      steps: 2,
    }),
    run('run-fix-2', 24 * 60 - 11, {
      kind: 'fix',
      title: 'Fix: S3 bucket allows public READ access',
      summary: 'Opened PR #15: Make the data S3 bucket private and block public access',
      target: { prNumber: 15, prUrl: 'https://github.com/qorganapp/demo-shop/pull/15' },
      steps: 9,
    }),
    run('run-fix-1', 24 * 60 - 6, {
      kind: 'fix',
      title: 'Fix: minimist@1.2.0: Prototype Pollution',
      summary: 'Opened PR #14: Upgrade minimist to 1.2.6 (prototype pollution)',
      target: { prNumber: 14, prUrl: 'https://github.com/qorganapp/demo-shop/pull/14' },
      steps: 7,
    }),
    run('run-fix-0', 24 * 60 - 4, {
      kind: 'fix',
      title: 'Fix: pickle deserialization in POST /load',
      status: 'done',
      summary:
        'Did not open a PR: replacing pickle with JSON changes the API contract of POST /load; the team needs to decide on the new payload format.',
      steps: 12,
    }),
    run('run-triage', 24 * 60, {
      kind: 'triage',
      title: 'Triage of 20 findings',
      summary:
        'Reviewed 20 of 20 findings: 18 confirmed, 2 false positives (2 auto-ignored), 0 need context.',
      steps: 14,
      inputTokens: 182_000,
      outputTokens: 9_400,
    }),
  ];
}

export function demoRunDetails(run: AgentRun): AgentRunDetails {
  const steps: AgentRunDetails['stepLog'] =
    run.kind === 'triage'
      ? [
          {
            id: 's1',
            index: 0,
            text: 'Let me look at the application entry point first.',
            toolCalls: [
              {
                name: 'read_file',
                input: { path: 'src/app.py' },
                result: 'src/app.py (lines 1-17 of 17) …',
                isError: false,
              },
              {
                name: 'list_files',
                input: {},
                result: 'Dockerfile\ninfra/main.tf\npackage.json\nrequirements.txt\nsrc/app.py …',
                isError: false,
              },
            ],
          },
          {
            id: 's2',
            index: 1,
            text: 'GET /run passes `cmd` to a shell — that is directly exploitable.',
            toolCalls: [
              {
                name: 'submit_verdict',
                input: {
                  finding: 'F6',
                  verdict: 'true_positive',
                  reachable: 'yes',
                  severity: 'critical',
                },
                result: 'Saved. Remaining: F7, F8 …',
                isError: false,
              },
            ],
          },
          {
            id: 's3',
            index: 2,
            text: 'Is minimist imported anywhere?',
            toolCalls: [
              {
                name: 'search_code',
                input: { query: 'minimist' },
                result:
                  'package.json:1: {"name":"vuln","dependencies":{"lodash":"4.17.15","minimist":"1.2.0"}}',
                isError: false,
              },
            ],
          },
        ]
      : run.kind === 'review'
        ? [
            {
              id: 's1',
              index: 0,
              text: 'The new endpoint joins user input into a file path.',
              toolCalls: [
                {
                  name: 'read_file',
                  input: { path: 'src/export.py', start_line: 1, end_line: 40 },
                  result: 'src/export.py (lines 1-40) …',
                  isError: false,
                },
                {
                  name: 'add_comment',
                  input: { path: 'src/export.py', line: 12, severity: 'high' },
                  result: 'Comment added (1).',
                  isError: false,
                },
              ],
            },
            {
              id: 's2',
              index: 1,
              text: '',
              toolCalls: [
                {
                  name: 'submit_review',
                  input: { decision: 'request_changes' },
                  result: 'Review submitted.',
                  isError: false,
                },
              ],
            },
          ]
        : [
            {
              id: 's1',
              index: 0,
              text: 'Bumping the version in the manifest, then regenerating the lockfile.',
              toolCalls: [
                {
                  name: 'edit_file',
                  input: { path: 'package.json' },
                  result: 'Edited package.json',
                  isError: false,
                },
                {
                  name: 'update_lockfile',
                  input: { manifest_path: 'package.json' },
                  result: 'Regenerated package-lock.json',
                  isError: false,
                },
              ],
            },
            {
              id: 's2',
              index: 1,
              text: '',
              toolCalls: [
                {
                  name: 'verify_fix',
                  input: {},
                  result: 'PASSED: the reported issue is gone.',
                  isError: false,
                },
                {
                  name: 'submit_fix',
                  input: { title: run.summary },
                  result: 'Submitted. A pull request will be opened.',
                  isError: false,
                },
              ],
            },
          ];
  return { ...run, stepLog: steps };
}

const ANSWER_DELAY_MS = 2600;

const ANSWERS: [RegExp, string][] = [
  [
    /depend|connect|relat|share|between|связ|зависим/i,
    `Two things tie **qorganapp/demo-shop** and **qorganapp/platform-infra** together:

1. **platform-infra deploys demo-shop.** \`infra/main.tf\` in platform-infra creates the \`aws_s3_bucket.data\` bucket that the shop reads uploads from, and the same Terraform sets its ACL to \`public-read\`. So the public bucket finding in one repository exposes data written by the other.
2. **They share vulnerable packages.** Both lockfiles pin \`minimist@1.2.0\` (prototype pollution). One upgrade PR per repository is needed — PR #14 covers demo-shop only.

Fix the bucket ACL first: it is the only issue here that crosses the repository boundary and is reachable from the internet.`,
  ],
  [
    /first|priorit|urgent|start|важн|снач/i,
    `Here is the order I would go in for **qorganapp/demo-shop**:

1. **Revoke the GitHub token** committed in \`src/config.ts\` (commit de2c8f5). It is still in git history, so treat it as leaked — revoke it today.
2. **Remove the shell injection in \`GET /run\`** (\`src/app.py:13\`). Anyone can run commands on the server: \`/run?cmd=id\`.
3. **Stop unpickling request bodies** in \`POST /load\` (\`src/app.py:17\`) — that is remote code execution too. I did not open a PR because switching to JSON changes the API contract.
4. **Make the S3 bucket private** — PR #15 is ready for review.
5. **Parameterize the SQL in \`GET /user\`**:

\`\`\`python
conn.execute("SELECT * FROM users WHERE id = ?", (uid,))
\`\`\`

The dependency upgrades (minimist PR #14, lodash) are lower risk here — nothing imports them yet.`,
  ],
  [
    /token|secret|key|ключ|секрет/i,
    `The GitHub token in \`src/config.ts\` is **still a risk** even though the next commit removed it: git keeps the old version, and anyone who can clone the repository can read it.

What to do:
1. Revoke it in GitHub → Settings → Developer settings → Personal access tokens.
2. Create a new token with the minimum scopes and pass it through an environment variable (the code already reads \`process.env.GH_TOKEN\`).
3. Optionally purge it from history with \`git filter-repo\` — but revoking is what actually protects you.`,
  ],
  [
    /s3|bucket|бакет/i,
    `\`aws_s3_bucket.data\` uses \`acl = "public-read"\`, so every object in it can be downloaded by anyone who guesses the URL. PR #15 changes it to:

\`\`\`hcl
resource "aws_s3_bucket_public_access_block" "data" {
  bucket                  = aws_s3_bucket.data.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
\`\`\`

Check whether anything (a CDN, a frontend) reads from this bucket publicly before merging.`,
  ],
  [
    /did|week|activity|сделал|недел/i,
    `Since the last sweep I:
- triaged **20 findings**: 18 confirmed, 2 false positives (missing Docker HEALTHCHECK — not a security issue) which I hid;
- opened **PR #14** (minimist upgrade) and **PR #15** (private S3 bucket);
- decided **not** to auto-fix the pickle endpoint — it needs an API decision;
- reviewed **PR #16** and requested changes: the CSV export builds a path from user input (path traversal).`,
  ],
];

const DEFAULT_ANSWER = `I can look at the code, the latest Full Sweep results and what I have done so far. Try asking:
- **What should I fix first?**
- **Is the leaked token still a risk?**
- **Explain the S3 bucket issue**
- **How do these repositories depend on each other?**
- **What did you do this week?**`;

export class MockChat {
  private readonly conversations: AgentConversation[] = [];
  private readonly messages = new Map<
    string,
    (AgentMessage & { readyAt?: number; answer?: string })[]
  >();

  constructor(private readonly now: () => number) {}

  list(spaceId: string): AgentConversation[] {
    return this.conversations
      .filter((c) => c.spaceId === spaceId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  /** `repositoryId` — фокус разговора; null — вопрос ко всему пространству. */
  start(spaceId: string, content: string, repositoryId: string | null = null): AgentConversation {
    const conversation: AgentConversation = {
      id: `c-${this.conversations.length + 1}`,
      spaceId,
      repositoryId,
      title: content.slice(0, 80),
      createdAt: new Date(this.now()).toISOString(),
      updatedAt: new Date(this.now()).toISOString(),
    };
    this.conversations.push(conversation);
    this.messages.set(conversation.id, []);
    this.ask(conversation.id, content);
    return this.get(conversation.id)!;
  }

  post(
    id: string,
    content: string,
    repositoryId?: string | null,
  ): AgentConversation | 'busy' | null {
    const list = this.messages.get(id);
    if (!list) return null;
    if (this.get(id)!.messages!.some((m) => m.status === 'pending')) return 'busy';
    if (repositoryId !== undefined)
      this.conversations.find((c) => c.id === id)!.repositoryId = repositoryId;
    this.ask(id, content);
    return this.get(id);
  }

  get(id: string): AgentConversation | null {
    const conversation = this.conversations.find((c) => c.id === id);
    const list = this.messages.get(id);
    if (!conversation || !list) return null;
    const messages = list.map(({ readyAt, answer, ...m }) =>
      m.status === 'pending' && readyAt !== undefined && this.now() >= readyAt
        ? { ...m, status: 'done' as const, content: answer ?? '' }
        : m,
    );
    return { ...conversation, messages };
  }

  private ask(id: string, content: string) {
    const list = this.messages.get(id)!;
    const at = new Date(this.now()).toISOString();
    list.push({
      id: `${id}-m${list.length + 1}`,
      role: 'user',
      content,
      status: 'done',
      createdAt: at,
    });
    list.push({
      id: `${id}-m${list.length + 1}`,
      role: 'assistant',
      content: '',
      status: 'pending',
      createdAt: at,
      readyAt: this.now() + ANSWER_DELAY_MS,
      answer: ANSWERS.find(([re]) => re.test(content))?.[1] ?? DEFAULT_ANSWER,
    });
    const conversation = this.conversations.find((c) => c.id === id)!;
    conversation.updatedAt = at;
  }
}

const MAP_BUILD_MS = 5000;

/** Заготовленная карта связей демо-пространства: «строится» несколько секунд. */
export function demoGraph(
  spaceId: string,
  repos: { id: string; fullName: string }[],
  startedMs: number | null,
  now: number,
  stale: boolean,
): SpaceGraph {
  const base = { spaceId, stale: false, nodes: [], edges: [], runId: null, error: null };
  if (startedMs === null) return { ...base, status: 'none', generatedAt: null };
  if (now - startedMs < MAP_BUILD_MS) return { ...base, status: 'running', generatedAt: null };

  const has = (id: string) => repos.some((r) => r.id === id);
  const edges: SpaceEdge[] =
    has('r-shop') && has('r-infra')
      ? [
          {
            from: 'r-infra',
            to: 'r-shop',
            kind: 'calls',
            label: 'deploys the shop and the bucket it reads uploads from',
            evidence: [
              {
                repo: 'qorganapp/platform-infra',
                filePath: 'infra/main.tf',
                detail: 'aws_s3_bucket.data with acl = "public-read" — the bucket the shop uses',
              },
              {
                repo: 'qorganapp/demo-shop',
                filePath: 'src/config.ts',
                detail: 'reads the bucket name from DATA_BUCKET',
              },
            ],
          },
          {
            from: 'r-shop',
            to: 'r-infra',
            kind: 'shared_dependency',
            label: '3 shared dependencies, 1 vulnerable',
            vulnerable: true,
            evidence: [
              {
                repo: 'qorganapp/demo-shop',
                filePath: 'package.json',
                detail:
                  'minimist — has an open vulnerability (also in qorganapp/platform-infra: package.json)',
              },
              {
                repo: 'qorganapp/demo-shop',
                filePath: 'package.json',
                detail: 'express (also in qorganapp/platform-infra: package.json)',
              },
              {
                repo: 'qorganapp/demo-shop',
                filePath: 'package.json',
                detail: 'lodash (also in qorganapp/platform-infra: package.json)',
              },
            ],
          },
        ]
      : [];
  return {
    ...base,
    status: 'done',
    stale,
    nodes: repos.map((r) => ({
      repositoryId: r.id,
      fullName: r.fullName,
      packages: [],
      dependencyCount: 12,
    })),
    edges,
    runId: `map-${spaceId}`,
    generatedAt: new Date(startedMs + MAP_BUILD_MS).toISOString(),
  };
}
