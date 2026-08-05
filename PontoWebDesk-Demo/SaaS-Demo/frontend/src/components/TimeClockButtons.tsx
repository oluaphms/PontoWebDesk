import React from 'react';
import { LogType } from '../../types';
import { Button } from '../../components/UI';

interface TimeClockButtonsProps {
  isLoading?: boolean;
  lastType?: LogType | null;
  onPunch: (type: LogType) => void;
}

/**
 * Botões reutilizáveis para marcação de ponto.
 *
 * A lógica básica de habilitação segue o fluxo:
 * - Se nunca registrou ou último foi saída → só Entrada
 * - Após Entrada → permite Pausa ou Saída
 * - Após Pausa → permite Saída (e opcionalmente nova Entrada dependendo da regra externa)
 *
 * Regras mais complexas podem ser aplicadas por quem consome via `lastType`.
 */
export const TimeClockButtons: React.FC<TimeClockButtonsProps> = ({
  isLoading,
  lastType,
  onPunch,
}) => {
  const canClockIn = !lastType || lastType === LogType.OUT;
  const canBreak = lastType === LogType.IN;
  const canClockOut = lastType === LogType.IN || lastType === LogType.BREAK;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      <Button
        size="lg"
        loading={isLoading && lastType === LogType.IN}
        disabled={!canClockIn}
        onClick={() => onPunch(LogType.IN)}
      >
        Entrada
      </Button>
      <Button
        size="lg"
        variant="outline"
        loading={isLoading && lastType === LogType.BREAK}
        disabled={!canBreak}
        onClick={() => onPunch(LogType.BREAK)}
      >
        Pausa
      </Button>
      <Button
        size="lg"
        variant="secondary"
        loading={isLoading && lastType === LogType.OUT}
        disabled={!canClockOut}
        onClick={() => onPunch(LogType.OUT)}
      >
        Saída
      </Button>
    </div>
  );
};

export default TimeClockButtons;

