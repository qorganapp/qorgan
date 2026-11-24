import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AgentConversation, Repository, apiErrorMessage } from '../../core/api/api.types';
import { QorganApi } from '../../core/api/qorgan-api';
import { Toasts } from '../../core/state/toasts';
import { Icon } from '../../shared/icon';
import { MarkdownView } from '../../shared/markdown-view';
import { AGENT } from '../../shared/module-meta';
import { SectionBadge } from '../../shared/section-badge';

const SPACE_SUGGESTIONS = [
  'What should we fix first across this space?',
  'How do these repositories depend on each other?',
  'Which vulnerable packages do several repositories share?',
  'What did you do this week?',
];

const REPO_SUGGESTIONS = [
  'What should I fix first?',
  'Is the leaked token still a risk?',
  'What did you do this week?',
];

const CHAT_POLL_MS = 1500;

/**
 * Чат с агентом пространства. Вопрос адресуется либо всему пространству
 * (связи между репозиториями), либо одному его репозиторию.
 */
@Component({
  selector: 'app-agent-chat',
  imports: [FormsModule, Icon, MarkdownView, SectionBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agent-chat.html',
  styleUrl: './agent-chat.scss',
  host: { class: 'glass' },
})
export class AgentChat {
  private readonly api = inject(QorganApi);
  private readonly toasts = inject(Toasts);

  readonly spaceId = input.required<string | null>();
  readonly spaceName = input('this space');
  readonly repositories = input<Repository[]>([]);
  /** Агент настроен на сервере. */
  readonly enabled = input(false);
  /** Агент закончил отвечать — у него появилась новая запись в журнале. */
  readonly answered = output<void>();

  protected readonly meta = AGENT;
  protected readonly conversation = signal<AgentConversation | null>(null);
  protected readonly sending = signal(false);
  /** Репозиторий в фокусе вопроса; null — всё пространство. */
  protected readonly focusId = signal<string | null>(null);
  protected draft = '';

  protected readonly messages = computed(() => this.conversation()?.messages ?? []);
  protected readonly answering = computed(() =>
    this.messages().some((m) => m.status === 'pending'),
  );
  /** Фокус действует, только пока репозиторий остаётся в пространстве. */
  protected readonly focus = computed(
    () => this.repositories().find((r) => r.id === this.focusId()) ?? null,
  );
  protected readonly suggestions = computed(() =>
    this.focus() ? REPO_SUGGESTIONS : SPACE_SUGGESTIONS,
  );
  protected readonly canAsk = computed(() => this.enabled() && !!this.spaceId());

  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  private poll: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const spaceId = this.spaceId();
      untracked(() => this.loadSpace(spaceId));
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
    const spaceId = this.spaceId();
    if (!content || !spaceId || this.sending() || this.answering()) return;
    this.sending.set(true);
    const current = this.conversation();
    const focus = this.focus()?.id ?? null;
    const request = current
      ? this.api.sendMessage(current.id, content, focus)
      : this.api.startConversation(spaceId, content, focus);
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

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      this.send();
    }
  }

  protected newChat(): void {
    this.stopPolling();
    this.conversation.set(null);
    this.draft = '';
  }

  protected setFocus(event: Event): void {
    this.focusId.set((event.target as HTMLSelectElement).value || null);
  }

  private loadSpace(spaceId: string | null): void {
    this.stopPolling();
    this.conversation.set(null);
    this.focusId.set(null);
    if (!spaceId) return;
    this.api.conversations(spaceId).subscribe((list) => {
      const latest = list[0];
      if (!latest || this.spaceId() !== spaceId) return;
      this.focusId.set(latest.repositoryId);
      this.api.conversation(latest.id).subscribe((c) => {
        if (this.spaceId() === spaceId) this.track(c);
      });
    });
  }

  private track(conversation: AgentConversation): void {
    const wasAnswering = this.answering();
    this.conversation.set(conversation);
    this.stopPolling();
    if (conversation.messages?.some((m) => m.status === 'pending')) {
      this.poll = setTimeout(
        () => this.api.conversation(conversation.id).subscribe((c) => this.track(c)),
        CHAT_POLL_MS,
      );
    } else if (wasAnswering) {
      this.answered.emit();
    }
  }

  private stopPolling(): void {
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
  }
}
