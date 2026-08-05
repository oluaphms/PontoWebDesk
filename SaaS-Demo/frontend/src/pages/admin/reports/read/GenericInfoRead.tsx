import React from 'react';
import { Link } from 'react-router-dom';
import { ReportReadShell } from './ReportReadShell';

type BlockProps = {
  title: string;
  children: React.ReactNode;
};

function Block({ title, children }: BlockProps) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/40 p-5 space-y-2">
      <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h2>
      <div className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{children}</div>
    </div>
  );
}

export function GenericInfoRead({
  title,
  intro,
  links,
}: {
  title: string;
  intro: React.ReactNode;
  links?: { label: string; to: string }[];
}) {
  return (
    <ReportReadShell title={title}>
      <div className="space-y-6 max-w-2xl">
        <Block title="Sobre este relatório">{intro}</Block>
        {links && links.length > 0 && (
          <Block title="Ações relacionadas">
            <ul className="space-y-2">
              {links.map((l) => (
                <li key={l.to}>
                  <Link to={l.to} className="text-indigo-600 dark:text-indigo-400 font-medium hover:underline">
                    {l.label} →
                  </Link>
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>
    </ReportReadShell>
  );
}
