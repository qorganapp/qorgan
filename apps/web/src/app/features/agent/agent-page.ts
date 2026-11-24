import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  AgentConversation,
  AgentFix,
  AgentRun,
  AgentRunDetails,
  AgentRunKind,
  AgentSettings,
  AgentStatus,
  apiErrorMessage,
} from '../../core/api/api.types';
import { QorganApi } from '../../core/api/qorgan-api';
import { RepoContext } from '../../core/state/repo-context';
import { Toasts } from '../../core/state/toasts';
import { Icon, IconName } from '../../shared/icon';
import { MarkdownView } from '../../shared/markdown-view';
import { AGENT } from '../../shared/module-meta';
import { SectionBadge } from '../../shared/section-badge';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';

const KIND_ICON: Record<AgentRunKind, IconName> = {
  triage: 'verified',
  fix: 'pullRequest',
  review: 'eye',
  chat: 'message',
};

const SUGGESTIONS = [
  'What should I fix first?',
  'Is the leaked token still a risk?',
  'Explain the S3 bucket issue',
  'What did you do this week?',
];

const CHAT_POLL_MS = 1500;

@Component({
  selector: 'app-agent-page',
  imports: [FormsModule, Icon, MarkdownView, SectionBadge, TimeAgoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agent-page.html',
  styleUrl: './agent-page.scss',
})
export class AgentPage {
  private readonly api = inject(QorganApi);
  private readonly toasts = inject(Toasts);
  protected readonly repos = inject(RepoContext);

  protected readonly meta = AGENT;
  protected readonly suggestions = SUGGESTIONS;
  protected readonly kindIcon = KIND_ICON;

  protected readonly status = signal<AgentStatus | null>(null);
  protected readonly activity = signal<AgentRun[]>([]);
  protected readonly fixes = signal<AgentFix[]>([]);
  protected readonly conversation = signal<AgentConversation | null>(null);
  protected readonly expandedRun = signal<AgentRunDetails | null>(null);
  protected readonly sending = signal(false);
  protected draft = '';

  protected readonly messages = computed(() => this.conversation()?.messages ?? []);
  protected readonly answering = computed(() =>
    this.messages().some((m) => m.status === 'pending'),
  );
  protected readonly openFixes = computed(() => this.fixes().filter((f) => f.status === 'open'));

  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  private poll: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.api.agentStatus().subscribe((s) => this.status.set(s));

    effect(() => {
      const repo = this.repos.selected();
      untracked(() => this.loadRepo(repo?.id ?? null));
    });

    // Новое сообщение — прокрутка вниз.
    effect(() => {
      this.messages();
      const el = this.thread()?.nativeElement;
      if (el) queueMicrotask(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
    });

    inject(DestroyRef).onDestroy(() => this.stopPolling());
  }

  send(text = this.draft): void {
    const content = text.trim();
    const repo = this.repos.selected();
    if (!content || !repo || this.sending() || this.answering()) return;
    this.sending.set(true);
    const current = this.conversation();
    const request = current
      ? this.api.sendMessage(current.id, content)
      : this.api.startConversation(repo.id, content);
    request.subscribe({
      next: (conversation) => {
        this.sending.set(false);
        this.draft = '';
        this.track(conversation);
      },
      error: (e: unknown) => {
        this.sending.set(false);
        this.toasts.show(apiErrorMessage(e, 'Could not send the message'), 'error');
      },
    });
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  newChat(): void {
    this.stopPolling();
    this.conversation.set(null);
    this.draft = '';
  }

  toggleRun(run: AgentRun): void {
    if (this.expandedRun()?.id === run.id) {
      this.expandedRun.set(null);
      return;
    }
    this.api.agentRun(run.id).subscribe({
      next: (details) => this.expandedRun.set(details),
      error: () => this.toasts.show('Could not load the step log', 'error'),
    });
  }

  updateSetting<K extends keyof AgentSettings>(key: K, value: AgentSettings[K]): void {
    const repo = this.repos.selected();
    if (!repo) return;
    this.api.updateAgentSettings(repo.id, { [key]: value }).subscribe({
      next: (updated) => this.repos.replace(updated),
      error: () => this.toasts.show('Could not save the setting', 'error'),
    });
  }

  protected readonly runLabel = (run: AgentRun) =>
    ({ triage: 'Triage', fix: 'Fix', review: 'PR review', chat: 'Chat' })[run.kind];

  protected readonly prOf = (run: AgentRun) => {
    const url = run.target['prUrl'];
    return typeof url === 'string' && url.startsWith('https://github.com/') ? url : null;
  };

  protected readonly toolInput = (input: unknown) => {
    const text = JSON.stringify(input);
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  };

  private loadRepo(repoId: string | null): void {
    this.stopPolling();
    this.conversation.set(null);
    this.expandedRun.set(null);
    if (!repoId) return;
    this.api.agentActivity(repoId).subscribe((runs) => this.activity.set(runs));
    this.api.agentFixes(repoId).subscribe((fixes) => this.fixes.set(fixes));
    this.api.conversations(repoId).subscribe((list) => {
      if (list[0]) this.api.conversation(list[0].id).subscribe((c) => this.track(c));
    });
  }

  private track(conversation: AgentConversation): void {
    this.conversation.set(conversation);
    this.stopPolling();
    if (conversation.messages?.some((m) => m.status === 'pending')) {
      this.poll = setTimeout(
        () => this.api.conversation(conversation.id).subscribe((c) => this.track(c)),
        CHAT_POLL_MS,
      );
    }
  }

  private stopPolling(): void {
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
  }
}
