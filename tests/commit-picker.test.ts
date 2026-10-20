// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import { CommitPickerModal } from '../src/commit-picker';
import { installObsidianDom } from './helpers/obsidian-dom';

installObsidianDom(document);
const commits = [
  { hash: 'a'.repeat(40), path: 'notes/new.md', time: Date.UTC(2026, 9, 1), author: 'Ann', subject: 'Rename' },
  { hash: 'b'.repeat(40), path: 'notes/old.md', time: Date.UTC(2026, 8, 1), author: 'Bo', subject: '' },
];
const render = (modal: CommitPickerModal, index: number) => {
  const el = document.createElement('div');
  modal.renderSuggestion({ item: modal.getItems()[index]!, match: { score: 0, matches: [] } }, el);
  return el;
};

describe('commit picker', () => {
  it('offers HEAD first, marks the current base and returns the chosen commit', () => {
    const choose = vi.fn();
    const modal = new CommitPickerModal({} as App, commits, commits[1], choose);
    expect(modal.getItems()).toEqual(['HEAD', ...commits]);
    expect(modal.getItemText(commits[0]!)).toContain('Ann');
    expect(render(modal, 0).querySelector('.bmd-commit-current')).toBeNull();
    const old = render(modal, 2);
    expect(old.querySelector('.bmd-commit-subject')?.textContent).toBe('(no message)Current base');
    expect(old.querySelector('.bmd-commit-meta code')?.textContent).toBe('bbbbbbbb');
    expect(old.querySelector('.bmd-commit-meta')?.textContent).toContain('notes/old.md');
    expect(render(modal, 1).querySelector('.bmd-commit-meta')?.textContent).not.toContain('notes/new.md');
    modal.onChooseItem(commits[0]!);
    expect(choose).toHaveBeenLastCalledWith(commits[0]);
    modal.onChooseItem('HEAD');
    expect(choose).toHaveBeenLastCalledWith(undefined);
  });
});
