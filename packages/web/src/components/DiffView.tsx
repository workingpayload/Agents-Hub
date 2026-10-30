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
        kind === '+' && 'bg-emerald-500/10 text-emerald-200',
        kind === '-' && 'bg-red-500/10 text-red-200',
        kind === '@' && 'bg-white/[0.08] text-sky-300',
        kind !== '+' && kind !== '-' && kind !== '@' && 'text-slate-400',
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
    <div className="overflow-hidden rounded-lg border border-white/10 bg-black/35">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5 text-xs">
        <span className="truncate font-mono text-slate-300" title={path}>
          {basename(path)}
        </span>
        <span className="text-slate-400">{oldText == null ? 'new file' : 'modified'}</span>
      </div>
      <div className="max-h-80 overflow-auto font-mono text-xs leading-5">
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
  if (!files.length) return <p className="text-sm text-slate-400">No changes.</p>;
  return (
    <div className="space-y-3">
      {files.map((f) => (
        <details key={f.name} open={files.length <= 6} className="overflow-hidden rounded-lg border border-white/10 bg-black/35">
          <summary className="cursor-pointer border-b border-white/10 px-3 py-1.5 font-mono text-xs text-slate-300">{f.name}</summary>
          <div className="max-h-96 overflow-auto font-mono text-xs leading-5">
            {f.lines.slice(0, 3000).map((l, i) => (
              <Line key={i} text={l} />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
