import React, { useEffect, useState } from 'react';
import { reverseGeocodeStreet } from '../utils/reverseGeocode';

type Props = {
  lat: number;
  lng: number;
  className?: string;
};

/**
 * Exibe nome da rua da coordenada (com fallback explícito).
 */
export const StreetAddress: React.FC<Props> = ({ lat, lng, className = '' }) => {
  const [line, setLine] = useState('Carregando rua…');

  useEffect(() => {
    let cancelled = false;
    void reverseGeocodeStreet(lat, lng)
      .then((t) => {
        if (!cancelled) setLine(t);
      })
      .catch((error) => {
        console.warn('[StreetAddress] reverse geocode falhou:', error);
        if (!cancelled) setLine('Endereço indisponível');
      });
    return () => {
      cancelled = true;
    };
  }, [lat, lng]);

  return <span className={className}>{line}</span>;
};
