import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { AgentFix, AgentRun, AgentSettings, AgentStatus } from '../../core/api/api.types';
import { QorganApi } from '../../core/api/qorgan-api';
import { RepoContext } from '../../core/state/repo-context';
import { SpaceContext } from '../../core/state/space-context';
import { Toasts } from '../../core/state/toasts';
import { Icon } from '../../shared/icon';
import { AGENT } from '../../shared/module-meta';
import { SectionBadge } from '../../shared/section-badge';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';
import { AgentActivity } from './agent-activity';
import { AgentChat } from './agent-chat';

/**
 * Полный экран агента пространства: чат, его pull request'ы и журнал по всем
 * репозиториям пространства. Навыки настраиваются для выбранного репозитория.
 */
@Component({
  selector: 'app-agent-page',
  imports: [Icon, SectionBadge, TimeAgoPipe, AgentChat, AgentActivity],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agent-page.html',
  styleUrl: './agent-page.scss',
})
export class AgentPage {
  private readonly api = inject(QorganApi);
  private readonly toasts = inject(Toasts);
  protected readonly repos = inject(RepoContext);
  protected readonly spaces = inject(SpaceContext);

  protected readonly meta = AGENT;
  protected readonly status = signal<AgentStatus | null>(null);
  protected readonly activity = signal<AgentRun[]>([]);
  protected readonly fixes = signal<AgentFix[]>([]);
  protected readonly openFixes = computed(() => this.fixes().filter((f) => f.status === 'open'));

  constructor() {
    this.api.agentStatus().subscribe((s) => this.status.set(s));

    // Состав пространства тоже отслеживаем: лента и PR зависят от его репозиториев.
    effect(() => {
      this.spaces.detail();
      untracked(() => {
        this.loadActivity();
        this.loadFixes();
      });
    });
  }

  protected loadActivity(): void {
    const id = this.spaces.selected()?.id;
    if (!id) return this.activity.set([]);
    this.api.spaceActivity(id).subscribe((runs) => {
      if (this.spaces.selected()?.id === id) this.activity.set(runs);
    });
  }

  private loadFixes(): void {
    const id = this.spaces.selected()?.id;
    if (!id) return this.fixes.set([]);
    this.api.spaceFixes(id).subscribe((fixes) => {
      if (this.spaces.selected()?.id === id) this.fixes.set(fixes);
    });
  }

  protected updateSetting<K extends keyof AgentSettings>(key: K, value: AgentSettings[K]): void {
    const repo = this.repos.selected();
    if (!repo) return;
    this.api.updateAgentSettings(repo.id, { [key]: value }).subscribe({
      next: (updated) => this.repos.replace(updated),
      error: () => this.toasts.show('Could not save the setting', 'error'),
    });
  }
}
