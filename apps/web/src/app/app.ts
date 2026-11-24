import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Icon } from './shared/icon';
import { Toasts } from './core/state/toasts';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <div class="toasts" aria-live="polite">
      @for (toast of toasts.items(); track toast.id) {
        <button
          type="button"
          class="toast glass"
          [attr.data-kind]="toast.kind"
          (click)="toasts.dismiss(toast.id)"
          animate.enter="enter-up"
          animate.leave="leave-fade"
        >
          <app-icon [name]="toast.kind === 'error' ? 'alert' : 'check'" [size]="18" />
          {{ toast.text }}
        </button>
      }
    </div>
  `,
  styles: `
    .toasts {
      position: fixed;
      right: 20px;
      bottom: 20px;
      z-index: 100;
      display: grid;
      gap: 10px;
      max-width: min(420px, calc(100vw - 32px));
    }
    .toast {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 12px 16px;
      border-radius: 14px;
      font-size: 14px;
      text-align: left;
      cursor: pointer;
      background: var(--bg-elevated);
    }
    .toast[data-kind='success'] app-icon {
      color: var(--ok);
    }
    .toast[data-kind='error'] app-icon {
      color: var(--sev-critical);
    }
    @media (max-width: 760px) {
      .toasts {
        right: 16px;
        left: 16px;
        bottom: 84px;
      }
    }
  `,
})
export class App {
  protected readonly toasts = inject(Toasts);
}
