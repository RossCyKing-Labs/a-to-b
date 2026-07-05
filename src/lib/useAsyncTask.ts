import { useCallback, useState } from 'react';

export type TaskStatus = 'idle' | 'working' | 'done' | 'error';

/**
 * A tiny state machine for a single one-shot async job (convert this file,
 * merge these PDFs, etc.). Standardises the idle → working → done/error flow
 * that every single-output converter re-implemented by hand — some with a
 * `busy` boolean, some with an ad-hoc `Status` union, each duplicating the
 * `try/catch → setError(e instanceof Error ? …)` dance.
 *
 *   const task = useAsyncTask();
 *   const result = await task.run(() => mergePdfs(files));
 *   if (task.status === 'working') { ... }
 *   {task.error && <ErrorText>{task.error}</ErrorText>}
 *
 * `run` resolves to the job's value on success, or `undefined` on failure
 * (the error is captured in `task.error`), so callers never need their own
 * try/catch. Use `fail` for pre-flight validation errors (e.g. "not a PDF")
 * and `reset` to return to idle.
 */
export function useAsyncTask() {
  const [status, setStatus] = useState<TaskStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
      setStatus('working');
      setError(null);
      try {
        const result = await fn();
        setStatus('done');
        return result;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setStatus('error');
        return undefined;
      }
    },
    [],
  );

  const fail = useCallback((message: string) => {
    setError(message);
    setStatus('error');
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setError(null);
  }, []);

  return { status, error, run, fail, reset };
}
