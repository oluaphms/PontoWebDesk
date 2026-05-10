import { useEffect, type DependencyList } from 'react';

type AsyncEffectRunner = (isCancelled: () => boolean) => Promise<void>;

/**
 * Executa efeitos assíncronos com guarda de cancelamento no cleanup.
 */
export function useAbortableAsyncEffect(
  runner: AsyncEffectRunner,
  deps: DependencyList,
): void {
  useEffect(() => {
    let cancelled = false;
    const isCancelled = () => cancelled;

    void runner(isCancelled);

    return () => {
      cancelled = true;
    };
  }, deps);
}

export default useAbortableAsyncEffect;
