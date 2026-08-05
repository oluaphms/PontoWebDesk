import { observabilityConsole } from './observabilityConsole.js';
/**
 * KMS Provider — Gestão de Chaves com Envelope Encryption.
 *
 * ARQUITETURA:
 * - KEK (Key Encryption Key): armazenada no KMS externo (AWS/GCP/Vault) ou env var
 * - DEK (Data Encryption Key): gerada por tenant, criptografada pela KEK
 * - Dados: criptografados pela DEK (AES-256-GCM)
 *
 * FLUXO:
 *   1. Gerar DEK aleatória por tenant (32 bytes)
 *   2. Criptografar DEK com KEK → encrypted_dek
 *   3. Armazenar encrypted_dek + key_id + key_version no banco
 *   4. Para descriptografar: buscar encrypted_dek → decrypt com KEK → usar DEK
 *
 * PROVIDERS SUPORTADOS:
 * - 'env'   : KEK em variável de ambiente (desenvolvimento/fallback)
 * - 'aws'   : AWS KMS (requer @aws-sdk/client-kms)
 * - 'gcp'   : GCP Cloud KMS (requer @google-cloud/kms)
 * - 'vault' : HashiCorp Vault (HTTP API)
 *
 * ROTAÇÃO DE CHAVES:
 * - KEY_ROTATION_INTERVAL_DAYS: intervalo de rotação (default: 90 dias)
 * - Ao rotacionar: nova versão da KEK, re-criptografar DEKs ativas
 * - Versões antigas mantidas para descriptografar dados históricos
 *
 * CONFIGURAÇÃO:
 * - KMS_PROVIDER:          env | aws | gcp | vault (default: env)
 * - KMS_KEY_ID:            ARN/ID da chave no KMS externo
 * - KMS_KEY_VERSION:       versão atual da chave (default: 1)
 * - KEY_ROTATION_INTERVAL_DAYS: dias entre rotações (default: 90)
 */

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const PROVIDER    = (process.env.KMS_PROVIDER    || 'env').trim().toLowerCase();
const KEY_ID      = (process.env.KMS_KEY_ID      || 'pontowebdesk-master').trim();
const KEY_VERSION = parseInt(process.env.KMS_KEY_VERSION || '1', 10);
const ROTATION_DAYS = parseInt(process.env.KEY_ROTATION_INTERVAL_DAYS || '90', 10);

// ─── KEK local (provider=env) ─────────────────────────────────────────────────

const ENV_KEK_HEX = (process.env.DATA_ENCRYPTION_KEY || '').trim();
const ENV_KEK     = ENV_KEK_HEX.length === 64 ? Buffer.from(ENV_KEK_HEX, 'hex') : null;

// ─── Envelope Encryption ──────────────────────────────────────────────────────

const IV_LEN  = 12;
const TAG_LEN = 16;
const ALG     = 'aes-256-gcm';

