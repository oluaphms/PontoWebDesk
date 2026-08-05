
import React, { useState, useEffect } from 'react';

const Clock: React.FC = () => {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const hours = time.getHours().toString().padStart(2, '0');
  const minutes = time.getMinutes().toString().padStart(2, '0');
  const seconds = time.getSeconds().toString().padStart(2, '0');
  
  const fullDate = time.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const timeString = `${hours}:${minutes}:${seconds}`;

  return (
    <div 
      className="text-center py-8 select-none" 
      aria-label={`Horário atual: ${timeString}. Data: ${fullDate}`}
      role="timer"
    >
      <div className="text-7xl font-black tracking-tighter text-slate-900 dark:text-white tabular-nums flex items-center justify-center gap-1" aria-hidden="true">
        <span>{hours}</span>
        <span className="animate-pulse text-indigo-500 opacity-70">:</span>
        <span>{minutes}</span>
        <span className="text-3xl text-slate-300 dark:text-slate-600 self-end mb-2 ml-1">{seconds}</span>
      </div>
      <div className="text-slate-600 dark:text-slate-400 font-bold mt-4 uppercase text-[10px] tracking-[0.3em] bg-slate-100 dark:bg-slate-800/50 py-2 px-4 rounded-full inline-block" aria-hidden="true">
        {fullDate}
      </div>
    </div>
  );
};

export default Clock;
