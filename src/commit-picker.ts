import { FuzzySuggestModal, type App, type FuzzyMatch } from 'obsidian';
import type { BaselineTarget, FileCommit } from './git';
import { t } from './i18n';

type Choice = FileCommit | 'HEAD';

/** Searchable list of HEAD plus the commits that changed one document. */
export class CommitPickerModal extends FuzzySuggestModal<Choice> {
  constructor(app: App, private commits: readonly FileCommit[], private current: BaselineTarget | undefined, private choose: (commit: FileCommit | undefined) => void) {
    super(app);
    this.setPlaceholder(t('Search commit messages, hashes or authors…'));
  }

  getItems(): Choice[] { return ['HEAD', ...this.commits]; }

  getItemText(item: Choice): string {
    return item === 'HEAD' ? `HEAD ${t('HEAD (follows the latest commit)')}` : `${item.subject} ${item.hash} ${item.author} ${item.path}`;
  }

  renderSuggestion(match: FuzzyMatch<Choice>, el: HTMLElement): void {
    const item = match.item;
    el.addClass('bmd-commit-choice');
    const selected = item === 'HEAD' ? !this.current : item.hash === this.current?.hash;
    const title = el.createDiv({ cls: 'bmd-commit-subject', text: item === 'HEAD' ? t('HEAD (follows the latest commit)') : item.subject || t('(no message)') });
    if (selected) title.createSpan({ cls: 'bmd-commit-current', text: t('Current base') });
    if (item === 'HEAD') return;
    const date = new Date(item.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const meta = el.createDiv({ cls: 'bmd-commit-meta' });
    meta.createEl('code', { text: item.hash.slice(0, 8) });
    meta.append(` · ${date} · ${item.author}`);
    if (item !== this.commits[0] && item.path !== this.commits[0]?.path) meta.append(` · ${item.path}`);
  }

  onChooseItem(item: Choice): void { this.choose(item === 'HEAD' ? undefined : item); }
}
