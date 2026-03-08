/**
 * Fila simples para limitar requisições simultâneas ao Supabase.
 * Evita múltiplas queries paralelas que podem causar timeout em free tier.
 */

type Task<T> = () => Promise<T>;

let running = 0;
const maxConcurrent = 3;
const queue: Array<{ run: () => void }> = [];

function processQueue(): void {
  while (queue.length > 0 && running < maxConcurrent) {
    const item = queue.shift();
    if (item) item.run();
  }
}

/**
 * Enfileira uma operação assíncrona. Executa quando houver vaga (máx. 3 simultâneas).
 */
export async function enqueue<T>(task: Task<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = async () => {
      running++;
      try {
        const result = await task();
        resolve(result);
      } catch (e) {
        reject(e);
      } finally {
        running--;
        processQueue();
      }
    };

    if (running < maxConcurrent) {
      run();
    } else {
      queue.push({ run: () => run().then(resolve).catch(reject) });
    }
  });
}
