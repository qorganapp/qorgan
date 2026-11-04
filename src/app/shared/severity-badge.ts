import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Severity } from '../core/api/api.types';
import { SEVERITY_LABEL } from './module-meta';

@Component({
  selector: 'app-severity-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="dot"></span>{{ label[severity()] }}`,
  host: { '[attr.data-severity]': 'severity()' },
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 3px 10px 3px 8px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.01em;
      color: var(--sev);
      background: color-mix(in srgb, var(--sev) 16%, transparent);
      white-space: nowrap;
    }
    .dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--sev);
      box-shadow: 0 0 8px var(--sev);
    }
    :host([data-severity='critical']) {
      --sev: var(--sev-critical);
    }
    :host([data-severity='high']) {
      --sev: var(--sev-high);
    }
    :host([data-severity='medium']) {
      --sev: var(--sev-medium);
    }
    :host([data-severity='low']) {
      --sev: var(--sev-low);
    }
    :host([data-severity='info']) {
      --sev: var(--sev-info);
    }
  `,
})
export class SeverityBadge {
  readonly severity = input.required<Severity>();
  protected readonly label = SEVERITY_LABEL;
}
