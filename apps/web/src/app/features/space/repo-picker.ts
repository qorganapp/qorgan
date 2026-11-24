import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { Repository } from '../../core/api/api.types';
import { Icon } from '../../shared/icon';

/** Чек-лист репозиториев для добавления в пространство. */
@Component({
  selector: 'app-repo-picker',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="head">
      <span class="faint">{{ selected().length }} of {{ repositories().length }} selected</span>
      <button class="btn btn-ghost btn-sm" type="button" (click)="toggleAll()">
        {{ allSelected() ? 'Clear' : 'Select all' }}
      </button>
    </div>
    <ul>
      @for (repo of repositories(); track repo.id) {
        <li>
          <label>
            <input
              type="checkbox"
              [checked]="selected().includes(repo.id)"
              (change)="toggle(repo.id)"
            />
            <app-icon name="repo" [size]="16" />
            <span class="name">{{ repo.fullName }}</span>
            @if (repo.private) {
              <app-icon name="lock" [size]="13" class="faint" />
            }
          </label>
        </li>
      }
    </ul>
  `,
  styles: `
    :host {
      display: grid;
      gap: 6px;
      min-height: 0;
    }
    .head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 4px;
      max-height: min(320px, 40dvh);
      overflow-y: auto;
      border: 1px solid var(--glass-border);
      border-radius: var(--radius-sm);
      background: var(--glass);
    }
    label {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 10px;
      border-radius: 9px;
      font-size: 14px;
      cursor: pointer;
    }
    label:hover {
      background: var(--glass-strong);
    }
    input {
      width: 16px;
      height: 16px;
      accent-color: var(--accent-a);
    }
    .name {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 500;
    }
  `,
})
export class RepoPicker {
  readonly repositories = input.required<Repository[]>();
  readonly selected = model<string[]>([]);

  protected readonly allSelected = computed(
    () => this.repositories().length > 0 && this.selected().length === this.repositories().length,
  );

  protected toggle(id: string): void {
    this.selected.update((ids) => (ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id]));
  }

  protected toggleAll(): void {
    this.selected.set(this.allSelected() ? [] : this.repositories().map((r) => r.id));
  }
}
