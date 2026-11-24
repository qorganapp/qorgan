import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Icon } from './icon';
import { SectionMeta } from './module-meta';

/** Иконка раздела в цветном «скруглённом квадрате», как у приложений macOS. */
@Component({
  selector: 'app-section-badge',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-icon [name]="meta().icon" [size]="iconSize()" [stroke]="2" />`,
  host: {
    '[style.--size.px]': 'size()',
    '[style.background]': 'background()',
  },
  styles: `
    :host {
      --size: 40px;
      width: var(--size);
      height: var(--size);
      border-radius: calc(var(--size) * 0.3);
      display: inline-grid;
      place-items: center;
      color: #fff;
      flex: none;
      box-shadow:
        inset 0 1px 0 rgb(255 255 255 / 0.35),
        0 6px 18px -6px var(--badge-glow, rgb(0 0 0 / 0.5));
    }
  `,
})
export class SectionBadge {
  readonly meta = input.required<SectionMeta>();
  readonly size = input(40);

  protected readonly iconSize = computed(() => Math.round(this.size() * 0.5));
  protected readonly background = computed(() => {
    const [a, b] = this.meta().gradient;
    return `linear-gradient(135deg, ${a}, ${b})`;
  });
}
