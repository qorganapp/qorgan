import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { parseMarkdown } from './markdown';

@Component({
  selector: 'app-markdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-template #inline let-inlines>
      @for (part of inlines; track $index) {
        @switch (part.kind) {
          @case ('code') {
            <code>{{ part.text }}</code>
          }
          @case ('bold') {
            <strong>{{ part.text }}</strong>
          }
          @default {
            {{ part.text }}
          }
        }
      }
    </ng-template>

    @for (block of blocks(); track $index) {
      @switch (block.kind) {
        @case ('code') {
          <pre><code>{{ block.text }}</code></pre>
        }
        @case ('h') {
          <p class="h">
            <ng-container *ngTemplateOutlet="inline; context: { $implicit: block.inlines }" />
          </p>
        }
        @case ('list') {
          @if (block.ordered) {
            <ol>
              @for (item of block.items; track $index) {
                <li><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }" /></li>
              }
            </ol>
          } @else {
            <ul>
              @for (item of block.items; track $index) {
                <li><ng-container *ngTemplateOutlet="inline; context: { $implicit: item }" /></li>
              }
            </ul>
          }
        }
        @default {
          <p><ng-container *ngTemplateOutlet="inline; context: { $implicit: block.inlines }" /></p>
        }
      }
    }
  `,
  imports: [NgTemplateOutlet],
  styles: `
    :host {
      display: block;
      overflow-wrap: anywhere;
    }
    p,
    ul,
    ol,
    pre {
      margin: 0 0 10px;
    }
    :host > :last-child {
      margin-bottom: 0;
    }
    ul,
    ol {
      padding-left: 20px;
    }
    li {
      margin: 3px 0;
    }
    .h {
      font-weight: 700;
    }
    code {
      font-family: var(--mono);
      font-size: 0.86em;
      padding: 1px 5px;
      border-radius: 6px;
      background: var(--glass-strong);
    }
    pre {
      padding: 12px 14px;
      border-radius: 12px;
      overflow-x: auto;
      background: rgb(0 0 0 / 0.35);
      border: 1px solid var(--glass-border);
    }
    pre code {
      padding: 0;
      background: none;
      font-size: 12.5px;
      line-height: 1.6;
    }
  `,
})
export class MarkdownView {
  readonly text = input.required<string>();
  protected readonly blocks = computed(() => parseMarkdown(this.text()));
}
