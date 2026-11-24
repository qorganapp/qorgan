import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type OrbState = 'idle' | 'scanning' | 'done';

/**
 * Центральная «сфера» Full Sweep: дышит в покое, вращается и пускает волны во время скана,
 * показывает кольцо прогресса. Содержимое центра — через ng-content (кнопка Scan, счётчик).
 */
@Component({
  selector: 'app-scan-orb',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="wave"></div>
    <div class="wave w2"></div>
    <div class="halo"></div>
    <div class="ring"></div>
    <svg class="progress" viewBox="0 0 100 100" aria-hidden="true">
      <circle class="track" cx="50" cy="50" r="47" />
      <circle class="bar" cx="50" cy="50" r="47" [attr.stroke-dashoffset]="dashOffset()" />
    </svg>
    <div class="core"><ng-content /></div>
  `,
  host: { '[attr.data-state]': 'state()', '[style.--orb-size.px]': 'size()' },
  styleUrl: './scan-orb.scss',
})
export class ScanOrb {
  readonly state = input<OrbState>('idle');
  /** 0..1 */
  readonly progress = input(0);
  readonly size = input(260);

  private readonly circumference = 2 * Math.PI * 47;
  protected readonly dashOffset = computed(
    () => this.circumference * (1 - Math.min(1, Math.max(0, this.progress()))),
  );
}
