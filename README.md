# Better MD Diff Fork

A fork of [Better MD Diff](https://github.com/kamacheng/better-md-diff) by kamacheng. Compare Markdown in Obsidian with **Git HEAD** or an **earlier commit**, as paired lines or as a word diff, and restore individual changes after confirmation.

The fork adds word diff (`git diff --word-diff` style), comparison with earlier commits, and an English-only interface. It uses its own plugin ID, `better-md-diff-fork`, so it never receives updates of the original from the community catalog. Enable only one of the two plugins at a time: both style the same panel classes.

![Obsidian demo: edit, inspect a deletion, restore one change, and undo](docs/images/obsidian-demo.gif)

Recorded with the upstream Better MD Diff 0.4.0 in desktop Obsidian using a public-domain excerpt from *Pride and Prejudice* with demonstration edits. [Demo details](docs/demo.md) · [0.5.0 release notes](docs/releases/0.5.0.md).

## Installation

Requires desktop **Obsidian 1.8.0+** and a local **Git** installation. The fork is not in the community catalog.

- **Manually:** download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/artemc/obsidian-better-md-diff-fork/releases/latest) into `<vault>/.obsidian/plugins/better-md-diff-fork/`, then enable **Better MD Diff Fork** under **Settings → Community plugins**.
- **With BRAT:** add the beta plugin `artemc/obsidian-better-md-diff-fork`.

## Usage

1. Edit a Git-tracked Markdown note in Source mode or Live Preview.
2. Click an editor flag or the **Git diff** ribbon icon to review changes. In the panel, **red text is old content, green text is added content**; stronger local backgrounds highlight changed words.
3. Use **↑ / ↓** to visit individual changes. Click a group heading to select its first change, or a change's line-number button to select that item. Source navigation follows your settings.
4. Click a restore arrow and confirm the preview. Press **Ctrl/Cmd+Z** in the source editor to undo.

### Editor flags

| Flag | Meaning |
| --- | --- |
| Green `+n` | `n` added lines in the current note |
| Blue `~n` | `n` modified lines in the current note |
| Red `−n` | `n` deleted old lines, marked at their boundary—not as a deleted following line |

Added/modified ranges have one flag at their start and a thin gutter rail. Source text stays untinted, and the fixed-width gutter avoids horizontal shifts during refreshes. Large counts keep their full value in tooltips. Rendered tables and folded blocks show the first contained change flag; use the panel for exact ranges. Flags appear in Source mode and Live Preview, not Reading view.

### Changes versus reading groups

**Change 1 / 3** counts independent edits, not the number of boxes. Nearby edits share context: two groups may contain **2 changes** and **1 change**. Their headings show the line range and contained change count. A contiguous multi-line replacement is one change; grouping never enlarges its restoration scope.

### Comparing with an earlier commit

Click **HEAD** in the panel header, run **Choose a commit to compare with**, or use **Compare with an earlier commit** in the file menu. The list shows the commits that changed the note, following renames. The selected commit then drives the panel, editor flags and restoration for that note; **Back to HEAD** returns to the default. The choice lasts for the current session.

### Word diff

**Settings → Diff style** switches the panel between paired lines (default) and word views like `git diff --word-diff`: **[-deleted-]{+added+} markers** (plain) or **red and green words** (`--word-diff=color`). Words are split with the system word segmenter, so Cyrillic, CJK and punctuation are compared word by word. Navigation, counts and restoration stay line based. In the word views, copying yields the text as shown, including plain markers.

Text remains selectable and copies as original Markdown, without controls or line numbers. Settings retain font size, changed-word/whitespace markers, and source-following options; the **?** button explains the display.

The plugin never stages, commits, or pushes. Restoration checks the current note and Git baseline before applying one undoable edit. Back up important notes first.

## Scope

Compares against **local Git HEAD** or a selected earlier commit of the same repository. Accepted-baseline review and GitLab comparison are not yet available.

## License

[MIT](LICENSE). The jsdiff dependency uses BSD-3-Clause; its full license is included in the build.
