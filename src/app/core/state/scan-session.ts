import { Injectable, computed, inject, signal, untracked } from '@angular/core';
import { Subscription } from 'rxjs';
import { Scan, ScanModule, ScanSummary } from '../api/api.types';
import { QorganApi } from '../api/qorgan-api';
import { apiErrorMessage } from '../api/api.types';

export type SweepPhase = 'loading' | 'idle' | 'scanning' | 'results' | 'failed';
export type ModuleProgress = 'queued' | 'running' | 'done' | 'partial' | 'failed';

export const POLL_INTERVAL_MS = 2000;

/**
 * Последний скан выбранного репозитория: загрузка, запуск, опрос статуса и сводка.
 * Один экземпляр на приложение — экран модуля берёт отсюда же id последнего скана.
 */
@Injectable({ providedIn: 'root' })
export class ScanSession {
  private readonly api = inject(QorganApi);

  readonly repositoryId = signal<string | null>(null);
  readonly scan = signal<Scan | null>(null);
  readonly summary = signal<ScanSummary | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Последний завершённый скан — по нему показываем результаты, пока идёт новый. */
  readonly lastDoneScanId = signal<string | null>(null);

  private poll: ReturnType<typeof setTimeout> | null = null;
  private sub: Subscription | null = null;

  readonly phase = computed<SweepPhase>(() => {
    const scan = this.scan();
    if (this.loading()) return 'loading';
    if (!scan) return 'idle';
    if (scan.status === 'queued' || scan.status === 'running') return 'scanning';
    if (scan.status === 'failed') return 'failed';
    return this.summary() ? 'results' : 'loading';
  });

  readonly moduleProgress = computed<Record<ScanModule, ModuleProgress>>(() => {
    const scan = this.scan();
    const result = {} as Record<ScanModule, ModuleProgress>;
    for (const module of scan?.modules ?? []) {
      const run = scan?.moduleRuns?.find((r) => r.module === module);
      result[module] = run ? run.status : scan?.status === 'running' ? 'running' : 'queued';
    }
    return result;
  });

  /** Доля завершённых модулей, 0..1. */
  readonly progress = computed(() => {
    const scan = this.scan();
    if (!scan?.modules.length) return 0;
    if (scan.status === 'done') return 1;
    // Триаж агентом — отдельный шаг: пока он идёт, скан ещё не на 100%.
    const triage = scan.triageStatus && scan.triageStatus !== 'skipped' ? 1 : 0;
    const triageDone = scan.triageStatus === 'done' ? 1 : 0;
    return ((scan.moduleRuns?.length ?? 0) + triageDone) / (scan.modules.length + triage);
  });

  /** Переключение на репозиторий: берём его последний скан. Повторный вызов с тем же id — no-op. */
  open(repositoryId: string): void {
    if (untracked(this.repositoryId) === repositoryId) return;
    this.reset();
    this.repositoryId.set(repositoryId);
    this.loading.set(true);
    this.sub = this.api.scans(repositoryId).subscribe({
      next: (scans) => {
        const latestDone = scans.find((s) => s.status === 'done');
        this.lastDoneScanId.set(latestDone?.id ?? null);
        this.loading.set(false);
        if (scans[0]) this.track(scans[0]);
      },
      error: (e: unknown) => {
        this.loading.set(false);
        this.error.set(apiErrorMessage(e, 'Could not load scans'));
      },
    });
  }

  start(): void {
    const repositoryId = this.repositoryId();
    if (!repositoryId) return;
    this.error.set(null);
    this.stopPolling();
    this.sub?.unsubscribe();
    this.sub = this.api.startScan(repositoryId).subscribe({
      next: (scan) => this.track(scan),
      error: (e: unknown) => this.error.set(apiErrorMessage(e, 'Could not start the scan')),
    });
  }

  /** Перезагрузить сводку (например, после Ignore). */
  refreshSummary(): void {
    const scan = this.scan();
    if (scan?.status !== 'done') return;
    this.api.summary(scan.id).subscribe((summary) => this.summary.set(summary));
  }

  reset(): void {
    this.stopPolling();
    this.sub?.unsubscribe();
    this.repositoryId.set(null);
    this.scan.set(null);
    this.summary.set(null);
    this.lastDoneScanId.set(null);
    this.error.set(null);
    this.loading.set(false);
  }

  private track(scan: Scan): void {
    this.scan.set(scan);
    if (scan.status === 'queued' || scan.status === 'running') {
      this.summary.set(null);
      this.poll = setTimeout(() => this.refresh(scan.id), POLL_INTERVAL_MS);
      return;
    }
    if (scan.status === 'done') {
      this.lastDoneScanId.set(scan.id);
      this.api.summary(scan.id).subscribe({
        next: (summary) => this.summary.set(summary),
        error: (e: unknown) => this.error.set(apiErrorMessage(e, 'Could not load the summary')),
      });
    }
  }

  private refresh(scanId: string): void {
    this.sub = this.api.scan(scanId).subscribe({
      next: (scan) => {
        // Пользователь мог переключить репозиторий, пока шёл запрос.
        if (this.scan()?.id === scanId) this.track(scan);
      },
      error: () => {
        // Временная ошибка сети — не бросаем скан, пробуем ещё раз.
        this.poll = setTimeout(() => this.refresh(scanId), POLL_INTERVAL_MS * 2);
      },
    });
  }

  private stopPolling(): void {
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
  }
}
