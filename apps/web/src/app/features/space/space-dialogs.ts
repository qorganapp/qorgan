import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SpaceDetail, apiErrorMessage } from '../../core/api/api.types';
import { RepoContext } from '../../core/state/repo-context';
import { SpaceContext } from '../../core/state/space-context';
import { Toasts } from '../../core/state/toasts';
import { Dialog } from '../../shared/dialog';
import { Icon } from '../../shared/icon';
import { RepoPicker } from './repo-picker';

const DIALOG_STYLES = `
  form {
    display: grid;
    gap: 16px;
    min-height: 0;
  }
  .hint {
    margin: 0;
    font-size: 13px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }
  .connect {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 600;
    color: var(--accent-b);
    text-decoration: none;
  }
`;

/** Создание пространства: имя и репозитории, которые сразу в него попадут. */
@Component({
  selector: 'app-create-space-dialog',
  imports: [FormsModule, RouterLink, Dialog, Icon, RepoPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog title="New space" [open]="open()" (closed)="closed.emit()">
      <form (ngSubmit)="submit()">
        <label class="field">
          Name
          <input
            class="input"
            name="name"
            [(ngModel)]="name"
            maxlength="60"
            placeholder="Payments, Platform, All repositories…"
            autocomplete="off"
            required
            autofocus
          />
        </label>
        @if (repos.repositories().length) {
          <app-repo-picker [repositories]="repos.repositories()" [(selected)]="selected" />
          <p class="hint faint">
            A repository can be in several spaces. You can add or remove repositories later.
          </p>
        } @else {
          <p class="hint muted">
            No repositories connected yet.
            <a class="connect" routerLink="/repositories" (click)="closed.emit()">
              <app-icon name="github" [size]="14" /> Connect GitHub
            </a>
          </p>
        }
        <div class="actions">
          <button class="btn" type="button" (click)="closed.emit()">Cancel</button>
          <button class="btn btn-primary" type="submit" [disabled]="!name.trim() || saving()">
            Create space
          </button>
        </div>
      </form>
    </app-dialog>
  `,
  styles: DIALOG_STYLES,
})
export class CreateSpaceDialog {
  private readonly spaces = inject(SpaceContext);
  private readonly toasts = inject(Toasts);
  protected readonly repos = inject(RepoContext);

  readonly open = input(false);
  readonly closed = output<void>();

  protected name = '';
  protected readonly selected = signal<string[]>([]);
  protected readonly saving = signal(false);

  constructor() {
    // Каждое открытие — чистая форма.
    effect(() => {
      if (!this.open()) return;
      untracked(() => {
        this.name = '';
        this.selected.set([]);
      });
    });
  }

  protected submit(): void {
    const name = this.name.trim();
    if (!name || this.saving()) return;
    this.saving.set(true);
    this.spaces.create(name, this.selected()).subscribe(done(this, `Space “${name}” created`));
  }

  finish(message: string | null, error?: unknown): void {
    this.saving.set(false);
    if (message) {
      this.toasts.show(message, 'success');
      this.closed.emit();
    } else {
      this.toasts.show(apiErrorMessage(error, 'Could not save the space'), 'error');
    }
  }
}

/** Добавление репозиториев в уже существующее пространство. */
@Component({
  selector: 'app-add-repositories-dialog',
  imports: [FormsModule, RouterLink, Dialog, Icon, RepoPicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog title="Add repositories" [open]="open()" (closed)="closed.emit()">
      <form (ngSubmit)="submit()">
        @if (available().length) {
          <app-repo-picker [repositories]="available()" [(selected)]="selected" />
        } @else if (repos.repositories().length) {
          <p class="hint muted">Every connected repository is already in this space.</p>
        } @else {
          <p class="hint muted">No repositories connected yet.</p>
        }
        <p class="hint faint">
          Missing a repository?
          <a class="connect" routerLink="/repositories" (click)="closed.emit()">
            <app-icon name="github" [size]="14" /> Connect it on GitHub
          </a>
        </p>
        <div class="actions">
          <button class="btn" type="button" (click)="closed.emit()">Cancel</button>
          <button class="btn btn-primary" type="submit" [disabled]="!selected().length || saving()">
            Add {{ selected().length || '' }}
          </button>
        </div>
      </form>
    </app-dialog>
  `,
  styles: DIALOG_STYLES,
})
export class AddRepositoriesDialog {
  private readonly spaces = inject(SpaceContext);
  private readonly toasts = inject(Toasts);
  protected readonly repos = inject(RepoContext);

  readonly open = input(false);
  readonly closed = output<void>();

  protected readonly selected = signal<string[]>([]);
  protected readonly saving = signal(false);
  protected readonly available = computed(() => {
    const inSpace = new Set(this.spaces.repositories().map((r) => r.id));
    return this.repos.repositories().filter((r) => !inSpace.has(r.id));
  });

  constructor() {
    effect(() => {
      if (this.open()) untracked(() => this.selected.set([]));
    });
  }

  protected submit(): void {
    const space = this.spaces.selected();
    const ids = this.selected();
    if (!space || !ids.length || this.saving()) return;
    this.saving.set(true);
    this.spaces
      .addRepositories(space.id, ids)
      .subscribe(
        done(this, `${ids.length} ${ids.length === 1 ? 'repository' : 'repositories'} added`),
      );
  }

  finish(message: string | null, error?: unknown): void {
    this.saving.set(false);
    if (message) {
      this.toasts.show(message, 'success');
      this.closed.emit();
    } else {
      this.toasts.show(apiErrorMessage(error, 'Could not add the repositories'), 'error');
    }
  }
}

function done(dialog: { finish(message: string | null, error?: unknown): void }, message: string) {
  return {
    next: (_: SpaceDetail) => dialog.finish(message),
    error: (e: unknown) => dialog.finish(null, e),
  };
}
