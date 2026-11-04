import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Контурные иконки 24×24 (stroke). Только пути — без innerHTML и санитайзера. */
const PATHS = {
  sweep: [
    'M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z',
    'M19 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
    'M5 3v4',
    'M3 5h4',
  ],
  package: ['M21 8l-9-5-9 5 9 5 9-5z', 'M3 8v8l9 5 9-5V8', 'M12 13v8', 'M7.5 5.5l9 5'],
  code: ['M8 7l-5 5 5 5', 'M16 7l5 5-5 5', 'M14 4l-4 16'],
  key: [
    'M12 15.5a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0z',
    'M10.7 12.3L21 2',
    'M17 6l3 3',
    'M14.5 8.5l2 2',
  ],
  server: ['M4 4h16v6H4z', 'M4 14h16v6H4z', 'M8 7h.01', 'M8 17h.01', 'M12 7h4', 'M12 17h4'],
  repo: [
    'M6 3v12',
    'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M18 9a9 9 0 0 1-9 9',
  ],
  shield: ['M12 2l8 3v6c0 5-3.4 9.4-8 11-4.6-1.6-8-6-8-11V5z', 'M9 12l2 2 4-4'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  alert: ['M12 3.5l9.5 17h-19z', 'M12 10v4.5', 'M12 17.5h.01'],
  chevronRight: ['M9 6l6 6-6 6'],
  chevronDown: ['M6 9l6 6 6-6'],
  eyeOff: [
    'M3 3l18 18',
    'M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 4.5 10 6-.4.7-1.4 2-2.9 3.3',
    'M6.6 7.6C4.6 8.9 3.3 10.7 2 12c1 1.5 5 6 10 6 1.5 0 2.9-.4 4.1-1',
    'M9.9 10.1a3 3 0 0 0 4 4',
  ],
  eye: [
    'M2 12c1-1.5 5-6 10-6s9 4.5 10 6c-1 1.5-5 6-10 6S3 13.5 2 12z',
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  ],
  refresh: [
    'M20 11a8 8 0 0 0-14.6-4.5L4 8',
    'M4 4v4h4',
    'M4 13a8 8 0 0 0 14.6 4.5L20 16',
    'M20 20v-4h-4',
  ],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  logout: ['M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3', 'M10 17l5-5-5-5', 'M15 12H3'],
  lock: ['M6 11h12v10H6z', 'M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11'],
  file: ['M6 2h8l5 5v15H6z', 'M14 2v5h5'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 7v5l3 2'],
  branch: [
    'M6 3v12',
    'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M18 9c0 6-12 3-12 9',
  ],
  plus: ['M12 5v14', 'M5 12h14'],
  spinner: ['M12 3a9 9 0 1 0 9 9'],
  bot: [
    'M12 3v3',
    'M5 9a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3z',
    'M9.5 12.5h.01',
    'M14.5 12.5h.01',
    'M2 12v2',
    'M22 12v2',
  ],
  message: ['M4 5h16v11H9l-5 4z'],
  send: ['M4 12l16-8-6 16-2.5-6.5z', 'M11.5 13.5L20 4'],
  pullRequest: [
    'M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M6 9v6',
    'M18 15V8a3 3 0 0 0-3-3h-4',
    'M13 2.5L10.5 5 13 7.5',
  ],
  verified: [
    'M12 2l2.4 2.1 3.2-.4.9 3.1 2.8 1.6-1.2 3 1.2 3-2.8 1.6-.9 3.1-3.2-.4L12 22l-2.4-2.1-3.2.4-.9-3.1-2.8-1.6 1.2-3-1.2-3 2.8-1.6.9-3.1 3.2.4z',
    'M8.5 12l2.5 2.5 4.5-5',
  ],
} as const;

/** Залитые иконки (бренды). */
const FILLED = {
  github: [
    'M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.76 2.69 1.25 3.35.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.18-3.1-.12-.29-.51-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.62 1.59.23 2.76.11 3.05.74.81 1.18 1.84 1.18 3.1 0 4.43-2.69 5.41-5.26 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5z',
  ],
} as const;

export type IconName = keyof typeof PATHS | keyof typeof FILLED;

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      viewBox="0 0 24 24"
      [attr.width]="size()"
      [attr.height]="size()"
      [attr.fill]="filled() ? 'currentColor' : 'none'"
      [attr.stroke]="filled() ? 'none' : 'currentColor'"
      [attr.stroke-width]="stroke()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @for (d of paths(); track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
    svg {
      display: block;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(20);
  readonly stroke = input(1.8);

  protected readonly filled = computed(() => this.name() in FILLED);
  protected readonly paths = computed<readonly string[]>(() => {
    const name = this.name();
    return name in FILLED ? FILLED[name as keyof typeof FILLED] : PATHS[name as keyof typeof PATHS];
  });
}
