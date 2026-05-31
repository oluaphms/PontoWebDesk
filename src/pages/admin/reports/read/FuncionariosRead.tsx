import { observabilityConsole } from '../../../../shared/logger/observabilityConsole';
import React, { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useCurrentUser } from '../../../../hooks/useCurrentUser';
import { LoadingState } from '../../../../../components/UI';
import { ReportReadShell } from './ReportReadShell';
import { useAbortableAsyncEffect } from '../../../../hooks/useAbortableAsyncEffect';
import { fetchEmployees } from '../../../../services/employeesApi.service';

type U = { id: string; nome: string | null; email: string | null; role: string | null };

export function FuncionariosRead() {
  const { user, loading } = useCurrentUser();
  const [rows, setRows] = useState<U[]>([]);
  const [loadingData, setLoadingData] = useState(true);

  useAbortableAsyncEffect(
    async (isCancelled) => {
      if (!user?.companyId) {
        setLoadingData(false);
        return;
      }
      setLoadingData(true);
      try {
        const data = await fetchEmployees(user.companyId);
        if (isCancelled()) return;
        setRows(
          data.map((r) => ({
            id: r.id,
            nome: r.nome ?? null,
            email: r.email ?? null,
            role: r.role ?? null,
          })),
        );
      } catch (e) {
        observabilityConsole.error(e);
      } finally {
        if (!isCancelled()) setLoadingData(false);
      }
    },
    [user?.companyId],
  );

  if (loading) return <LoadingState message="Carregando..." />;
  if (!user) return <Navigate to="/" replace />;

  return (
    <ReportReadShell title="Funcionários" subtitle="Listagem somente leitura dos colaboradores da empresa.">
      {loadingData ? (
        <LoadingState message="Carregando..." />
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-gray-500">
              <th className="py-2">Nome</th>
              <th className="py-2">E-mail</th>
              <th className="py-2">Perfil</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-100">
                <td className="py-2">{r.nome ?? '—'}</td>
                <td className="py-2">{r.email ?? '—'}</td>
                <td className="py-2">{r.role ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportReadShell>
  );
}
