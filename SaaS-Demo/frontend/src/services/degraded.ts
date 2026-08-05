export function degradedResponse<T = unknown[]>(data: T = [] as T): {
  ok: false;
  degraded: true;
  data: T;
} {
  return {
    ok: false,
    degraded: true,
    data,
  };
}

