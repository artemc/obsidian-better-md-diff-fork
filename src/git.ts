import { execFile } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { assertTextSize } from './diff';
import { DEFAULT_SETTINGS, type DocumentLimits } from './options';
import { LocalizedError } from './i18n';

const exec = promisify(execFile);

/** A commit compared instead of HEAD; `path` is the repository-relative name in that commit, so renames still resolve. */
export interface BaselineTarget { hash: string; path: string; subject?: string; time?: number }
export interface FileCommit extends BaselineTarget { subject: string; time: number; author: string }
export interface GitBaseline {
  content: string;
  /** The commit actually compared: HEAD, or the selected target. */
  head: string | null;
  isNew: boolean;
  target?: BaselineTarget;
}
export type BaselineRead = (path: string) => Promise<GitBaseline>;
export type TargetOf = (path: string) => BaselineTarget | undefined;

export function sameTarget(a: GitBaseline, b: GitBaseline): boolean {
  return a.target?.hash === b.target?.hash && a.target?.path === b.target?.path;
}

/** Short display name of the compared version: HEAD or an abbreviated commit. */
export function baselineName(baseline: Pick<GitBaseline, 'target'> | undefined): string {
  return baseline?.target ? baseline.target.hash.slice(0, 8) : 'HEAD';
}

export class GitReadError extends LocalizedError {
  constructor(public readonly reason: 'untracked' | 'unavailable' | 'repository' | 'conflict' | 'read', key: string, values?: Record<string, string | number>) { super(key, values); }
}
interface ProcessError extends Error { code?: string | number; stderr?: string; killed?: boolean }
interface LocatedFile { vaultPath: string; path: string; target?: BaselineTarget }

function readError(error: unknown): Error {
  if (error instanceof LocalizedError) return error;
  const failure = error as ProcessError;
  const detail = failure.stderr?.trim().slice(0, 500) || failure.message;
  return detail ? new GitReadError('read', 'Git read failed: {detail}', { detail }) : new GitReadError('read', 'Failed to read Git. Refresh and try again.');
}

/** One owner per plugin. Only immutable blob contents survive a refresh cycle. */
export class GitBaselineReader {
  private controller = new AbortController();
  private blobs = new Map<string, string>();
  private cachedBytes = 0;

  private limits: DocumentLimits;

  constructor(private vaultRoot: string, private gitPath = 'git', limits: DocumentLimits = DEFAULT_SETTINGS) { this.limits = { ...limits }; }

  read(path: string, target?: BaselineTarget): Promise<GitBaseline> { return this.batch([path], () => target)(path); }

  /** Lazy, sequential Git I/O; metadata is shared only by the paths in this batch. */
  batch(paths: readonly string[], targetOf: TargetOf = () => undefined): BaselineRead {
    let pending: Promise<Map<string, GitBaseline | Error>> | undefined;
    return async (path) => {
      this.controller.signal.throwIfAborted();
      pending ??= this.readBatch([...new Set(paths)], targetOf);
      const result = (await pending).get(path);
      this.controller.signal.throwIfAborted();
      if (!result) throw new GitReadError('read', 'The document is not in this refresh batch.');
      if (result instanceof Error) throw result;
      return result;
    };
  }

