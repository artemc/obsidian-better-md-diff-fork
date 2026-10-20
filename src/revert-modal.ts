import { Modal, Notice, Setting, requireApiVersion, type App } from 'obsidian';
import { changeRange, type LineChange } from './diff';
import { t } from './i18n';

export class RevertChangeModal extends Modal {
  private controller = new AbortController();

  constructor(app: App, private path: string, private change: LineChange, private confirm: (signal: AbortSignal) => Promise<void>, private base = 'HEAD') { super(app); }

  onOpen(): void {
    this.titleEl.setText(t('Restore this change?'));
    this.contentEl.createEl('p', { cls: 'bmd-revert-path', text: this.path });
    this.contentEl.createEl('p', { cls: 'bmd-revert-scope', text: changeRange(this.change, this.base) });
    this.contentEl.createEl('p', { text: t('Restore only this change: remove {added} added lines and recover {deleted} deleted lines. All other changes stay untouched.', { added: this.change.added, deleted: this.change.deleted }) });
    const previews = this.contentEl.createDiv({ cls: 'bmd-revert-previews' });
    this.preview(previews, 'Current content', 'added');
    this.preview(previews, 'After restoration ({base})', 'deleted');
    this.contentEl.createEl('p', { text: t('No staging, commits, or file deletion. The document must be open in editing mode. Undo in the source editor with Ctrl/Cmd+Z.') });
    new Setting(this.contentEl)
      .addButton((button) => button.setButtonText(t('Cancel')).onClick(() => this.close()))
      .addButton((button) => {
        if (requireApiVersion('1.13.0')) button.setDestructive().setCta();
        else button.buttonEl.addClass('mod-warning');
        button.setButtonText(t('Confirm restoration')).onClick(async () => {
          button.setDisabled(true);
          try {
            await this.confirm(this.controller.signal);
            this.close();
          } catch (error) {
            if (!this.controller.signal.aborted) new Notice(error instanceof Error ? error.message : t('Restoration failed.'));
            this.close();
          }
        });
      });
  }

  private preview(parent: HTMLElement, heading: string, kind: 'added' | 'deleted'): void {
    const rows = this.change.rows.filter((row) => row.kind === kind);
    const section = parent.createDiv();
    section.createEl('h3', { text: t(heading, { base: this.base }) });
    // Bound preview layout independently of the accepted document size; never render Markdown/HTML.
    const shown = rows.slice(0, 40);
    const content = shown.map((row) => row.text.slice(0, 400) + (row.text.length > 400 ? '…' : '') + (row.noNewline ? t(' ⏎ No final newline') : '')).join('\n');
    section.createEl('pre', { cls: `bmd-revert-preview bmd-revert-preview--${kind}`, text: rows.length ? content : t('No content') });
    if (rows.length > shown.length || shown.some((row) => row.text.length > 400)) section.createEl('p', { cls: 'bmd-hint', text: t('Preview truncated. Restoration still applies to the full range shown above.') });
  }

  onClose(): void { this.controller.abort(); this.contentEl.empty(); }
}
