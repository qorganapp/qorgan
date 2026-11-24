import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  AgentRun,
  AgentStatus,
  Repository,
  SEVERITIES,
  SpaceOverview,
  SpaceRepositoryOverview,
  apiErrorMessage,
} from '../../core/api/api.types';
import { QorganApi } from '../../core/api/qorgan-api';
import { RepoContext } from '../../core/state/repo-context';
import { SpaceContext } from '../../core/state/space-context';
import { Toasts } from '../../core/state/toasts';
import { Dialog } from '../../shared/dialog';
import { Icon } from '../../shared/icon';
import { MODULE_LIST, SEVERITY_LABEL, SPACE } from '../../shared/module-meta';
import { SectionBadge } from '../../shared/section-badge';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';
import { AgentActivity } from '../agent/agent-activity';
import { AgentChat } from '../agent/agent-chat';
import { AddRepositoriesDialog, CreateSpaceDialog } from './space-dialogs';
import { SpaceMap } from './space-map';

interface RepoCard {
  repo: Repository;
  overview: SpaceRepositoryOverview | null;
}

type Modal = 'create' | 'add' | 'rename' | 'delete' | null;

/** Дэшборд пространства: сводка, репозитории, карта связей и агент. */
@Component({
  selector: 'app-space-page',
  imports: [
    FormsModule,
    RouterLink,
    Icon,
    SectionBadge,
    TimeAgoPipe,
    Dialog,
    AgentChat,
    AgentActivity,
    SpaceMap,
    CreateSpaceDialog,
    AddRepositoriesDialog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './space-page.html',
  styleUrl: './space-page.scss',
})
export class SpacePage {
  private readonly api = inject(QorganApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly spaces = inject(SpaceContext);
  protected readonly repos = inject(RepoContext);

  protected readonly meta = SPACE;
  protected readonly severities = SEVERITIES;
  protected readonly severityLabel = SEVERITY_LABEL;
  protected readonly modules = MODULE_LIST;

  protected readonly status = signal<AgentStatus | null>(null);
  protected readonly overview = signal<SpaceOverview | null>(null);
  protected readonly activity = signal<AgentRun[]>([]);
  protected readonly modal = signal<Modal>(null);
  protected readonly busy = signal(false);
  protected newName = '';

  protected readonly cards = computed<RepoCard[]>(() => {
    const overview = this.overview();
    const byRepo = new Map(overview?.repositories.map((r) => [r.repositoryId, r]) ?? []);
    return this.repos.scoped().map((repo) => ({ repo, overview: byRepo.get(repo.id) ?? null }));
  });

  constructor() {
    this.api.agentStatus().subscribe((s) => this.status.set(s));

    // Сводка и лента зависят от состава пространства, а не только от его id.
    effect(() => {
      const detail = this.spaces.detail();
      untracked(() => {
        this.overview.set(null);
        this.activity.set([]);
        if (!detail) return;
        this.api.spaceOverview(detail.id).subscribe((o) => {
          if (this.spaces.selected()?.id === o.spaceId) this.overview.set(o);
        });
        this.loadActivity();
      });
    });
  }

  protected loadActivity(): void {
    const id = this.spaces.selected()?.id;
    if (!id) return;
    this.api.spaceActivity(id).subscribe((runs) => {
      if (this.spaces.selected()?.id === id) this.activity.set(runs);
    });
  }

  protected openRepo(repo: Repository): void {
    this.repos.select(repo.id);
    void this.router.navigateByUrl('/sweep');
  }

  protected removeRepo(repo: Repository): void {
    const space = this.spaces.selected();
    if (!space) return;
    this.spaces.removeRepository(space.id, repo.id).subscribe({
      next: () => this.toasts.show(`${repo.fullName} removed from ${space.name}`, 'success'),
      error: (e: unknown) =>
        this.toasts.show(apiErrorMessage(e, 'Could not remove the repository'), 'error'),
    });
  }

  protected startRename(): void {
    this.newName = this.spaces.selected()?.name ?? '';
    this.modal.set('rename');
  }

  protected rename(): void {
    const space = this.spaces.selected();
    const name = this.newName.trim();
    if (!space || !name || this.busy()) return;
    this.busy.set(true);
    this.spaces.rename(space.id, name).subscribe({
      next: () => this.finish(),
      error: (e: unknown) => this.finish(apiErrorMessage(e, 'Could not rename the space')),
    });
  }

  protected remove(): void {
    const space = this.spaces.selected();
    if (!space || this.busy()) return;
    this.busy.set(true);
    this.spaces.remove(space.id).subscribe({
      next: () => {
        this.finish();
        this.toasts.show(`Space “${space.name}” deleted`, 'success');
      },
      error: (e: unknown) => this.finish(apiErrorMessage(e, 'Could not delete the space')),
    });
  }

  private finish(error?: string): void {
    this.busy.set(false);
    if (error) this.toasts.show(error, 'error');
    else this.modal.set(null);
  }
}
