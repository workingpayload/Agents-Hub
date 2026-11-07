import { clsx } from 'clsx';
import { structuredPatch } from 'diff';
import { useMemo } from 'react';
import { basename } from '../lib/format';

function Line({ text }: { text: string }) {
  const kind = text[0];
  return (
    <div
      className={clsx(
        'whitespace-pre-wrap break-all px-3',
        kind === '+' && 'bg-emerald-950 text-emerald-200',
        kind === '-' && 'bg-red-950 text-red-200',
        kind === '@' && 'bg-surface-3 text-sky-300',
        kind !== '+' && kind !== '-' && kind !== '@' && 'text-neutral-400',
      )}
    >
      {text || ' '}
    </div>
  );
}

/** Diff of a single file edit reported by an agent (old/new text). */
export function FileDiff({ path, oldText, newText }: { path: string; oldText?: string | null; newText: string }) {
  const lines = useMemo(() => {
    const patch = structuredPatch(path, path, oldText ?? '', newText, '', '', { context: 3 });
    const out: string[] = [];
    for (const h of patch.hunks) {
      out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
      out.push(...h.lines);
    }
    return out.slice(0, 2000);
  }, [path, oldText, newText]);
  return (
    <div className="overflow-hidden rounded-xl border border-surface-4 bg-black">
      <div className="caption-4 flex items-center justify-between gap-2 bg-surface-2 px-3 py-2">
        <span className="truncate font-mono text-neutral-200" title={path}>
          {basename(path)}
        </span>
        <span className="text-neutral-400">{oldText == null ? 'New file' : 'Modified'}</span>
      </div>
      <div className="max-h-80 overflow-auto py-1 font-mono text-xs leading-5">
        {lines.map((l, i) => (
          <Line key={i} text={l} />
        ))}
      </div>
    </div>
  );
}

/** Renders a unified diff (e.g. `git diff` output), split per file. */
export function UnifiedDiff({ diff }: { diff: string }) {
  const files = useMemo(() => {
    const result: { name: string; lines: string[] }[] = [];
    let current: { name: string; lines: string[] } | undefined;
    for (const line of diff.split('\n')) {
      if (line.startsWith('diff --git')) {
        const m = line.match(/ b\/(.+)$/);
        current = { name: m?.[1] ?? line, lines: [] };
        result.push(current);
      } else if (current && !/^(index |--- |\+\+\+ |new file mode|deleted file mode|similarity|rename )/.test(line)) {
        current.lines.push(line);
      }
    }
    return result;
  }, [diff]);
  if (!files.length) return <p className="body-6 text-neutral-400">No changes.</p>;
  return (
    <div className="space-y-3">
      {files.map((f) => (
        <details key={f.name} open={files.length <= 6} className="overflow-hidden rounded-xl border border-surface-4 bg-black">
          <summary className="caption-4 bg-surface-2 px-3 py-2 font-mono text-neutral-200 hover:bg-surface-3">{f.name}</summary>
          <div className="max-h-96 overflow-auto py-1 font-mono text-xs leading-5">
            {f.lines.slice(0, 3000).map((l, i) => (
              <Line key={i} text={l} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
