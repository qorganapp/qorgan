import { Injectable, computed, inject, signal } from '@angular/core';
import { Repository } from '../api/api.types';
import { QorganApi } from '../api/qorgan-api';

const KEY = 'qorgan.selectedRepo';

/** Выбранный репозиторий — общий для всех экранов. Выбор запоминается между сессиями. */
@Injectable({ providedIn: 'root' })
export class RepoContext {
  private readonly api = inject(QorganApi);

  readonly repositories = signal<Repository[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  private readonly selectedId = signal<string | null>(readStored());

  readonly selected = computed(() => {
    const repos = this.repositories();
    return repos.find((r) => r.id === this.selectedId()) ?? repos[0] ?? null;
  });

  load(): void {
    this.api.repositories().subscribe({
      next: (repos) => {
        this.repositories.set(repos);
        this.error.set(null);
        this.loaded.set(true);
      },
      error: () => {
        this.error.set('Could not load repositories');
        this.loaded.set(true);
      },
    });
  }

  /** Обновлённый репозиторий (например, после смены настроек агента). */
  replace(repo: Repository): void {
    this.repositories.update((list) => list.map((r) => (r.id === repo.id ? repo : r)));
  }

  select(id: string): void {
    this.selectedId.set(id);
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* без localStorage выбор живёт до перезагрузки */
    }
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
