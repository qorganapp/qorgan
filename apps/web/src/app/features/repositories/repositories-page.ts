import { ChangeDetectionStrategy, Component, OnInit, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { GithubInstallation, Repository, Scan } from '../../core/api/api.types';
import { QorganApi } from '../../core/api/qorgan-api';
import { apiErrorMessage } from '../../core/api/api.types';
import { RepoContext } from '../../core/state/repo-context';
import { Toasts } from '../../core/state/toasts';
import { Icon } from '../../shared/icon';
import { REPOSITORIES } from '../../shared/module-meta';
import { SectionBadge } from '../../shared/section-badge';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';

@Component({
  selector: 'app-repositories-page',
  imports: [Icon, SectionBadge, TimeAgoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './repositories-page.html',
  styleUrl: './repositories-page.scss',
})
export class RepositoriesPage implements OnInit {
  private readonly api = inject(QorganApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly repos = inject(RepoContext);

  /** ?installed=1 — вернулись со страницы установки GitHub App */
  readonly installed = input<string>();

  protected readonly meta = REPOSITORIES;
  protected readonly installations = signal<GithubInstallation[]>([]);
  protected readonly lastScans = signal<Record<string, Scan | null>>({});
  protected readonly connecting = signal(false);
  protected readonly syncing = signal<string | null>(null);

  ngOnInit(): void {
    if (this.installed()) {
      this.toasts.show('GitHub connected. Your repositories are ready to sweep.', 'success');
      void this.router.navigate([], { queryParams: { installed: null }, replaceUrl: true });
      this.repos.load();
    }
    this.api.installations().subscribe((list) => this.installations.set(list));
    this.loadLastScans();
  }

  connect(): void {
    this.connecting.set(true);
    this.api.installUrl().subscribe({
      next: ({ url }) => {
        // Ссылка ведёт на github.com (или на себя в демо-режиме).
        if (url.startsWith('/')) {
          this.connecting.set(false);
          void this.router.navigateByUrl(url);
        } else {
          window.location.assign(url);
        }
      },
      error: (e: unknown) => {
        this.connecting.set(false);
        this.toasts.show(apiErrorMessage(e, 'Could not reach GitHub'), 'error');
      },
    });
  }

  sync(installation: GithubInstallation): void {
    this.syncing.set(installation.id);
    this.api.syncInstallation(installation.id).subscribe({
      next: () => {
        this.syncing.set(null);
        this.repos.load();
        this.toasts.show(`Synced ${installation.accountLogin}`, 'success');
      },
      error: (e: unknown) => {
        this.syncing.set(null);
        this.toasts.show(apiErrorMessage(e, 'Sync failed'), 'error');
      },
    });
  }

  openRepo(repo: Repository): void {
    this.repos.select(repo.id);
    void this.router.navigateByUrl('/sweep');
  }

  private loadLastScans(): void {
    for (const repo of this.repos.repositories()) {
      this.api
        .scans(repo.id)
        .subscribe((scans) =>
          this.lastScans.update((m) => ({ ...m, [repo.id]: scans[0] ?? null })),
        );
    }
  }
}
