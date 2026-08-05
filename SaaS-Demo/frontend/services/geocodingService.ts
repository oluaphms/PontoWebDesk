import { observabilityConsole } from '../src/shared/logger/observabilityConsole';
/**
 * GeocodingService - Serviço de geocodificação reversa
 * 
 * Utiliza a API gratuita do OpenStreetMap (Nominatim) para converter
 * coordenadas GPS em endereços legíveis.
 */

interface GeocodingResult {
    address: string;
    neighborhood: string;
    city: string;
    state: string;
    country: string;
    fullAddress: string;
    raw?: any;
}

// Cache de resultados para evitar requisições duplicadas
const geocodingCache = new Map<string, GeocodingResult>();

// Função para gerar chave de cache baseada nas coordenadas (arredondadas para ~11m de precisão)
const getCacheKey = (lat: number, lng: number): string => {
    return `${lat.toFixed(4)},${lng.toFixed(4)}`;
};

export const GeocodingService = {
    /**
     * Converte coordenadas em um endereço legível
     * Usa a API Nominatim do OpenStreetMap (gratuita, sem chave)
     */
    async reverseGeocode(lat: number, lng: number): Promise<GeocodingResult | null> {
        const cacheKey = getCacheKey(lat, lng);

        // Verificar cache primeiro
        if (geocodingCache.has(cacheKey)) {
            observabilityConsole.log('📍 Geocoding: usando cache para', cacheKey);
            return geocodingCache.get(cacheKey)!;
        }

        try {
            // Nominatim exige User-Agent identificável
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=pt-BR`,
                {
                    headers: {
                        'Accept': 'application/json',
                        // Nominatim requer identificação do app
                    }
                }
            );

            if (!response.ok) {
                observabilityConsole.warn('Geocoding API retornou erro:', response.status);
                return null;
            }

            const data = await response.json();

            if (!data || data.error) {
                observabilityConsole.warn('Geocoding: nenhum resultado encontrado');
                return null;
            }

            const addr = data.address || {};

            const result: GeocodingResult = {
                address: [
                    addr.road || addr.pedestrian || addr.footway || '',
                    addr.house_number || ''
                ].filter(Boolean).join(', ') || data.display_name?.split(',')[0] || 'Endereço não identificado',

                neighborhood: addr.suburb || addr.neighbourhood || addr.quarter || addr.district || '',

                city: addr.city || addr.town || addr.village || addr.municipality || '',

                state: addr.state || '',

                country: addr.country || 'Brasil',

                fullAddress: data.display_name || '',

                raw: data
            };

            // Salvar no cache
            geocodingCache.set(cacheKey, result);

            observabilityConsole.log('📍 Geocoding:', result.address, '-', result.neighborhood, '-', result.city);

            return result;

        } catch (error) {
            observabilityConsole.error('❌ Erro no geocoding:', error);
            return null;
        }
    },

    /**
     * Retorna um endereço formatado de forma resumida
     */
    formatShortAddress(result: GeocodingResult): string {
        const parts: string[] = [];

        if (result.address && result.address !== 'Endereço não identificado') {
            parts.push(result.address);
        }

        if (result.neighborhood) {
            parts.push(result.neighborhood);
        }

        if (parts.length === 0 && result.city) {
            parts.push(result.city);
        }

        return parts.join(' • ') || 'Localização identificada';
    },

    /**
     * Retorna o endereço completo formatado
     */
    formatFullAddress(result: GeocodingResult): string {
        const parts: string[] = [];

        if (result.address && result.address !== 'Endereço não identificado') {
            parts.push(result.address);
        }
        if (result.neighborhood) {
            parts.push(result.neighborhood);
        }
        if (result.city) {
            parts.push(result.city);
        }
        if (result.state) {
            parts.push(result.state);
        }

        return parts.join(', ') || 'Localização identificada';
    },

    /**
     * Limpa o cache de geocoding
     */
    clearCache(): void {
        geocodingCache.clear();
    }
};
