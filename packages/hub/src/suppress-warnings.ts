// Must be imported before anything that loads node:sqlite so its ExperimentalWarning is filtered.
const originalEmit = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const message = typeof warning === 'string' ? warning : warning?.message;
  if (message && /SQLite is an experimental feature/i.test(message)) return;
  return (originalEmit as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

export {};
