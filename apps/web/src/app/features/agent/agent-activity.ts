import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { AgentRun, AgentRunDetails, AgentRunKind, Repository } from '../../core/api/api.types';
import { QorganApi } from '../../core/api/qorgan-api';
import { Toasts } from '../../core/state/toasts';
import { Icon, IconName } from '../../shared/icon';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';

const KIND_ICON: Record<AgentRunKind, IconName> = {
  triage: 'verified',
  fix: 'pullRequest',
  review: 'eye',
  chat: 'message',
  map: 'graph',
};

const KIND_LABEL: Record<AgentRunKind, string> = {
  triage: 'Triage',
  fix: 'Fix',
  review: 'PR review',
  chat: 'Chat',
  map: 'Map',
};

/** Лента действий агента: что он делал, с раскрытием журнала шагов. */
@Component({
  selector: 'app-agent-activity',
  imports: [Icon, TimeAgoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agent-activity.html',
  styleUrl: './agent-activity.scss',
})
export class AgentActivity {
  private readonly api = inject(QorganApi);
  private readonly toasts = inject(Toasts);

  readonly runs = input.required<AgentRun[]>();
  /** Репозитории пространства — чтобы подписать, к какому относится запуск. */
  readonly repositories = input<Repository[]>([]);
  readonly limit = input(50);

  protected readonly kindIcon = KIND_ICON;
  protected readonly kindLabel = KIND_LABEL;
  protected readonly expandedRun = signal<AgentRunDetails | null>(null);
  protected readonly visible = computed(() => this.runs().slice(0, this.limit()));
  private readonly repoNames = computed(
    () => new Map(this.repositories().map((r) => [r.id, r.fullName])),
  );

  protected toggleRun(run: AgentRun): void {
    if (this.expandedRun()?.id === run.id) {
      this.expandedRun.set(null);
      return;
    }
    this.api.agentRun(run.id).subscribe({
      next: (details) => this.expandedRun.set(details),
      error: () => this.toasts.show('Could not load the step log', 'error'),
    });
  }

  /** Подпись нужна, только когда в ленте запуски по нескольким репозиториям. */
  protected readonly repoOf = (run: AgentRun) =>
    this.repositories().length > 1 && run.repositoryId
      ? (this.repoNames().get(run.repositoryId) ?? null)
      : null;

  protected readonly prOf = (run: AgentRun) => {
    const url = run.target['prUrl'];
    return typeof url === 'string' && url.startsWith('https://github.com/') ? url : null;
  };

  protected readonly toolInput = (input: unknown) => {
    const text = JSON.stringify(input);
    return text.length > 140 ? `${text.slice(0, 140)}…` : text;
  };
}
