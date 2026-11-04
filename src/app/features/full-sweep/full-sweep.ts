import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { forkJoin } from 'rxjs';
import { FixNowItem, ScanModule } from '../../core/api/api.types';
import { QorganApi } from '../../core/api/qorgan-api';
import { RepoContext } from '../../core/state/repo-context';
import { ModuleProgress, ScanSession } from '../../core/state/scan-session';
import { Toasts } from '../../core/state/toasts';
import { Icon } from '../../shared/icon';
import { FULL_SWEEP, MODULE_LIST, MODULES } from '../../shared/module-meta';
import { OrbState, ScanOrb } from '../../shared/scan-orb';
import { SectionBadge } from '../../shared/section-badge';
import { SeverityBadge } from '../../shared/severity-badge';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';

const PROGRESS_LABEL: Record<ModuleProgress, string> = {
  queued: 'Waiting',
  running: 'Scanning…',
  done: 'Done',
  partial: 'Partially done',
  failed: 'Failed',
};

@Component({
  selector: 'app-full-sweep',
  imports: [RouterLink, Icon, ScanOrb, SectionBadge, SeverityBadge, TimeAgoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './full-sweep.html',
  styleUrl: './full-sweep.scss',
})
export class FullSweep {
  protected readonly session = inject(ScanSession);
  protected readonly repos = inject(RepoContext);
  private readonly api = inject(QorganApi);
  private readonly toasts = inject(Toasts);
  private readonly router = inject(Router);

  protected readonly meta = FULL_SWEEP;
  protected readonly modules = MODULE_LIST;
  protected readonly moduleMeta = MODULES;
  protected readonly progressLabel = PROGRESS_LABEL;
  protected readonly ignoring = signal<string | null>(null);

  protected readonly orbState = computed<OrbState>(() => {
    const phase = this.session.phase();
    return phase === 'scanning' ? 'scanning' : phase === 'results' ? 'done' : 'idle';
  });

  protected readonly fixNow = computed(() => this.session.summary()?.fixNow ?? []);

  protected readonly moduleRows = computed(() => {
    const progress = this.session.moduleProgress();
    const runs = this.session.scan()?.moduleRuns ?? [];
    return MODULE_LIST.map((m) => {
      const run = runs.find((r) => r.module === m.id);
      return {
        meta: m,
        state: progress[m.id] ?? 'queued',
        found: run?.tools.reduce((sum, t) => sum + t.findings, 0),
      };
    });
  });

  protected readonly tiles = computed(() => {
    const summary = this.session.summary();
    return MODULE_LIST.map((m) => ({
      meta: m,
      count: summary?.byModule[m.id] ?? 0,
      run: summary?.modules.find((r) => r.module === m.id),
    }));
  });

  protected readonly allClear = computed(
    () => this.session.phase() === 'results' && this.fixNow().length === 0,
  );

  scan(): void {
    this.session.start();
  }

  details(item: FixNowItem): void {
    void this.router.navigate(['/modules', item.module], {
      queryParams: { finding: item.findingIds[0] },
    });
  }

  ignore(item: FixNowItem): void {
    const key = item.findingIds.join();
    this.ignoring.set(key);
    forkJoin(item.findingIds.map((id) => this.api.setFindingStatus(id, 'ignored'))).subscribe({
      next: () => {
        this.ignoring.set(null);
        this.toasts.show(`Ignored “${item.title}”`, 'success');
        this.session.refreshSummary();
      },
      error: () => {
        this.ignoring.set(null);
        this.toasts.show('Could not ignore the finding', 'error');
      },
    });
  }

  protected trackItem = (item: FixNowItem) => item.findingIds.join();
  protected moduleTitle = (id: ScanModule) => MODULES[id].title;
}