  private async run(cwd: string, args: string[]): Promise<string> {
    this.controller.signal.throwIfAborted();
    try {
      const { stdout } = await exec(this.gitPath, args, {
        cwd, encoding: 'utf8', windowsHide: true, shell: false,
        signal: this.controller.signal, timeout: 8_000, maxBuffer: this.limits.maxFileMiB * 1024 * 1024 + 64 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0', GIT_LITERAL_PATHSPECS: '1' },
      });
      return stdout;
    } catch (error) {
      const failure = error as ProcessError;
      if (failure.code === 'ENOENT') throw new GitReadError('unavailable', 'Git was not found. Install Git or set its full executable path in the plugin settings.');
      if (failure.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new GitReadError('read', 'Git output exceeds the current read limit ({size} MiB). Increase the document size limit in plugin settings.', { size: this.limits.maxFileMiB });
      if (failure.killed) throw new GitReadError('read', 'Git timed out. Check the repository or executable path, then refresh.');
      throw error;
    }
  }

  private async locate(vaultPath: string, roots = new Map<string, string>()): Promise<{ root: string; path: string }> {
    const absolute = resolve(this.vaultRoot, vaultPath);
    const inside = relative(this.vaultRoot, absolute);
    if (inside === '..' || inside.startsWith(`..${sep}`) || isAbsolute(inside)) throw new GitReadError('read', 'The document path is outside the vault.');
    let directory: string;
    let root: string;
    try {
      // Physical directories resolve aliases; file symlinks still fail the index check.
      directory = await realpath(dirname(absolute));
      root = roots.get(directory) ?? (await this.run(directory, ['rev-parse', '--show-toplevel'])).replace(/[\r\n]+$/, '');
      roots.set(directory, root);
    } catch (error) {
      if (error instanceof GitReadError) throw error;
      throw new GitReadError('repository', 'Cannot access the Git repository. Check the document location, permissions, and safe.directory configuration.');
    }
    return { root, path: relative(root, resolve(directory, basename(absolute))).split(sep).join('/') };
  }

  /** Commits reachable from HEAD that changed this document, newest first, following renames. */
  async history(vaultPath: string, limit = 200): Promise<FileCommit[]> {
    try {
      const { root, path } = await this.locate(vaultPath);
      try { await this.run(root, ['rev-parse', '--verify', '--quiet', 'HEAD']); }
      catch (error) { if ((error as ProcessError).code === 1) return []; throw error; }
      const output = await this.run(root, ['log', '--follow', '--no-show-signature', '--no-color', `--max-count=${limit}`, '-z', '--name-only', '--format=%x1e%H%x1f%ct%x1f%an%x1f%s', 'HEAD', '--', path]);
      const commits: FileCommit[] = [];
      let name = path;
      // Record: \x1e hash \x1f time \x1f author \x1f subject \0 \n name-in-that-commit \0
      for (const record of output.split('\x1e').slice(1)) {
        const end = record.indexOf('\0');
        const [hash, time, author, subject] = (end < 0 ? record : record.slice(0, end)).split('\x1f');
        if (!hash || !/^[0-9a-f]{40,64}$/.test(hash)) continue;
        name = (end < 0 ? '' : record.slice(end + 1).replace(/^\n/, '').split('\0')[0]) || name;
        commits.push({ hash, path: name, time: Number(time) * 1000, author: author ?? '', subject: subject ?? '' });
      }
      return commits;
    } catch (error) { throw readError(error); }
  }

  private async readBatch(paths: string[], targetOf: TargetOf): Promise<Map<string, GitBaseline | Error>> {
    const results = new Map<string, GitBaseline | Error>();
    const roots = new Map<string, string>();
    const repositories = new Map<string, LocatedFile[]>();
    for (const vaultPath of paths) {
      this.controller.signal.throwIfAborted();
      try {
        const { root, path } = await this.locate(vaultPath, roots);
        const files = repositories.get(root) ?? [];
        files.push({ vaultPath, path, target: targetOf(vaultPath) });
        repositories.set(root, files);
      } catch (error) { results.set(vaultPath, readError(error)); }
    }
    for (const [root, files] of repositories) {
      try {
        let head: string | null;
        try { head = (await this.run(root, ['rev-parse', '--verify', '--quiet', 'HEAD'])).trim(); }
        catch (error) { if ((error as ProcessError).code === 1) head = null; else throw error; }
        // Bound argv size on Windows; don't scan the whole index of a larger parent repo.
        for (let start = 0; start < files.length; start += 32) {
          const chunk = files.slice(start, start + 32);
          const names = chunk.map((file) => file.path);
          const index = this.entries(await this.run(root, ['ls-files', '--stage', '-z', '--', ...names]));
          const tree = head ? this.entries(await this.run(root, ['ls-tree', '-z', head, '--', ...names])) : new Map<string, string[]>();
          for (const file of chunk) {
            try {
              const entries = index.get(file.path);
              if (!entries?.length) throw new GitReadError('untracked', 'This document is not tracked by Git. Run git add, then refresh the diff.');
              if (entries.some((entry) => !/^\d+ [0-9a-f]+ 0$/.test(entry))) throw new GitReadError('conflict', 'This document has unresolved merge conflicts. Resolve them, then refresh.');
              if (entries.some((entry) => !/^100(?:644|755) /.test(entry))) throw new GitReadError('read', 'Symlinks and submodule files are not supported.');
              if (file.target) { results.set(file.vaultPath, await this.readTarget(root, file.target)); continue; }
              const object = tree.get(file.path)?.[0];
              if (!object) { results.set(file.vaultPath, { content: '', head, isNew: true }); continue; }
              const blob = /^100(?:644|755) blob ([0-9a-f]+)$/.exec(object)?.[1];
              if (!blob) throw new GitReadError('read', 'The HEAD object is not a regular Markdown file.');
              results.set(file.vaultPath, { content: await this.readBlob(root, blob), head, isNew: false });
            } catch (error) { results.set(file.vaultPath, readError(error)); }
          }
        }
      } catch (error) {
        for (const file of files) results.set(file.vaultPath, readError(error));
      }
    }
    return results;
  }

  private async readTarget(root: string, target: BaselineTarget): Promise<GitBaseline> {
    // A hash, never a revision expression or option, reaches argv.
    if (!/^[0-9a-f]{40,64}$/.test(target.hash)) throw new GitReadError('read', 'The selected commit does not exist. Choose the comparison base again.');
    try { await this.run(root, ['rev-parse', '--verify', '--quiet', `${target.hash}^{commit}`]); }
    catch (error) {
      if ((error as ProcessError).code === 1) throw new GitReadError('read', 'The selected commit does not exist. Choose the comparison base again.');
      throw error;
    }
    const object = this.entries(await this.run(root, ['ls-tree', '-z', target.hash, '--', target.path])).get(target.path)?.[0];
    if (!object) return { content: '', head: target.hash, isNew: true, target };
    const blob = /^100(?:644|755) blob ([0-9a-f]+)$/.exec(object)?.[1];
    if (!blob) throw new GitReadError('read', 'The object in the selected commit is not a regular Markdown file.');
    return { content: await this.readBlob(root, blob), head: target.hash, isNew: false, target };
  }

  private entries(output: string): Map<string, string[]> {
    const entries = new Map<string, string[]>();
    for (const entry of output.split('\0')) {
      const tab = entry.indexOf('\t');
      if (tab < 0) continue;
      const path = entry.slice(tab + 1);
      const values = entries.get(path) ?? [];
      values.push(entry.slice(0, tab));
      entries.set(path, values);
    }
    return entries;
  }

  private async readBlob(root: string, blob: string): Promise<string> {
    const key = `${root}\0${blob}`;
    let content = this.blobs.get(key);
    if (content !== undefined) { this.blobs.delete(key); this.blobs.set(key, content); return content; }
    content = await this.run(root, ['cat-file', 'blob', blob]);
    assertTextSize(content, this.limits);
    this.controller.signal.throwIfAborted();
    if (!this.blobs.has(key)) this.cachedBytes += Buffer.byteLength(content, 'utf8');
    this.blobs.set(key, content);
    while (this.cachedBytes > 16 * 1024 * 1024 || this.blobs.size > 128) {
      const oldest = this.blobs.entries().next().value!;
      this.blobs.delete(oldest[0]);
      this.cachedBytes -= Buffer.byteLength(oldest[1], 'utf8');
    }
    return content;
  }

  dispose(): void { this.controller.abort(); this.blobs.clear(); this.cachedBytes = 0; }
}

/** Restoration uses an independent, uncached read rather than the poller's batch. */
export async function readGitBaseline(vaultRoot: string, vaultPath: string, gitPath = 'git', signal?: AbortSignal, limits: DocumentLimits = DEFAULT_SETTINGS, target?: BaselineTarget): Promise<GitBaseline> {
  const reader = new GitBaselineReader(vaultRoot, gitPath, limits);
  const abort = () => reader.dispose();
  signal?.throwIfAborted();
  signal?.addEventListener('abort', abort, { once: true });
  try { return await reader.read(vaultPath, target); }
  finally { signal?.removeEventListener('abort', abort); reader.dispose(); }
}
