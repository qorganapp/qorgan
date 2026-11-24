import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { SpaceEdge, SpaceEdgeKind, SpaceGraph, apiErrorMessage } from '../../core/api/api.types';
import { QorganApi } from '../../core/api/qorgan-api';
import { Toasts } from '../../core/state/toasts';
import { Icon } from '../../shared/icon';
import { TimeAgoPipe } from '../../shared/time-ago.pipe';

const POLL_MS = 2000;
const W = 640;
const H = 380;
/** Двум репозиториям хватает одной строки: высокая пустая область ни к чему. */
const H_PAIR = 150;
const NODE_H = 34;

const KIND_LABEL: Record<SpaceEdgeKind, string> = {
  depends_on: 'Uses a package from',
  calls: 'Calls at runtime',
  shared_dependency: 'Shares dependencies with',
};

interface MapNode {
  id: string;
  name: string;
  fullName: string;
  x: number;
  y: number;
  w: number;
}

interface MapEdge {
  index: number;
  edge: SpaceEdge;
  from: MapNode;
  to: MapNode;
  path: string;
}

/**
 * Карта связей между репозиториями пространства. Вид связи кодируется рисунком
 * линии и подписью, а не цветом; цвет оставлен только для уязвимых зависимостей.
 * Под картой — тот же список текстом: он же служит панелью с доказательствами.
 */
@Component({
  selector: 'app-space-map',
  imports: [Icon, TimeAgoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './space-map.html',
  styleUrl: './space-map.scss',
  host: { class: 'glass' },
})
export class SpaceMap {
  private readonly api = inject(QorganApi);
  private readonly toasts = inject(Toasts);

  readonly spaceId = input.required<string>();
  readonly repositoryCount = input(0);
  /** Построение закончилось — у агента появилась запись в журнале. */
  readonly built = output<void>();

  protected readonly graph = signal<SpaceGraph | null>(null);
  protected readonly starting = signal(false);
  protected readonly selected = signal<number | null>(null);
  protected readonly kindLabel = KIND_LABEL;
  private readonly height = computed(() => ((this.graph()?.nodes.length ?? 0) <= 2 ? H_PAIR : H));
  protected readonly viewBox = computed(() => `0 0 ${W} ${this.height()}`);
  protected readonly nodeH = NODE_H;

  protected readonly running = computed(() => this.graph()?.status === 'running');

  protected readonly nodes = computed<MapNode[]>(() => {
    const nodes = this.graph()?.nodes ?? [];
    const n = nodes.length;
    const h = this.height();
    return nodes.map((node, i) => {
      // По эллипсу, начиная сверху; два репозитория — слева и справа.
      const angle = n === 2 ? Math.PI * i : -Math.PI / 2 + (2 * Math.PI * i) / n;
      const name = node.fullName.split('/').pop() ?? node.fullName;
      const label = name.length > 22 ? `${name.slice(0, 21)}…` : name;
      return {
        id: node.repositoryId,
        name: label,
        fullName: node.fullName,
        x: W / 2 + (n === 1 ? 0 : Math.cos(angle) * (W / 2 - 110)),
        y: h / 2 + (n === 1 ? 0 : Math.sin(angle) * (h / 2 - 50)),
        w: Math.max(72, label.length * 7.6 + 28),
      };
    });
  });

  protected readonly edges = computed<MapEdge[]>(() => {
    const byId = new Map(this.nodes().map((n) => [n.id, n]));
    const perPair = new Map<string, number>();
    const out: MapEdge[] = [];
    (this.graph()?.edges ?? []).forEach((edge, index) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      // Репозиторий могли убрать из пространства после построения карты.
      if (!from || !to) return;
      const pair = [edge.from, edge.to].sort().join('|');
      const nth = perPair.get(pair) ?? 0;
      perPair.set(pair, nth + 1);
      out.push({ index, edge, from, to, path: curve(from, to, nth) });
    });
    return out;
  });

  protected readonly active = computed(
    () => this.edges().find((e) => e.index === this.selected()) ?? null,
  );

  private poll: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const id = this.spaceId();
      untracked(() => {
        this.stop();
        this.graph.set(null);
        this.selected.set(null);
        this.load(id);
      });
    });
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  protected build(): void {
    const id = this.spaceId();
    if (this.starting() || this.running()) return;
    this.starting.set(true);
    this.api.refreshSpaceGraph(id).subscribe({
      next: (graph) => {
        this.starting.set(false);
        this.apply(id, graph);
      },
      error: (e: unknown) => {
        this.starting.set(false);
        this.toasts.show(apiErrorMessage(e, 'Could not start building the map'), 'error');
      },
    });
  }

  protected select(index: number): void {
    this.selected.update((current) => (current === index ? null : index));
  }

  protected readonly touches = (edge: MapEdge, node: MapNode) =>
    edge.from.id === node.id || edge.to.id === node.id;

  private load(id: string): void {
    this.api.spaceGraph(id).subscribe({
      next: (graph) => this.apply(id, graph),
      error: () => this.toasts.show('Could not load the map', 'error'),
    });
  }

  private apply(id: string, graph: SpaceGraph): void {
    // Пока шёл запрос, могли переключить пространство.
    if (this.spaceId() !== id) return;
    const wasRunning = this.running();
    this.graph.set(graph);
    this.stop();
    if (graph.status === 'running') {
      this.poll = setTimeout(() => this.load(id), POLL_MS);
    } else if (wasRunning) {
      this.built.emit();
    }
  }

  private stop(): void {
    if (this.poll) clearTimeout(this.poll);
    this.poll = null;
  }
}

/** Дуга между узлами; несколько связей одной пары расходятся веером. */
function curve(a: MapNode, b: MapNode, nth: number): string {
  // Изгиб считаем от упорядоченной пары, чтобы A→B и B→A не легли друг на друга.
  const [p, q] = a.id < b.id ? [a, b] : [b, a];
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const len = Math.hypot(dx, dy) || 1;
  const bend = 26 + nth * 30;
  const cx = (a.x + b.x) / 2 + (-dy / len) * bend;
  const cy = (a.y + b.y) / 2 + (dx / len) * bend;
  const start = edgePoint(a, cx, cy);
  const end = edgePoint(b, cx, cy);
  return `M${start.x.toFixed(1)} ${start.y.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

/** Точка на границе узла в сторону (tx, ty): линия не заходит под подпись. */
function edgePoint(node: MapNode, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - node.x;
  const dy = ty - node.y;
  const hw = node.w / 2 + 4;
  const hh = NODE_H / 2 + 4;
  const scale = Math.min(hw / Math.abs(dx || 1e-6), hh / Math.abs(dy || 1e-6));
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}
