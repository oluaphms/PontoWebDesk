/**
 * BiometricService - Autenticação biométrica via Web Authentication API (WebAuthn)
 * 
 * Permite registro de ponto usando impressão digital, Face ID ou outros
 * autenticadores biométricos nativos do dispositivo.
 */

// Verifica se o navegador é compatível com WebAuthn
const isWebAuthnSupported = (): boolean => {
    return !!(window.PublicKeyCredential && navigator.credentials);
};

// Verifica se o dispositivo possui autenticador biométrico (platform authenticator)
const isPlatformAuthenticatorAvailable = async (): Promise<boolean> => {
    if (!isWebAuthnSupported()) return false;
    try {
        return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
        return false;
    }
};

// Gera um challenge aleatório para a autenticação
const generateChallenge = (): Uint8Array => {
    return crypto.getRandomValues(new Uint8Array(32));
};

// Converte ArrayBuffer para Base64 URL-safe
const bufferToBase64url = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer);
    let str = '';
    bytes.forEach(b => str += String.fromCharCode(b));
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

// Converte Base64 URL-safe para ArrayBuffer
const base64urlToBuffer = (base64url: string): ArrayBuffer => {
    const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    const binary = atob(base64 + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
};

interface BiometricCredentialInfo {
    credentialId: string;
    publicKey: string;
    userId: string;
    createdAt: string;
    deviceName: string;
}

interface BiometricResult {
    success: boolean;
    verified: boolean;
    credentialId?: string;
    authenticatorType?: string;
    error?: string;
    timestamp: Date;
}

export const BiometricService = {
    /**
     * Verifica se a biometria está disponível neste dispositivo
     */
    async isAvailable(): Promise<{
        supported: boolean;
        platformAvailable: boolean;
        reason?: string;
    }> {
        if (!isWebAuthnSupported()) {
            return {
                supported: false,
                platformAvailable: false,
                reason: 'WebAuthn não é suportado neste navegador. Use Chrome, Firefox, Safari ou Edge atualizados.'
            };
        }

        const platformAvailable = await isPlatformAuthenticatorAvailable();

        if (!platformAvailable) {
            return {
                supported: true,
                platformAvailable: false,
                reason: 'Nenhum sensor biométrico encontrado neste dispositivo. A biometria requer impressão digital, Face ID ou Windows Hello.'
            };
        }

        // Verificar contexto seguro
        if (!window.isSecureContext) {
            return {
                supported: true,
                platformAvailable: true,
                reason: 'Biometria requer conexão segura (HTTPS).'
            };
        }

        return {
            supported: true,
            platformAvailable: true
        };
    },

    /**
     * Verifica se o usuário já tem credencial biométrica registrada
     */
    hasRegisteredCredential(userId: string): boolean {
        const key = `smartponto_biometric_${userId}`;
        try {
            return !!localStorage.getItem(key);
        } catch (err) {
            console.warn('[biometricService] Falha ao ler credencial biométrica:', err);
            return false;
        }
    },

    /**
     * Obtém informações da credencial biométrica registrada
     */
    getCredentialInfo(userId: string): BiometricCredentialInfo | null {
        const key = `smartponto_biometric_${userId}`;
        let stored: string | null = null;
        try {
            stored = localStorage.getItem(key);
        } catch (err) {
            console.warn('[biometricService] Falha ao ler info biométrica:', err);
        }
        if (!stored) return null;
        try {
            return JSON.parse(stored);
        } catch (err) {
            console.warn('[biometricService] Falha ao parsear info biométrica:', err);
            return null;
        }
    },

    /**
     * Registra uma nova credencial biométrica para o usuário
     * Chamado na primeira vez que o usuário quer usar biometria
     */
    async register(userId: string, userName: string): Promise<BiometricResult> {
        try {
            const availability = await this.isAvailable();
            if (!availability.platformAvailable) {
                return {
                    success: false,
                    verified: false,
                    error: availability.reason || 'Biometria não disponível',
                    timestamp: new Date()
                };
            }

            const challenge = generateChallenge();
            const userIdBuffer = new TextEncoder().encode(userId);

            // Opções de criação de credencial - usando o autenticador da plataforma (fingerprint/face)
            const createOptions: PublicKeyCredentialCreationOptions = {
                challenge,
                rp: {
                    name: 'SmartPonto',
                    id: window.location.hostname
                },
                user: {
                    id: userIdBuffer,
                    name: userName,
                    displayName: userName
                },
                pubKeyCredParams: [
                    { alg: -7, type: 'public-key' },   // ES256
                    { alg: -257, type: 'public-key' }   // RS256
                ],
                authenticatorSelection: {
                    authenticatorAttachment: 'platform', // Forçar biometria do dispositivo
                    userVerification: 'required',        // Exigir verificação biométrica
                    residentKey: 'preferred'
                },
                timeout: 60000,
                attestation: 'none'
            };

            const credential = await navigator.credentials.create({
                publicKey: createOptions
            }) as PublicKeyCredential;

            if (!credential) {
                return {
                    success: false,
                    verified: false,
                    error: 'Registro cancelado pelo usuário.',
                    timestamp: new Date()
                };
            }

            const response = credential.response as AuthenticatorAttestationResponse;
            const credentialId = bufferToBase64url(credential.rawId);
            const publicKey = bufferToBase64url(response.getPublicKey?.() || new ArrayBuffer(0));

            // Detectar tipo de dispositivo
            const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
            const deviceName = isMobile
                ? (/iPhone|iPad|iPod/i.test(navigator.userAgent) ? 'Face ID / Touch ID' : 'Impressão Digital Android')
                : (/Windows/i.test(navigator.userAgent) ? 'Windows Hello' : 'Biometria do Sistema');

            // Salvar credencial localmente
            const credInfo: BiometricCredentialInfo = {
                credentialId,
                publicKey,
                userId,
                createdAt: new Date().toISOString(),
                deviceName
            };

            try {
                localStorage.setItem(`smartponto_biometric_${userId}`, JSON.stringify(credInfo));
            } catch (err) {
                console.warn('[biometricService] Falha ao salvar credencial biométrica:', err);
            }

            console.log('✅ Biometria registrada com sucesso:', deviceName);

            return {
                success: true,
                verified: true,
                credentialId,
                authenticatorType: deviceName,
                timestamp: new Date()
            };

        } catch (error: any) {
            console.error('❌ Erro ao registrar biometria:', error);

            let errorMessage = 'Erro ao registrar biometria.';
            if (error.name === 'NotAllowedError') {
                errorMessage = 'Registro cancelado. Toque em "Registrar Biometria" e use seu sensor biométrico.';
            } else if (error.name === 'InvalidStateError') {
                errorMessage = 'Esta credencial já está registrada neste dispositivo.';
            } else if (error.name === 'SecurityError') {
                errorMessage = 'Erro de segurança. Verifique a conexão HTTPS.';
            }

            return {
                success: false,
                verified: false,
                error: errorMessage,
                timestamp: new Date()
            };
        }
    },

    /**
     * Autentica o usuário usando a biometria registrada
     * Chamado para validar o registro de ponto
     */
    async authenticate(userId: string): Promise<BiometricResult> {
        try {
            const availability = await this.isAvailable();
            if (!availability.platformAvailable) {
                return {
                    success: false,
                    verified: false,
                    error: availability.reason || 'Biometria não disponível',
                    timestamp: new Date()
                };
            }

            const credInfo = this.getCredentialInfo(userId);
            if (!credInfo) {
                return {
                    success: false,
                    verified: false,
                    error: 'Nenhuma biometria registrada. Configure sua biometria primeiro.',
                    timestamp: new Date()
                };
            }

            const challenge = generateChallenge();

            const assertionOptions: PublicKeyCredentialRequestOptions = {
                challenge,
                rpId: window.location.hostname,
                allowCredentials: [{
                    id: base64urlToBuffer(credInfo.credentialId),
                    type: 'public-key',
                    transports: ['internal'] // Autenticador do dispositivo
                }],
                userVerification: 'required',
                timeout: 60000
            };

            const assertion = await navigator.credentials.get({
                publicKey: assertionOptions
            }) as PublicKeyCredential;

            if (!assertion) {
                return {
                    success: false,
                    verified: false,
                    error: 'Autenticação cancelada pelo usuário.',
                    timestamp: new Date()
                };
            }

            // Verificação simplificada (em produção, seria validado pelo servidor)
            const assertionResponse = assertion.response as AuthenticatorAssertionResponse;
            const authenticatorData = new Uint8Array(assertionResponse.authenticatorData);

            // Verificar flag de user presence (bit 0) e user verification (bit 2)
            const flags = authenticatorData[32]; // Byte de flags
            const userPresent = !!(flags & 0x01);
            const userVerified = !!(flags & 0x04);

            if (!userPresent || !userVerified) {
                return {
                    success: false,
                    verified: false,
                    error: 'Verificação biométrica falhou. Tente novamente.',
                    timestamp: new Date()
                };
            }

            console.log('✅ Autenticação biométrica validada:', {
                credentialId: credInfo.credentialId.substring(0, 20) + '...',
                userPresent,
                userVerified,
                deviceName: credInfo.deviceName
            });

            return {
                success: true,
                verified: true,
                credentialId: credInfo.credentialId,
                authenticatorType: credInfo.deviceName,
                timestamp: new Date()
            };

        } catch (error: any) {
            console.error('❌ Erro na autenticação biométrica:', error);

            let errorMessage = 'Erro na autenticação biométrica.';
            if (error.name === 'NotAllowedError') {
                errorMessage = 'Autenticação cancelada. Use seu sensor biométrico quando solicitado.';
            } else if (error.name === 'SecurityError') {
                errorMessage = 'Erro de segurança. Verifique a conexão HTTPS.';
            } else if (error.name === 'InvalidStateError') {
                errorMessage = 'Credencial inválida. Tente registrar novamente.';
            }

            return {
                success: false,
                verified: false,
                error: errorMessage,
                timestamp: new Date()
            };
        }
    },

    /**
     * Remove a credencial biométrica registrada
     */
    removeCredential(userId: string): void {
        localStorage.removeItem(`smartponto_biometric_${userId}`);
        console.log('🗑️ Credencial biométrica removida para:', userId);
    }
};
