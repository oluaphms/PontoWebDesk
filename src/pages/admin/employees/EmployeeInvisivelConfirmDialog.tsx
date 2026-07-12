export type EmployeeInvisivelConfirmDialogProps = {
  employeeId: string | null;
  onConfirm: (id: string) => void;
  onDecline: () => void;
};

export function EmployeeInvisivelConfirmDialog({
  employeeId,
  onConfirm,
  onDecline,
}: EmployeeInvisivelConfirmDialogProps) {
  if (!employeeId) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 max-w-sm">
        <p className="text-slate-700 dark:text-slate-200 mb-4">Deseja tornar este funcionário <strong>invisível</strong>? Ele não aparecerá nos relatórios nem na listagem, mas os dados permanecem salvos.</p>
        <div className="flex gap-3">
          <button type="button" onClick={() => { onConfirm(employeeId); }} className="flex-1 py-2.5 rounded-xl bg-amber-600 text-white font-medium">Sim, tornar invisível</button>
          <button type="button" onClick={onDecline} className="flex-1 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 font-medium">Não</button>
        </div>
      </div>
    </div>
  );
}
