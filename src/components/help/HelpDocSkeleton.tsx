import React from 'react';

export const HelpDocSkeleton: React.FC = () => (
  <div className="max-w-3xl space-y-6 animate-pulse" aria-hidden>
    <div className="h-8 w-2/3 rounded-lg bg-slate-200 dark:bg-slate-800" />
    <div className="space-y-3 mt-6">
      <div className="h-4 w-full rounded bg-slate-100 dark:bg-slate-800/80" />
      <div className="h-4 w-[95%] rounded bg-slate-100 dark:bg-slate-800/80" />
      <div className="h-4 w-[80%] rounded bg-slate-100 dark:bg-slate-800/80" />
    </div>
    <div className="h-6 w-1/2 rounded-lg bg-slate-200 dark:bg-slate-800 mt-10" />
    <div className="space-y-2 mt-4">
      {[100, 92, 85, 78].map((w) => (
        <div key={w} className="h-3 rounded bg-slate-100 dark:bg-slate-800/60" style={{ width: `${w}%` }} />
      ))}
    </div>
  </div>
);