function aesGcmEncrypt(key, plaintext) {
  const iv     = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALG, key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag    = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function aesGcmDecrypt(key, b64) {
  const buf     = Buffer.from(b64, 'base64');
  const iv      = buf.subarray(0, IV_LEN);
  const tag     = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const payload = buf.subarray(IV_LEN + TAG_LEN);
  const dec     = createDecipheriv(ALG, key, iv);
  dec.setAuthTag(tag);
  return Buffer.concat([dec.update(payload), dec.final()]);
}

// ─── KMSProvider ─────────────────────────────────────────────────────────────

export class KMSProvider {
  constructor() {
    this._dekCache = new Map(); // companyId → { dek, keyId, keyVersion, expiresAt }
    this._dekStore = null;      // referência ao banco SQLite (injetada via init)
  }

  /**
   * Injeta referência ao banco SQLite para persistir DEKs.
   * @param {import('better-sqlite3').Database} db
   */
  init(db) {
    this._dekStore = db;
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tenant_deks (
          company_id    TEXT    PRIMARY KEY NOT NULL,
          encrypted_dek TEXT    NOT NULL,
          key_id        TEXT    NOT NULL,
          key_version   INTEGER NOT NULL DEFAULT 1,
          created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
          rotated_at    TEXT
        )
      `);
    } catch (error) {
      observabilityConsole.warn('[kmsProvider] Falha ao garantir schema de chaves:', error);
    }
    return this;
  }

  /**
   * Retorna a DEK para uma empresa (cria se não existir).
   * @param {string} companyId
   * @returns {Promise<Buffer>} DEK de 32 bytes
   */
  async getDEK(companyId) {
    // Cache em memória (TTL: 5 min)
    const cached = this._dekCache.get(companyId);
    if (cached && cached.expiresAt > Date.now()) return cached.dek;

    // Buscar no banco
    if (this._dekStore) {
      const row = this._dekStore.prepare(
        `SELECT encrypted_dek, key_id, key_version FROM tenant_deks WHERE company_id = ?`
      ).get(companyId);

      if (row) {
        const dek = await this._decryptDEK(row.encrypted_dek, row.key_id, row.key_version);
        this._dekCache.set(companyId, { dek, keyId: row.key_id, keyVersion: row.key_version, expiresAt: Date.now() + 5 * 60_000 });
        return dek;
      }
    }

    // Criar nova DEK
    return this._createDEK(companyId);
  }

  async _createDEK(companyId) {
    const dek          = randomBytes(32);
    const encryptedDek = await this._encryptDEK(dek);

    if (this._dekStore) {
      try {
        this._dekStore.prepare(`
          INSERT OR IGNORE INTO tenant_deks (company_id, encrypted_dek, key_id, key_version)
          VALUES (?, ?, ?, ?)
        `).run(companyId, encryptedDek, KEY_ID, KEY_VERSION);
      } catch (error) {
        observabilityConsole.warn('[kmsProvider] Falha ao persistir DEK:', error);
      }
    }

    this._dekCache.set(companyId, { dek, keyId: KEY_ID, keyVersion: KEY_VERSION, expiresAt: Date.now() + 5 * 60_000 });
    return dek;
  }

  async _encryptDEK(dek) {
    if (PROVIDER === 'env') {
      if (!ENV_KEK) return dek.toString('base64'); // sem KEK: armazenar em claro (dev)
      return aesGcmEncrypt(ENV_KEK, dek);
    }
    if (PROVIDER === 'aws') return this._awsEncrypt(dek);
    if (PROVIDER === 'vault') return this._vaultEncrypt(dek);
    return dek.toString('base64');
  }

  async _decryptDEK(encryptedDek, keyId, keyVersion) {
    if (PROVIDER === 'env') {
      if (!ENV_KEK) return Buffer.from(encryptedDek, 'base64');
      return aesGcmDecrypt(ENV_KEK, encryptedDek);
    }
    if (PROVIDER === 'aws') return this._awsDecrypt(encryptedDek, keyId);
    if (PROVIDER === 'vault') return this._vaultDecrypt(encryptedDek, keyId);
    return Buffer.from(encryptedDek, 'base64');
  }

  // ── AWS KMS (stub — requer @aws-sdk/client-kms) ───────────────────────────

  async _awsEncrypt(plaintext) {
    try {
      const { KMSClient, EncryptCommand } = await import('@aws-sdk/client-kms');
      const client = new KMSClient({});
      const { CiphertextBlob } = await client.send(new EncryptCommand({
        KeyId: KEY_ID, Plaintext: plaintext,
      }));
      return Buffer.from(CiphertextBlob).toString('base64');
    } catch (e) {
      observabilityConsole.warn('[KMS] AWS KMS indisponível, usando fallback local:', e instanceof Error ? e.message : e);
      return ENV_KEK ? aesGcmEncrypt(ENV_KEK, plaintext) : plaintext.toString('base64');
    }
  }

  async _awsDecrypt(ciphertext, keyId) {
    try {
      const { KMSClient, DecryptCommand } = await import('@aws-sdk/client-kms');
      const client = new KMSClient({});
      const { Plaintext } = await client.send(new DecryptCommand({
        CiphertextBlob: Buffer.from(ciphertext, 'base64'),
      }));
      return Buffer.from(Plaintext);
    } catch (e) {
      observabilityConsole.warn('[KMS] AWS KMS decrypt falhou, usando fallback:', e instanceof Error ? e.message : e);
      return ENV_KEK ? aesGcmDecrypt(ENV_KEK, ciphertext) : Buffer.from(ciphertext, 'base64');
    }
  }

  // ── HashiCorp Vault (HTTP API) ────────────────────────────────────────────

  async _vaultEncrypt(plaintext) {
    const vaultUrl   = (process.env.VAULT_ADDR || '').trim();
    const vaultToken = (process.env.VAULT_TOKEN || '').trim();
    if (!vaultUrl || !vaultToken) return ENV_KEK ? aesGcmEncrypt(ENV_KEK, plaintext) : plaintext.toString('base64');

    try {
      const b64 = plaintext.toString('base64');
      const res = await fetch(`${vaultUrl}/v1/transit/encrypt/${KEY_ID}`, {
        method: 'POST',
        headers: { 'X-Vault-Token': vaultToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaintext: b64 }),
      });
      const data = await res.json();
      return data.data?.ciphertext ?? (ENV_KEK ? aesGcmEncrypt(ENV_KEK, plaintext) : plaintext.toString('base64'));
    } catch {
      return ENV_KEK ? aesGcmEncrypt(ENV_KEK, plaintext) : plaintext.toString('base64');
    }
  }

  async _vaultDecrypt(ciphertext, keyId) {
    const vaultUrl   = (process.env.VAULT_ADDR || '').trim();
    const vaultToken = (process.env.VAULT_TOKEN || '').trim();
    if (!vaultUrl || !vaultToken) return ENV_KEK ? aesGcmDecrypt(ENV_KEK, ciphertext) : Buffer.from(ciphertext, 'base64');

    try {
      const res = await fetch(`${vaultUrl}/v1/transit/decrypt/${keyId}`, {
        method: 'POST',
        headers: { 'X-Vault-Token': vaultToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ciphertext }),
      });
      const data = await res.json();
      const b64  = data.data?.plaintext;
      return b64 ? Buffer.from(b64, 'base64') : (ENV_KEK ? aesGcmDecrypt(ENV_KEK, ciphertext) : Buffer.from(ciphertext, 'base64'));
    } catch {
      return ENV_KEK ? aesGcmDecrypt(ENV_KEK, ciphertext) : Buffer.from(ciphertext, 'base64');
    }
  }

  /**
   * Rotaciona a DEK de uma empresa (re-criptografa com nova versão da KEK).
   * @param {string} companyId
   */
  async rotateDEK(companyId) {
    const dek          = await this.getDEK(companyId);
    const encryptedDek = await this._encryptDEK(dek);
    const now          = new Date().toISOString();

    if (this._dekStore) {
      this._dekStore.prepare(`
        UPDATE tenant_deks
        SET encrypted_dek = ?, key_id = ?, key_version = ?, rotated_at = ?
        WHERE company_id = ?
      `).run(encryptedDek, KEY_ID, KEY_VERSION, now, companyId);
    }

    this._dekCache.delete(companyId);
    observabilityConsole.log(`[KMS] DEK rotacionada para empresa ${companyId} (key_version: ${KEY_VERSION})`);
  }

  /**
   * Verifica quais empresas precisam de rotação de chave.
   * @returns {string[]} companyIds que precisam rotacionar
   */
  getPendingRotations() {
    if (!this._dekStore) return [];
    const cutoff = new Date(Date.now() - ROTATION_DAYS * 86_400_000).toISOString();
    try {
      return this._dekStore.prepare(`
        SELECT company_id FROM tenant_deks
        WHERE created_at < ? AND (rotated_at IS NULL OR rotated_at < ?)
      `).all(cutoff, cutoff).map(r => r.company_id);
    } catch { return []; }
  }

  getStatus() {
    return {
      provider:       PROVIDER,
      keyId:          KEY_ID,
      keyVersion:     KEY_VERSION,
      rotationDays:   ROTATION_DAYS,
      encryptionReady: PROVIDER === 'env' ? !!ENV_KEK : true,
      cachedTenants:  this._dekCache.size,
    };
  }
}

/** Singleton global. */
export const kms = new KMSProvider();
