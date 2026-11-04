import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import {
  Finding,
  FindingStatus,
  Page,
  ScanModule,
  SEVERITIES,
  Severity,
} from '../../core/api/api.types';
import { QorganApi } from '../../core/api/qorgan-api';
import { RepoContext } from '../../core/state/repo-context';
import { ScanSession } from '../../core/state/scan-session';
import { Toasts } from '../../core/state/toasts';
import { Icon } from '../../shared/icon';
import { MODULES, SEVERITY_LABEL, isScanModule } from '../../shared/module-meta';
import { SectionBadge } from '../../shared/section-badge';
import { SeverityBadge } from '../../shared/severity-badge';
import { findingFacts, findingReferences, findingSnippet } from './finding-facts';

const TABS: { id: FindingStatus; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'ignored', label: 'Ignored' },
  { id: 'fixed', label: 'Fixed' },
];

@Component({
  selector: 'app-module-page',
  imports: [RouterLink, Icon, SectionBadge, SeverityBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './module-page.html',
  styleUrl: './module-page.scss',
  host: { '(document:keydown.escape)': 'close()' },
})
export class ModulePage {
  private readonly api = inject(QorganApi);
  private readonly router = inject(Router);
  private readonly toasts = inject(Toasts);
  protected readonly session = inject(ScanSession);
  protected readonly repos = inject(RepoContext);

  /** Параметр маршрута /modules/:module */
  readonly module = input.required<string>();
  /** ?finding=<id> — открыть конкретную находку (переход с Full Sweep) */
  readonly finding = input<string>();

  protected readonly tabs = TABS;
  protected readonly Math = Math;
  protected readonly severities = SEVERITIES.filter((s) => s !== 'info');
  protected readonly severityLabel = SEVERITY_LABEL;

  protected readonly meta = computed(() => {
    const id = this.module();
    return isScanModule(id) ? MODULES[id] : null;
  });

  protected readonly status = signal<FindingStatus>('open');
  protected readonly severity = signal<Severity | null>(null);
  protected readonly items = signal<Finding[]>([]);
  protected readonly loading = signal(false);
  protected readonly selectedId = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly visible = computed(() => {
    const sev = this.severity();
    return sev ? this.items().filter((f) => f.severity === sev) : this.items();
  });
  protected readonly counts = computed(() => {
    const counts: Partial<Record<Severity, number>> = {};
    for (const f of this.items()) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
    return counts;
  });
  protected readonly selected = computed(
    () => this.items().find((f) => f.id === this.selectedId()) ?? null,
  );
  protected readonly facts = computed(() => {
    const f = this.selected();
    return f ? findingFacts(f) : [];
  });
  protected readonly snippet = computed(() => {
    const f = this.selected();
    return f ? findingSnippet(f) : undefined;
  });
  protected readonly references = computed(() => {
    const f = this.selected();
    return f ? findingReferences(f) : [];
  });

  constructor() {
    effect(() => {
      const meta = this.meta();
      if (!meta) void this.router.navigateByUrl('/sweep');
    });

    // Загрузка при смене модуля / вкладки / репозитория / завершении нового скана.
    effect(() => {
      const meta = this.meta();
      const status = this.status();
      const scanId = this.session.lastDoneScanId();
      const repo = this.repos.selected();
      if (!meta || !repo) return;
      untracked(() => this.load(meta.id, status, scanId, repo.id));
    });

    effect(() => {
      const id = this.finding();
      if (id) untracked(() => this.selectedId.set(id));
    });
  }

  setStatus(status: FindingStatus): void {
    this.status.set(status);
    this.severity.set(null);
  }

  toggleSeverity(sev: Severity): void {
    this.severity.update((cur) => (cur === sev ? null : sev));
  }

  open(f: Finding): void {
    this.selectedId.set(f.id);
  }

  close(): void {
    if (!this.selectedId()) return;
    this.selectedId.set(null);
    if (this.finding()) {
      void this.router.navigate([], { queryParams: { finding: null }, replaceUrl: true });
    }
  }

  setFindingStatus(f: Finding, status: 'open' | 'ignored'): void {
    this.busy.set(true);
    this.api.setFindingStatus(f.id, status).subscribe({
      next: () => {
        this.busy.set(false);
        this.items.update((items) => items.filter((x) => x.id !== f.id));
        this.close();
        this.toasts.show(status === 'ignored' ? 'Finding ignored' : 'Finding reopened', 'success');
        this.session.refreshSummary();
      },
      error: () => {
        this.busy.set(false);
        this.toasts.show('Could not update the finding', 'error');
      },
    });
  }

  private load(module: ScanModule, status: FindingStatus, scanId: string | null, repoId: string) {
    let request: Observable<Page<Finding>>;
    if (status === 'fixed') {
      request = this.api.repositoryFindings(repoId, { module, status, limit: 500 });
    } else if (scanId) {
      request = this.api.scanFindings(scanId, { module, status, limit: 500 });
    } else {
      this.items.set([]);
      return;
    }
    this.loading.set(true);
    request.subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.loading.set(false);
      },
      error: () => {
        this.items.set([]);
        this.loading.set(false);
        this.toasts.show('Could not load findings', 'error');
      },
    });
  }
}
