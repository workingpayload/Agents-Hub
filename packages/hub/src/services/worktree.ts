import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { WorkspaceDiff } from '@agent-hub/shared';

const MAX_DIFF_BYTES = 800_000;

function git(cwd: string, args: string[], allowFail = false): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
      (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0;
        if (err && !allowFail) {
          reject(new Error(`git ${args.join(' ')} failed: ${(stderr || err.message).trim()}`));
          return;
        }
        resolve({ stdout: stdout.toString(), stderr: stderr.toString(), code });
      },
    );
  });
}

/** Git helpers for isolating agents in per-session worktrees and reviewing their changes. */
export class WorktreeService {
  constructor(private dataDir: string) {}

  async repoRoot(cwd: string): Promise<string | null> {
    const r = await git(cwd, ['rev-parse', '--show-toplevel'], true).catch(() => null);
    if (!r || r.code !== 0) return null;
    return path.resolve(r.stdout.trim());
  }

  async create(baseCwd: string, sessionId: string, agentId: string): Promise<{ cwd: string; worktreePath: string; branch: string }> {
    const root = await this.repoRoot(baseCwd);
    if (!root) throw new Error(`Worktree isolation needs a git repository, but ${baseCwd} is not inside one`);
    const head = await git(root, ['rev-parse', '--verify', 'HEAD'], true);
    if (head.code !== 0) throw new Error('Worktree isolation needs at least one commit in the repository');
    const shortId = sessionId.slice(0, 8);
    const branch = `agent-hub/${agentId}-${shortId}`;
    const worktreePath = path.join(this.dataDir, 'worktrees', `${path.basename(root)}-${shortId}`);
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });
    await git(root, ['worktree', 'add', '-b', branch, worktreePath, 'HEAD']);
    const rel = path.relative(root, path.resolve(baseCwd));
    const cwd = rel && !rel.startsWith('..') ? path.join(worktreePath, rel) : worktreePath;
    return { cwd, worktreePath, branch };
  }

  async diff(cwd: string): Promise<WorkspaceDiff> {
    const root = await this.repoRoot(cwd);
    if (!root) return { cwd, isGitRepo: false, diff: '', untracked: [], truncated: false };
    const branch = (await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'], true)).stdout.trim() || undefined;
    const hasHead = (await git(root, ['rev-parse', '--verify', 'HEAD'], true)).code === 0;
    const diff = (await git(root, hasHead ? ['diff', 'HEAD', '--no-color'] : ['diff', '--no-color'], true)).stdout;
    const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard'], true)).stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, 500);
    const truncated = diff.length > MAX_DIFF_BYTES;
    return { cwd: root, isGitRepo: true, branch, diff: truncated ? diff.slice(0, MAX_DIFF_BYTES) : diff, untracked, truncated };
  }

  /** Commits all pending changes in the worktree. Returns false when there was nothing to commit. */
  async commit(worktreePath: string, message: string): Promise<boolean> {
    await git(worktreePath, ['add', '-A']);
    const status = await git(worktreePath, ['status', '--porcelain']);
    if (!status.stdout.trim()) return false;
    const plain = await git(worktreePath, ['commit', '-m', message], true);
    if (plain.code !== 0) {
      // Retry with a fallback identity when the user has no git identity configured.
      await git(worktreePath, ['-c', 'user.name=Agent Hub', '-c', 'user.email=agent-hub@localhost', 'commit', '-m', message]);
    }
    return true;
  }

  /** Merges the worktree branch into whatever branch is checked out in the base repository. */
  async merge(baseCwd: string, worktreePath: string, branch: string, message: string): Promise<string> {
    const root = await this.repoRoot(baseCwd);
    if (!root) throw new Error('Base directory is no longer a git repository');
    await this.commit(worktreePath, message);
    const result = await git(root, ['merge', '--no-ff', '--no-edit', branch], true);
    if (result.code !== 0) {
      await git(root, ['merge', '--abort'], true);
      throw new Error(`Merge failed and was aborted: ${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout.trim();
  }

  async remove(baseCwd: string, worktreePath: string, branch?: string, deleteBranch = false): Promise<void> {
    const root = await this.repoRoot(baseCwd);
    if (root) {
      await git(root, ['worktree', 'remove', '--force', worktreePath], true);
      await git(root, ['worktree', 'prune'], true);
      if (deleteBranch && branch) await git(root, ['branch', '-D', branch], true);
    }
    if (fs.existsSync(worktreePath)) fs.rmSync(worktreePath, { recursive: true, force: true });
  }
}
