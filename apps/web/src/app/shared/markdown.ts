/**
 * Минимальный и безопасный markdown для ответов агента: никакого innerHTML —
 * текст разбирается в блоки и выводится через шаблон Angular (всё экранируется).
 */
export type Inline = { kind: 'text' | 'code' | 'bold'; text: string };
export type Block =
  | { kind: 'p'; inlines: Inline[] }
  | { kind: 'h'; inlines: Inline[] }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'code'; text: string; lang: string };

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    const token = m[0];
    out.push(
      token.startsWith('`')
        ? { kind: 'code', text: token.slice(1, -1) }
        : // Код внутри жирного показываем просто жирным текстом, без обратных кавычек.
          { kind: 'bold', text: token.slice(2, -2).replace(/`/g, '') },
    );
    last = m.index + token.length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}

export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', inlines: parseInline(para.join(' ')) });
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```\s*([\w+-]*)/);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].startsWith('```'); i++) code.push(lines[i]);
      blocks.push({ kind: 'code', text: code.join('\n'), lang: fence[1] });
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.*)/);
    if (heading) {
      flush();
      blocks.push({ kind: 'h', inlines: parseInline(heading[1]) });
      continue;
    }
    const item = line.match(/^\s*(?:([-*])|(\d+)[.)])\s+(.*)/);
    if (item) {
      flush();
      const ordered = !!item[2];
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === 'list' && prev.ordered === ordered) prev.items.push(parseInline(item[3]));
      else blocks.push({ kind: 'list', ordered, items: [parseInline(item[3])] });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}
