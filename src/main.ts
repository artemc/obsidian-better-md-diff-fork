import { editorInfoField, FileSystemAdapter, MarkdownView, Notice, Plugin, TFile, type Command } from 'obsidian';
import { editorDiffExtension } from './editor';
import { baselineName, GitBaselineReader, readGitBaseline, type BaselineRead, type FileCommit } from './git';
import { CommitPickerModal } from './commit-picker';
import { DIFF_ICON, DIFF_VIEW, DiffPanel } from './panel';
import { DiffSettingTab } from './settings';
import { DEFAULT_SETTINGS, normalizeSettings, type DiffSettings } from './options';
import { DiffStore, type ReadyDiffState } from './store';
import { normalizeText, type LineChange } from './diff';
import { executeChangeRevert } from './revert';
import { RevertChangeModal } from './revert-modal';
import { revealSourceLine } from './source-navigation';
import { LocalizedError, t } from './i18n';

export default class BetterMdDiff extends Plugin {
  settings: DiffSettings = { ...DEFAULT_SETTINGS };
  store!: DiffStore;
  private selectedPath?: string;
  private timers = new Map<string, number>();
  private trackedPaths = new Set<string>();
  private contentReads = new Map<string, symbol>();
  private stopped = false;
  private refreshing = false;
  private refreshQueued = false;
  private reader!: GitBaselineReader;
  private status!: HTMLElement;
  private revertModal?: RevertChangeModal;
  private gitPollTimer?: number;
  private appliedReadSettings = { ...DEFAULT_SETTINGS };
  /** Per-document comparison commit for this session; absent means HEAD. */
  private targets = new Map<string, FileCommit>();

