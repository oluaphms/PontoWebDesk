import React, { useEffect, useState } from 'react';
import { reverseGeocode } from '../utils/reverseGeocode';

type Props = {
  lat: number;
  lng: number;
  className?: string;
};

/**
 * Exibe endereço por rua (geocodificação reversa), sem coordenadas.
 */
export const StreetAddress: React.FC<Props> = ({ lat, lng, className = '' }) => {
  const [line, setLine] = useState('Carregando endereço…');

  useEffect(() => {
    let cancelled = false;
    void reverseGeocode(lat, lng).then((t) => {
      if (!cancelled) setLine(t);
    });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return <span className={className}>{line}</span>;
};
