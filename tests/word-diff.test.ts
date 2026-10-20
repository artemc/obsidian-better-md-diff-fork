// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { computeDiff } from '../src/diff';
import { wordDiffLines, renderWordLine, type WordLine } from '../src/word-diff';
import { selectedDiffText } from '../src/diff-copy';
import { installObsidianDom } from './helpers/obsidian-dom';

installObsidianDom(document);
const later = () => Date.now() + 10_000;
function lines(before: string, after: string): WordLine[] {
  const change = computeDiff(before, after).changes[0]!;
  return wordDiffLines(change.rows, later()).lines;
}
const show = (line: WordLine) => line.segments.map(({ text, kind }) => kind === 'deleted' ? `[-${text}-]` : kind === 'added' ? `{+${text}+}` : text).join('');
const numbers = (line: WordLine) => [line.oldRow?.oldLine ?? null, line.newRow?.newLine ?? null];

describe('word diff projection', () => {
  it('merges a replaced word into one line like git --word-diff', () => {
    const result = lines('intro\nthe quick brown fox\nend\n', 'intro\nthe slow brown fox\nend\n');
    expect(result.map(show)).toEqual(['the [-quick-]{+slow+} brown fox']);
    expect(result.map(numbers)).toEqual([[2, 2]]);
    expect(result[0]!.kind).toBe('modified');
  });

  it('splits Cyrillic, CJK and punctuation into words instead of whitespace runs', () => {
    expect(lines('Привет, мир!\n', 'Привет, друг!\n').map(show)).toEqual(['Привет, [-мир-]{+друг+}!']);
    expect(lines('中文测试文本\n', '中文验证文本\n').map(show)).toEqual(['中文[-测试-]{+验证+}文本']);
  });

  it('keeps line structure and numbers for multi-line, joined and removed lines', () => {
    expect(lines('a b\nc d\n', 'a x\nc y\n').map(show)).toEqual(['a [-b-]{+x+}', 'c [-d-]{+y+}']);
    const joined = lines('one\ntwo\n', 'one two\n');
    expect(joined.map(show)).toEqual(['one', '{+ +}two']);
    expect(joined.map(numbers)).toEqual([[1, 1], [2, null]]);
    const removed = lines('keep\nold\nkeep2\n', 'keep\nkeep2\n');
    expect(removed.map(show)).toEqual(['[-old-]']);
    expect(removed[0]).toMatchObject({ kind: 'deleted' });
    const blank = lines('a\n\nb\n', 'a\nb\n');
    expect(blank).toHaveLength(1);
    expect(blank[0]).toMatchObject({ kind: 'deleted', segments: [] });
    expect(numbers(blank[0]!)).toEqual([2, null]);
  });

  it('assigns every changed row to exactly one numbered display line', () => {
    const change = computeDiff('alpha beta\ngamma\ndelta\n', 'alpha\nbeta gamma\nepsilon\ndelta\n').changes[0]!;
    const { lines: result } = wordDiffLines(change.rows, later());
    const numbered = result.flatMap((line) => [line.oldRow, line.newRow]).filter(Boolean);
    expect(new Set(numbered).size).toBe(change.rows.length);
  });

  it('falls back to whole lines when the budget is exhausted', () => {
    const change = computeDiff('a b\n', 'a c\n').changes[0]!;
    const result = wordDiffLines(change.rows, Date.now() - 1);
    expect(result.limited).toBe(true);
    expect(result.lines.map(show)).toEqual(['[-a b-]', '{+a c+}']);
  });

  it('renders plain markers as copyable text and color style without markers', () => {
    const [line] = lines('the quick fox\n', 'the slow fox\n');
    const body = document.createElement('div');
    const plain = body.createEl('code', { cls: 'bmd-row-text' });
    renderWordLine(plain, line!, 'plain');
    expect(plain.textContent).toBe('the [-quick-]{+slow+} fox');
    expect(plain.querySelector('mark.bmd-inline-deleted')?.getAttribute('title')).toBe('Deleted text');
    document.body.append(body);
    const range = document.createRange();
    range.selectNodeContents(plain);
    expect(selectedDiffText(body, range)).toBe('the [-quick-]{+slow+} fox');
    const color = body.createEl('code', { cls: 'bmd-row-text' });
    renderWordLine(color, line!, 'color');
    expect(color.textContent).toBe('the quickslow fox');
    expect(Array.from(color.querySelectorAll('mark'), (mark) => mark.className)).toEqual([
      'bmd-inline-change bmd-inline-deleted bmd-word-deleted', 'bmd-inline-change bmd-inline-added bmd-word-added',
    ]);
    body.remove();
  });
});
