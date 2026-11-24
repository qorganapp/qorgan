import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { SpaceDetail, SpaceListItem } from '../api/api.types';
import { QorganApi } from '../api/qorgan-api';

const KEY = 'qorgan.selectedSpace';

/**
 * Пространства пользователя и выбранное из них — общее для всех экранов.
 * Выбор запоминается между сессиями, как и выбранный репозиторий.
 */
@Injectable({ providedIn: 'root' })
export class SpaceContext {
  private readonly api = inject(QorganApi);

  readonly spaces = signal<SpaceListItem[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);
  private readonly selectedId = signal<string | null>(readStored());
  /** Состав выбранного пространства; null, пока не загружен. */
  private readonly details = signal<SpaceDetail | null>(null);

  readonly selected = computed(() => {
    const spaces = this.spaces();
    return spaces.find((s) => s.id === this.selectedId()) ?? spaces[0] ?? null;
  });

  readonly detail = computed(() => {
    const detail = this.details();
    return detail && detail.id === this.selected()?.id ? detail : null;
  });

  /** Репозитории выбранного пространства; пусто, пока состав не загружен. */
  readonly repositories = computed(() => this.detail()?.repositories ?? []);

  load(): void {
    this.api.spaces().subscribe({
      next: (spaces) => {
        this.spaces.set(spaces);
        this.error.set(null);
        this.loaded.set(true);
        this.loadDetail();
      },
      error: () => {
        this.error.set('Could not load spaces');
        this.loaded.set(true);
      },
    });
  }

  select(id: string): void {
    if (id === this.selected()?.id) return;
    this.selectedId.set(id);
    store(id);
    this.loadDetail();
  }

  create(name: string, repositoryIds: string[]): Observable<SpaceDetail> {
    return this.api.createSpace(name, repositoryIds).pipe(
      tap((space) => {
        this.spaces.update((list) => [...list, toItem(space)]);
        this.selectedId.set(space.id);
        store(space.id);
        this.details.set(space);
      }),
    );
  }

  rename(id: string, name: string): Observable<SpaceDetail> {
    return this.api.renameSpace(id, name).pipe(tap((space) => this.apply(space)));
  }

  remove(id: string): Observable<void> {
    return this.api.deleteSpace(id).pipe(
      tap(() => {
        this.spaces.update((list) => list.filter((s) => s.id !== id));
        if (this.details()?.id === id) this.details.set(null);
        // Выбор переходит к первому из оставшихся пространств.
        this.loadDetail();
      }),
    );
  }

  addRepositories(id: string, repositoryIds: string[]): Observable<SpaceDetail> {
    return this.api.addSpaceRepositories(id, repositoryIds).pipe(tap((space) => this.apply(space)));
  }

  removeRepository(id: string, repositoryId: string): Observable<SpaceDetail> {
    return this.api.removeSpaceRepository(id, repositoryId).pipe(tap((space) => this.apply(space)));
  }

  private apply(space: SpaceDetail): void {
    this.spaces.update((list) => list.map((s) => (s.id === space.id ? toItem(space) : s)));
    if (this.selected()?.id === space.id) this.details.set(space);
  }

  private loadDetail(): void {
    const id = this.selected()?.id;
    if (!id) return this.details.set(null);
    if (this.details()?.id === id) return;
    this.api.space(id).subscribe({
      // Пока шёл запрос, могли выбрать другое пространство — такой ответ не нужен.
      next: (space) => {
        if (this.selected()?.id === space.id) this.details.set(space);
      },
      error: () => this.error.set('Could not load the space'),
    });
  }
}

function toItem(space: SpaceDetail): SpaceListItem {
  const { repositories, ...rest } = space;
  return { ...rest, repositoryCount: repositories.length };
}

function store(id: string): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* без localStorage выбор живёт до перезагрузки */
  }
}

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
