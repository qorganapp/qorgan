import { parseInline, parseMarkdown } from './markdown';

describe('parseMarkdown', () => {
  it('parses paragraphs, lists, headings and code fences', () => {
    const blocks = parseMarkdown(
      '## Plan\n\nFirst **revoke** the `token`.\n\n1. one\n2. two\n\n- a\n\n```python\nprint(1)\n```',
    );
    expect(blocks.map((b) => b.kind)).toEqual(['h', 'p', 'list', 'list', 'code']);
    expect(blocks[1]).toEqual({
      kind: 'p',
      inlines: [
        { kind: 'text', text: 'First ' },
        { kind: 'bold', text: 'revoke' },
        { kind: 'text', text: ' the ' },
        { kind: 'code', text: 'token' },
        { kind: 'text', text: '.' },
      ],
    });
    expect(blocks[2]).toMatchObject({ kind: 'list', ordered: true });
    expect(blocks[4]).toEqual({ kind: 'code', text: 'print(1)', lang: 'python' });
  });

  it('keeps HTML as plain text (rendered escaped by Angular)', () => {
    const [block] = parseMarkdown('<img src=x onerror=alert(1)>');
    expect(block).toEqual({
      kind: 'p',
      inlines: [{ kind: 'text', text: '<img src=x onerror=alert(1)>' }],
    });
    expect(parseInline('a `<b>` c')[1]).toEqual({ kind: 'code', text: '<b>' });
  });
});