  async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.appliedReadSettings = { ...this.settings };
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      new Notice(`${this.manifest.name} supports local repositories on desktop only.`);
      return;
    }
    this.reader = new GitBaselineReader(adapter.getBasePath(), this.settings.gitPath, this.settings);
    this.register(() => this.reader.dispose());
    this.store = new DiffStore((path) => this.reader.read(path, this.targets.get(path)), this.settings.contextLines, this.settings);
    this.register(() => this.store.dispose());
    this.registerView(DIFF_VIEW, (leaf) => new DiffPanel(leaf, {
      store: this.store,
      settings: () => this.settings,
      currentPath: () => this.selectedPath,
      refresh: (path) => this.refresh(path, true),
      navigate: (path, line, focus, center) => { void this.navigate(path, line, focus, center); },
      revert: (snapshot, change) => this.confirmRevert(snapshot, change),
      chooseBaseline: (path) => { void this.chooseBaseline(path); },
      resetBaseline: (path) => this.setBaseline(path, undefined),
    }));
    this.registerEditorExtension(editorDiffExtension({
      store: this.store,
      getPath: (view) => view.state.field(editorInfoField, false)?.file?.path,
      enabled: () => this.settings.showMarkers,
      open: (path, line, preferDeletion) => { void this.openDiff(path, line, preferDeletion); },
      select: (path, line) => this.followSelection(path, line),
    }));
    this.addSettingTab(new DiffSettingTab(this.app, this));
    this.addRibbonIcon(DIFF_ICON, 'View the current document’s Git diff', () => { void this.openDiff(); });
    const addCommand = (name: string, command: Omit<Command, 'name'>) => { this.addCommand({ ...command, name }); };
    addCommand('Compare the current document with HEAD', { id: 'open-diff', checkCallback: (checking) => {
      if (!this.selectedPath || this.stopped) return false;
      if (!checking) void this.openDiff();
      return true;
    } });
    addCommand('Choose a commit to compare with', { id: 'choose-baseline', checkCallback: (checking) => {
      if (!this.selectedPath || this.stopped) return false;
      if (!checking) void this.chooseBaseline(this.selectedPath);
      return true;
    } });
    addCommand('Refresh Git diff', { id: 'refresh-diff', callback: () => { void this.refreshOpenFiles(); } });
    for (const direction of [-1, 1] as const) addCommand(direction === 1 ? 'Go to next change' : 'Go to previous change', {
      id: direction === 1 ? 'next-change' : 'previous-change',
      checkCallback: (checking) => {
        const state = this.selectedPath ? this.store.get(this.selectedPath) : undefined;
        if (this.stopped || state?.status !== 'ready' || !state.diff.hunks.length) return false;
        if (!checking) void this.moveDiff(direction);
        return true;
      },
    });
    addCommand('Toggle editor diff markers', { id: 'toggle-markers', callback: () => {
      this.settings.showMarkers = !this.settings.showMarkers;
      void this.applySettings();
    } });
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && file.extension.toLowerCase() === 'md') {
        menu.addItem((item) => item.setTitle(t('View Git diff')).setIcon(DIFF_ICON).onClick(() => { void this.openDiff(file.path); }));
        menu.addItem((item) => item.setTitle(t('Compare with an earlier commit')).setIcon('history').onClick(() => { void this.chooseBaseline(file.path); }));
      }
    }));
    this.status = this.addStatusBarItem();
    this.status.addClass('bmd-status');
    this.status.setAttribute('role', 'button');
    this.status.setAttribute('tabindex', '0');
    this.registerDomEvent(this.status, 'click', () => { void this.openDiff(); });
    this.registerDomEvent(this.status, 'keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void this.openDiff(); }
    });
    this.register(this.store.subscribe((path) => { if (path === this.selectedPath) this.updateStatus(); }));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.followActiveFile()));
    this.registerEvent(this.app.workspace.on('file-open', () => this.followActiveFile()));
    this.registerEvent(this.app.workspace.on('layout-change', () => { void this.refreshOpenFiles(); }));
    this.registerEvent(this.app.workspace.on('editor-change', (_editor, info) => {
      if (info.file?.extension.toLowerCase() === 'md') this.schedule(info.file.path);
    }));
    this.registerEvent(this.app.vault.on('modify', (file) => {
      if (file instanceof TFile && file.extension.toLowerCase() === 'md' && this.trackedPaths.has(file.path)) this.schedule(file.path);
    }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      if (this.selectedPath === oldPath) this.setSelected(file instanceof TFile && file.extension.toLowerCase() === 'md' ? file.path : undefined);
      // The target names the file inside that commit, so it survives a vault rename.
      const target = this.targets.get(oldPath);
      this.targets.delete(oldPath);
      if (target && file instanceof TFile) this.targets.set(file.path, target);
      this.forget(oldPath);
      void this.refreshOpenFiles();
    }));
    this.registerEvent(this.app.vault.on('delete', (file) => {
      if (this.selectedPath === file.path) this.setSelected(undefined);
      this.targets.delete(file.path);
      this.forget(file.path);
    }));
    this.restartPolling();
    this.registerDomEvent(window, 'focus', () => { void this.refreshOpenFiles(); });
    this.app.workspace.onLayoutReady(() => {
      if (this.stopped) return;
      if (!this.selectedPath) {
        const recent = this.app.workspace.getMostRecentLeaf()?.view;
        if (recent instanceof MarkdownView && recent.file?.extension.toLowerCase() === 'md') this.setSelected(recent.file.path);
      }
      this.followActiveFile();
      void this.refreshOpenFiles();
    });
  }

  private followActiveFile(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view) return; // Keep the target when focus moves to the diff panel or settings.
    this.setSelected(view.file?.extension.toLowerCase() === 'md' ? view.file.path : undefined);
    if (this.selectedPath) void this.refresh(this.selectedPath, true);
  }

  private followSelection(path: string, line: number): void {
    if (this.stopped || !this.settings.followEditor || !path.toLowerCase().endsWith('.md')) return;
    const panels = this.app.workspace.getLeavesOfType(DIFF_VIEW);
    if (!panels.length) return; // Cursor motion must never open or focus a panel.
    this.setSelected(path);
    for (const leaf of panels) if (leaf.view instanceof DiffPanel) leaf.view.showLine(line);
  }

  private setSelected(path: string | undefined): void {
    if (path !== this.selectedPath) {
      this.selectedPath = path;
      this.app.workspace.getLeavesOfType(DIFF_VIEW).forEach((leaf) => {
        if (leaf.view instanceof DiffPanel) leaf.view.setFile(path);
      });
    }
    this.updateStatus();
  }

  private schedule(path: string): void {
    if (this.stopped) return;
    window.clearTimeout(this.timers.get(path));
    this.timers.set(path, window.setTimeout(() => {
      this.timers.delete(path);
      void this.refresh(path);
    }, this.settings.editDelayMs));
  }

  private async currentContent(file: TFile): Promise<string> {
    const active = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (active?.file?.path === file.path) return active.getViewData();
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      if (leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path) return leaf.view.getViewData();
    }
    return this.app.vault.read(file);
  }

  private async refresh(path: string, force = false, readBaseline?: BaselineRead): Promise<void> {
    if (this.stopped) return;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== 'md') return;
    this.trackedPaths.add(path);
    const request = Symbol();
    this.contentReads.set(path, request);
    try {
      const content = await this.currentContent(file);
      if (!this.stopped && this.contentReads.get(path) === request) await this.store.refresh(path, content, force, readBaseline);
    } catch (error) {
      if (!this.stopped && this.contentReads.get(path) === request) this.store.reportError(path, error instanceof Error ? error.message : t('Failed to read the document.'));
    }
  }

  private async refreshOpenFiles(queueIfBusy = true): Promise<void> {
    if (this.stopped || !this.store) return;
    if (this.refreshing) { this.refreshQueued ||= queueIfBusy; return; }
    this.refreshing = true;
    try {
      const paths = new Set<string>();
      this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
        if (leaf.view instanceof MarkdownView && leaf.view.file?.extension.toLowerCase() === 'md') paths.add(leaf.view.file.path);
      });
      if (this.selectedPath) paths.add(this.selectedPath);
      for (const path of this.trackedPaths) if (!paths.has(path)) this.forget(path);
      // One metadata snapshot per repository, then read each editor's latest buffer.
      const readBaseline = this.reader.batch([...paths], (path) => this.targets.get(path));
      for (const path of paths) {
        if (this.stopped) break;
        if (this.app.workspace.getLeavesOfType('markdown').some((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === path) || this.selectedPath === path) await this.refresh(path, true, readBaseline);
      }
    } finally {
      this.refreshing = false;
      if (this.refreshQueued && !this.stopped) {
        this.refreshQueued = false;
        void this.refreshOpenFiles();
      }
    }
  }

  private forget(path: string): void {
    window.clearTimeout(this.timers.get(path));
    this.timers.delete(path);
    this.trackedPaths.delete(path);
    this.contentReads.delete(path);
    this.store.forget(path);
  }

  private updateStatus(): void {
    if (!this.status) return;
    const state = this.selectedPath ? this.store.get(this.selectedPath) : undefined;
    const base = state?.status === 'ready' ? baselineName(state.baseline) : this.selectedPath ? baselineName({ target: this.targets.get(this.selectedPath) }) : 'HEAD';
    const text = state?.status === 'ready' ? `Git${base === 'HEAD' ? '' : ` ${base}`} +${state.diff.added} −${state.diff.deleted}` : state?.status === 'error' ? t('Git: unavailable') : 'Git Diff';
    this.status.setText(text);
    this.status.setAttribute('aria-label', t('{text}, view diff', { text }));
    this.status.title = state?.status === 'error' ? state.message : t('View the current document’s changes from {base}', { base });
  }

  async openDiff(path = this.selectedPath, line?: number, preferDeletion = false): Promise<void> {
    if (this.stopped || !this.store) return;
    if (!path) { new Notice(t('Open a Markdown document first.')); return; }
    const editorView = this.app.workspace.getActiveViewOfType(MarkdownView);
    const targetLine = line ?? (editorView?.file?.path === path && editorView.getMode() === 'source' ? editorView.editor.getCursor('head').line : undefined);
    this.setSelected(path);
    let leaf = this.app.workspace.getLeavesOfType(DIFF_VIEW)[0];
    if (!leaf) {
      // Add a tab to the sidebar instead of splitting off a short pane below it.
      leaf = this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: DIFF_VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
    if (leaf.view instanceof DiffPanel) {
      leaf.view.setFile(path);
      await this.refresh(path, true);
      if (targetLine !== undefined && this.selectedPath === path) leaf.view.showLine(targetLine, true, preferDeletion);
    }
  }

  private async chooseBaseline(path: string): Promise<void> {
    if (this.stopped || !this.store) return;
    let commits: FileCommit[];
    try { commits = await this.reader.history(path); }
    catch (error) { new Notice(error instanceof Error ? error.message : t('Failed to read Git. Refresh and try again.')); return; }
    if (this.stopped) return;
    new CommitPickerModal(this.app, commits, this.targets.get(path), (commit) => {
      this.setBaseline(path, commit);
      void this.openDiff(path);
    }).open();
  }

  private setBaseline(path: string, commit: FileCommit | undefined): void {
    const previous = this.targets.get(path);
    if (this.stopped || (previous?.hash === commit?.hash && previous?.path === commit?.path)) return;
    if (commit) this.targets.set(path, commit);
    else this.targets.delete(path);
    this.revertModal?.close(); // A pending restoration was confirmed against the previous base.
    this.store.forget(path); // Drop in-flight reads for the previous base, too.
    void this.refresh(path, true);
  }

  private async moveDiff(direction: -1 | 1): Promise<void> {
    if (!this.app.workspace.getLeavesOfType(DIFF_VIEW).length) await this.openDiff();
    const panel = this.app.workspace.getLeavesOfType(DIFF_VIEW)[0]?.view;
    if (!this.stopped && panel instanceof DiffPanel) panel.move(direction);
  }

  private async navigate(path: string, line: number, focus = true, center = false): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) { new Notice(t('The document was moved or deleted.')); return; }
    const matches = this.app.workspace.getLeavesOfType('markdown').filter((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === path);
    const recent = this.app.workspace.getMostRecentLeaf();
    const leaf = matches.find((candidate) => candidate === recent && candidate.view.containerEl.isShown())
      ?? matches.find((candidate) => candidate.view.containerEl.isShown())
      ?? matches[0] ?? this.app.workspace.getLeaf('tab');
    if (!focus && leaf.view instanceof MarkdownView && leaf.view.file?.path === path && leaf.view.containerEl.isShown()) {
      revealSourceLine(leaf, leaf.view, line, center);
      return;
    }
    await leaf.openFile(file, { active: true, eState: { line } });
    leaf.setEphemeralState({ line });
    await this.app.workspace.revealLeaf(leaf);
    if (center && !this.stopped && leaf.view instanceof MarkdownView && leaf.view.file?.path === path) revealSourceLine(leaf, leaf.view, line, true);
  }

  private confirmRevert(snapshot: ReadyDiffState, change: LineChange): void {
    this.revertModal?.close();
    this.revertModal = new RevertChangeModal(this.app, snapshot.path, change, (signal) => this.revertChange(snapshot, change, signal), baselineName(snapshot.baseline));
    this.revertModal.open();
  }

  private async revertChange(snapshot: ReadyDiffState, change: LineChange, signal: AbortSignal): Promise<void> {
    try {
      signal.throwIfAborted();
      const file = this.app.vault.getAbstractFileByPath(snapshot.path);
      const adapter = this.app.vault.adapter;
      if (!(file instanceof TFile) || !(adapter instanceof FileSystemAdapter)) throw new LocalizedError('The document was moved or deleted and cannot be restored.');
      const leaf = this.app.workspace.getLeavesOfType('markdown').find((candidate) => candidate.view instanceof MarkdownView && candidate.view.file?.path === snapshot.path && candidate.view.getMode() === 'source' && candidate.view.containerEl.isShown());
      const view = leaf?.view;
      if (!leaf || !(view instanceof MarkdownView)) throw new LocalizedError('Open this document in source mode or Live Preview before restoring a change.');
      const editor = view.editor;
      await executeChangeRevert(snapshot, change,
        () => readGitBaseline(adapter.getBasePath(), snapshot.path, this.settings.gitPath, signal, this.settings, snapshot.baseline.target),
        {
          getValue: () => {
            if (this.stopped || view.file?.path !== snapshot.path || view.getMode() !== 'source') throw new LocalizedError('The document or mode changed. Select the change again.');
            const current = editor.getValue();
            if (normalizeText(current) !== normalizeText(view.getViewData())) throw new LocalizedError('The editor is not synchronized. Switch to editing mode and try again.');
            return current;
          },
          apply: (edits) => editor.transaction({
            changes: edits.map((edit) => ({ from: editor.offsetToPos(edit.from), to: editor.offsetToPos(edit.to), text: edit.text })),
            selection: { from: editor.offsetToPos(edits[0]!.from) },
          }, 'better-md-diff-fork.revert'),
        }, signal);
      // A distinct editor transaction preserves undo; Git's index is never touched.
      this.revertModal?.close();
      leaf.setEphemeralState({ line: Math.min(change.from, view.getViewData().split('\n').length - 1) });
      new Notice(t('Change restored. Press Ctrl/Cmd+Z in the source editor to undo.'));
    } finally {
      if (!this.stopped) await this.refresh(snapshot.path, true);
    }
  }

  private restartPolling(): void {
    window.clearInterval(this.gitPollTimer);
    if (!this.stopped) this.gitPollTimer = window.setInterval(() => { if (document.visibilityState !== 'hidden') void this.refreshOpenFiles(false); }, this.settings.gitPollSeconds * 1000);
  }

  async applySettings(): Promise<void> {
    this.settings = normalizeSettings(this.settings);
    await this.saveData(this.settings);
    if (this.stopped) return;
    this.restartPolling();
    this.store.updatePresentation(this.settings.contextLines, this.settings);
    if (this.appliedReadSettings.gitPath !== this.settings.gitPath || this.appliedReadSettings.maxFileMiB !== this.settings.maxFileMiB || this.appliedReadSettings.maxLines !== this.settings.maxLines) {
      this.appliedReadSettings = { ...this.settings };
      this.revertModal?.close();
      this.reader.dispose();
      const adapter = this.app.vault.adapter;
      if (!(adapter instanceof FileSystemAdapter)) return;
      this.reader = new GitBaselineReader(adapter.getBasePath(), this.settings.gitPath, this.settings);
      this.contentReads.clear();
      for (const path of this.trackedPaths) this.store.forget(path);
      await this.refreshOpenFiles();
    }
  }

  onunload(): void {
    this.stopped = true;
    this.reader?.dispose();
    window.clearInterval(this.gitPollTimer);
    this.revertModal?.close();
    for (const timer of this.timers.values()) window.clearTimeout(timer);
    this.timers.clear();
    this.contentReads.clear();
  }
}
