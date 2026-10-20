import { diffArrays } from 'diff';
import type { DiffRow } from './diff';
import { appendInlineText, localizeHighlightedText } from './inline-diff';

export type WordDiffStyle = 'plain' | 'color';
export type WordKind = 'context' | 'added' | 'deleted';
export interface WordSegment { text: string; kind: WordKind }

/** One display line of a merged old/new change; numbers come from the rows that start on it. */
export interface WordLine {
  kind: WordKind | 'modified';
  segments: WordSegment[];
  oldRow?: DiffRow;
  newRow?: DiffRow;
}

const MAX_WORD_LENGTH = 20_000;
const words = new Intl.Segmenter(undefined, { granularity: 'word' });

/** Words, punctuation and whitespace runs; newlines are always separate tokens. */
function tokens(text: string): string[] {
  const result: string[] = [];
  for (const { segment } of words.segment(text)) {
    for (const piece of segment.split(/(\n)/)) if (piece) result.push(piece);
  }
  return result;
}

const source = (rows: readonly DiffRow[]) => rows.map((row) => row.text + (row.noNewline ? '' : '\n')).join('');

/**
 * Display projection of one contiguous change, like `git diff --word-diff`:
 * unchanged words appear once, removed and added words inline. The rows, and
 * therefore navigation, statistics and restoration, stay line based.
 */
export function wordDiffLines(rows: readonly DiffRow[], deadline: number): { lines: WordLine[]; limited: boolean } {
  const removed = rows.filter((row) => row.kind === 'deleted');
  const added = rows.filter((row) => row.kind === 'added');
  const fallback = () => ({
    limited: true,
    lines: [
      ...removed.map((row): WordLine => ({ kind: 'deleted', segments: row.text ? [{ text: row.text, kind: 'deleted' }] : [], oldRow: row })),
      ...added.map((row): WordLine => ({ kind: 'added', segments: row.text ? [{ text: row.text, kind: 'added' }] : [], newRow: row })),
    ],
  });
  const before = source(removed), after = source(added);
  if (before.length + after.length > MAX_WORD_LENGTH || Date.now() >= deadline) return fallback();
  const parts = diffArrays(tokens(before), tokens(after), { timeout: Math.max(1, deadline - Date.now()) });
  if (!parts) return fallback();

  const lines: WordLine[] = [];
  let oldIndex = 0, newIndex = 0;
  let shownOld = -1, shownNew = -1;
  let line: { segments: WordSegment[]; kinds: Set<WordKind>; oldStart: number; newStart: number; hasOld: boolean; hasNew: boolean } | undefined;
  const open = () => (line ??= { segments: [], kinds: new Set(), oldStart: oldIndex, newStart: newIndex, hasOld: false, hasNew: false });
  const close = () => {
    if (!line) return;
    const kinds = [...line.kinds];
    const result: WordLine = { kind: kinds.length === 1 ? kinds[0]! : 'modified', segments: line.segments };
    // A row's number appears on the first display line that holds its content.
    if (line.hasOld && line.oldStart !== shownOld && removed[line.oldStart]) { result.oldRow = removed[line.oldStart]; shownOld = line.oldStart; }
    if (line.hasNew && line.newStart !== shownNew && added[line.newStart]) { result.newRow = added[line.newStart]; shownNew = line.newStart; }
    lines.push(result);
    line = undefined;
  };
  for (const part of parts) {
    const kind: WordKind = part.added ? 'added' : part.removed ? 'deleted' : 'context';
    for (const token of part.value) {
      const current = open();
      current.kinds.add(kind);
      if (kind !== 'added') current.hasOld = true;
      if (kind !== 'deleted') current.hasNew = true;
      if (token === '\n') {
        close();
        if (kind !== 'added') oldIndex++;
        if (kind !== 'deleted') newIndex++;
        continue;
      }
      const last = current.segments.at(-1);
      if (last?.kind === kind) last.text += token;
      else current.segments.push({ text: token, kind });
    }
  }
  close();
  return { lines, limited: false };
}

const MARKERS: Record<Exclude<WordKind, 'context'>, [string, string]> = { deleted: ['[-', '-]'], added: ['{+', '+}'] };

/** Plain style keeps git's textual markers, so they are part of copied text. */
export function renderWordLine(container: HTMLElement, line: WordLine, style: WordDiffStyle): void {
  container.replaceChildren();
  container.dataset.kind = line.kind;
  const document = container.ownerDocument;
  for (const segment of line.segments) {
    if (segment.kind === 'context') { container.append(document.createTextNode(segment.text)); continue; }
    const mark = container.createEl('mark');
    mark.className = `bmd-inline-change bmd-inline-${segment.kind} bmd-word-${segment.kind}`;
    if (style === 'plain') mark.createSpan({ cls: 'bmd-word-marker', text: MARKERS[segment.kind][0] });
    appendInlineText(mark, segment.text);
    if (style === 'plain') mark.createSpan({ cls: 'bmd-word-marker', text: MARKERS[segment.kind][1] });
  }
  container.toggleAttribute('data-source-empty', !line.segments.length);
  if (!line.segments.length) {
    container.append(document.createTextNode(' '));
    if (line.kind !== 'context') container.classList.add('bmd-empty-line');
  }
  localizeHighlightedText(container);
}
