import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  output,
  signal,
} from '@angular/core';
import { SpaceContext } from '../../core/state/space-context';
import { Icon } from '../../shared/icon';

/** Переключатель пространств: текущее пространство, список остальных и создание нового. */
@Component({
  selector: 'app-space-switcher',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
    '(keydown.escape)': 'open.set(false)',
  },
  template: `
    <button
      class="current"
      type="button"
      aria-haspopup="menu"
      [attr.aria-expanded]="open()"
      (click)="open.set(!open())"
    >
      <span class="mark"><app-icon name="layers" [size]="16" /></span>
      <span class="text">
        <span class="label">Space</span>
        <strong>{{ spaces.selected()?.name ?? 'No space yet' }}</strong>
      </span>
      <app-icon name="chevronDown" [size]="14" class="chev" />
    </button>
    @if (open()) {
      <div class="menu glass" role="menu" animate.enter="enter-fade">
        @for (space of spaces.spaces(); track space.id) {
          <button
            type="button"
            role="menuitemradio"
            class="item"
            [attr.aria-checked]="space.id === spaces.selected()?.id"
            (click)="pick(space.id)"
          >
            <span class="name">{{ space.name }}</span>
            <span class="count">{{ space.repositoryCount }}</span>
            @if (space.id === spaces.selected()?.id) {
              <app-icon name="check" [size]="14" />
            }
          </button>
        }
        <button type="button" role="menuitem" class="item new" (click)="create()">
          <app-icon name="plus" [size]="14" /> New space
        </button>
      </div>
    }
  `,
  styles: `
    :host {
      position: relative;
      display: block;
    }
    .current {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 10px;
      border-radius: 14px;
      border: 1px solid var(--glass-border);
      background: var(--glass);
      text-align: left;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    .current:hover {
      background: var(--glass-strong);
    }
    .mark {
      flex: none;
      width: 30px;
      height: 30px;
      border-radius: 10px;
      display: grid;
      place-items: center;
      color: #fff;
      background: linear-gradient(135deg, var(--accent-a), var(--accent-b));
      transition: background 0.6s ease;
    }
    .text {
      flex: 1;
      min-width: 0;
      display: grid;
      line-height: 1.2;
    }
    .label {
      font-size: 11px;
      color: var(--text-faint);
    }
    strong,
    .name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    strong {
      font-size: 14px;
    }
    .chev {
      color: var(--text-muted);
    }
    .menu {
      position: absolute;
      z-index: 60;
      top: calc(100% + 6px);
      left: 0;
      min-width: max(100%, 220px);
      max-height: min(360px, 60dvh);
      overflow-y: auto;
      padding: 6px;
      border-radius: 14px;
      background: color-mix(in srgb, var(--bg-elevated) 94%, transparent);
    }
    .item {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      border: none;
      border-radius: 9px;
      background: transparent;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
    }
    .item:hover {
      background: var(--glass-strong);
    }
    .name {
      flex: 1;
      min-width: 0;
      font-weight: 500;
    }
    .count {
      font-size: 12px;
      color: var(--text-faint);
      font-variant-numeric: tabular-nums;
    }
    .new {
      margin-top: 4px;
      padding-top: 10px;
      border-top: 1px solid var(--glass-border);
      border-radius: 0 0 9px 9px;
      font-weight: 600;
      color: var(--accent-b);
    }
  `,
})
export class SpaceSwitcher {
  protected readonly spaces = inject(SpaceContext);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Пользователь выбрал «New space». */
  readonly createRequested = output<void>();
  protected readonly open = signal(false);

  protected pick(id: string): void {
    this.spaces.select(id);
    this.open.set(false);
  }

  protected create(): void {
    this.open.set(false);
    this.createRequested.emit();
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node))
      this.open.set(false);
  }
}
