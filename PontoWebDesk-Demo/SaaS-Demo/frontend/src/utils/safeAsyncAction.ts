type SafeAsyncHandlers<T> = {
  onSuccess?: (result: T) => void | Promise<void>;
  onError?: (error: unknown) => void | Promise<void>;
  onFinally?: () => void | Promise<void>;
};

/**
 * Executa ação assíncrona com tratamento padronizado de erro/finalização.
 * Retorna `null` quando ocorre falha para facilitar fluxos de UI.
 */
export async function safeAsyncAction<T>(
  operation: () => Promise<T>,
  handlers: SafeAsyncHandlers<T> = {},
): Promise<T | null> {
  const { onSuccess, onError, onFinally } = handlers;
  try {
    const result = await operation();
    if (onSuccess) await onSuccess(result);
    return result;
  } catch (error) {
    if (onError) await onError(error);
    return null;
  } finally {
    if (onFinally) await onFinally();
  }
}

