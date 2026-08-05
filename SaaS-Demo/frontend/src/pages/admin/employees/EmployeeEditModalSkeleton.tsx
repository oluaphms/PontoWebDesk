/** Skeleton visual do modal de funcionário (lista ainda carregando). */
export function EmployeeEditModalSkeleton() {
  const bar = 'h-10 rounded-lg bg-slate-100 dark:bg-slate-800/90';
  const cap = 'h-2.5 rounded bg-slate-200/90 dark:bg-slate-700 w-24 mb-2';
  return (
    <div className="space-y-8 animate-pulse pt-1" aria-busy="true" aria-label="Carregando dados do formulário">
      <div className="grid grid-cols-1 lg:grid-cols-10 gap-6 lg:gap-8">
        <div className="order-2 lg:order-1 lg:col-span-7 space-y-8">
          {[0, 1, 2].map((k) => (
            <div key={k} className="space-y-4">
              <div className={cap} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-2">
                  <div className={cap} />
                  <div className={bar} />
                </div>
                <div className="space-y-2">
                  <div className={cap} />
                  <div className={bar} />
                </div>
                <div className="space-y-2">
                  <div className={cap} />
                  <div className={bar} />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="order-1 lg:order-2 lg:col-span-3 flex flex-col items-center gap-4">
          <div className="h-[104px] w-[104px] rounded-2xl bg-slate-200 dark:bg-slate-700" />
          <div className="h-9 w-full max-w-[220px] rounded-lg bg-slate-200 dark:bg-slate-700" />
          <div className="h-32 w-full rounded-xl bg-slate-100 dark:bg-slate-800/80" />
        </div>
      </div>
    </div>
  );
}
