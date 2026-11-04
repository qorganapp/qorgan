import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { Auth } from '../../core/api/auth';
import { isMockMode } from '../../core/mock/mock-mode';
import { RepoContext } from '../../core/state/repo-context';
import { ScanSession } from '../../core/state/scan-session';
import { Icon } from '../../shared/icon';
import {
  FULL_SWEEP,
  MODULE_LIST,
  MODULES,
  REPOSITORIES,
  SectionMeta,
  isScanModule,
} from '../../shared/module-meta';
import { SectionBadge } from '../../shared/section-badge';

interface NavItem {
  link: string;
  meta: SectionMeta;
  count?: number;
}

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, SectionBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.html',
  styleUrl: './shell.scss',
  host: {
    '[style.--accent-a]': 'section().gradient[0]',
    '[style.--accent-b]': 'section().gradient[1]',
  },
})
export class Shell {
  protected readonly auth = inject(Auth);
  protected readonly repos = inject(RepoContext);
  protected readonly session = inject(ScanSession);
  private readonly router = inject(Router);
  protected readonly demo = isMockMode();

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );

  /** Активный раздел определяет цвет всего интерфейса. */
  protected readonly section = computed<SectionMeta>(() => {
    const url = this.url();
    const module = url.match(/^\/modules\/([^/?]+)/)?.[1];
    if (isScanModule(module)) return MODULES[module];
    if (url.startsWith('/repositories')) return REPOSITORIES;
    return FULL_SWEEP;
  });

  protected readonly nav = computed<NavItem[]>(() => {
    const byModule = this.session.summary()?.byModule ?? {};
    return [
      { link: '/sweep', meta: FULL_SWEEP },
      ...MODULE_LIST.map((m) => ({ link: `/modules/${m.id}`, meta: m, count: byModule[m.id] })),
    ];
  });
  protected readonly reposMeta = REPOSITORIES;

  constructor() {
    this.repos.load();
    // Выбранный репозиторий → его последний скан (для всех экранов сразу).
    // untracked: open() читает сигналы сессии — без него они стали бы зависимостями эффекта
    // и вызывали бы бесконечную перезагрузку сканов.
    effect(() => {
      const id = this.repos.selected()?.id;
      untracked(() => (id ? this.session.open(id) : this.session.reset()));
    });
  }

  protected selectRepo(event: Event): void {
    this.repos.select((event.target as HTMLSelectElement).value);
  }
}
