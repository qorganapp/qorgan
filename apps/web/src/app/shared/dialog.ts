import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  viewChild,
} from '@angular/core';
import { Icon } from './icon';

/**
 * Модальное окно на нативном <dialog>: фокус, Escape и затемнение даёт браузер.
 * Открытием управляет родитель через `open`; о закрытии сообщает `closed`.
 */
@Component({
  selector: 'app-dialog',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog #el (close)="closed.emit()" (click)="onBackdrop($event)" [attr.aria-label]="title()">
      <div class="panel glass">
        <header>
          <h2>{{ title() }}</h2>
          <button class="btn btn-ghost btn-sm close" type="button" (click)="el.close()">
            <app-icon name="x" [size]="16" /><span class="sr-only">Close</span>
          </button>
        </header>
        <ng-content />
      </div>
    </dialog>
  `,
  styles: `
    dialog {
      width: min(520px, calc(100vw - 32px));
      max-height: calc(100dvh - 48px);
      padding: 0;
      border: none;
      background: transparent;
      color: var(--text);
      overflow: visible;
    }
    dialog[open] {
      animation: dialog-in 0.28s var(--ease-out) both;
    }
    dialog::backdrop {
      background: rgb(6 5 14 / 0.6);
      backdrop-filter: blur(6px);
    }
    @keyframes dialog-in {
      from {
        opacity: 0;
        transform: translateY(10px) scale(0.98);
      }
    }
    .panel {
      display: flex;
      flex-direction: column;
      max-height: calc(100dvh - 48px);
      padding: 22px;
      background: color-mix(in srgb, var(--bg-elevated) 92%, transparent);
    }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }
    h2 {
      font-size: 20px;
    }
    .close {
      width: 32px;
      padding: 0;
    }
  `,
})
export class Dialog {
  readonly title = input.required<string>();
  readonly open = input(false);
  readonly closed = output<void>();

  private readonly el = viewChild.required<ElementRef<HTMLDialogElement>>('el');

  constructor() {
    effect(() => {
      const dialog = this.el().nativeElement;
      if (this.open() && !dialog.open) dialog.showModal();
      else if (!this.open() && dialog.open) dialog.close();
    });
  }

  /** Клик по затемнению (сам <dialog>, а не его содержимое) закрывает окно. */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === this.el().nativeElement) this.el().nativeElement.close();
  }
}
