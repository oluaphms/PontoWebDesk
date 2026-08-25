import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PostgresConnectionConfig } from '../types.js';
import {
  resolveProfessionalMasterDefaults,
} from './professionalSeedDefaults.js';

export {
  DEFAULT_MASTER_OWNER_1_EMAIL,
  DEFAULT_MASTER_OWNER_1_NAME,
  DEFAULT_MASTER_OWNER_2_EMAIL,
  DEFAULT_MASTER_OWNER_2_NAME,
} from './professionalSeedDefaults.js';

export interface SecretsDocument {
  version: 1;
  postgresSuperuserPassword: string;
  pontowebAppPassword: string;
  pontowebMigratePassword: string;
  /** JWT da API operacional (gerado no install; persistido para reinstall). */
  jwtSecret?: string;
  /** JWT do Painel Master (MASTER_JWT_SECRET). */
  masterJwtSecret?: string;
  /** Bootstrap Master Owner slot 1 — persistido; senha só usada na 1ª criação. */
  masterOwner1Email?: string;
  masterOwner1Password?: string;
  masterOwner1Name?: string;
  /** Bootstrap Master Owner slot 2. */
  masterOwner2Email?: string;
  masterOwner2Password?: string;
  masterOwner2Name?: string;
  port: number;
  createdAt: string;
}

function randomSecret(bytes: number): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

/**
 * Credenciais locais RC2.2 (arquivo restrito em ProgramData\Config).
 * RC2.3+: migrar para DPAPI secrets.dat.
 */
export class SecretsStore {
  constructor(private readonly secretsFile: string) {}

  generate(port: number): SecretsDocument {
    const masters = resolveProfessionalMasterDefaults();
    return {
      version: 1,
      postgresSuperuserPassword: randomSecret(24),
      pontowebAppPassword: randomSecret(24),
      pontowebMigratePassword: randomSecret(24),
      jwtSecret: randomSecret(48),
      masterJwtSecret: randomSecret(48),
      masterOwner1Email: masters.owner1Email,
      masterOwner1Password: masters.owner1Password,
      masterOwner1Name: masters.owner1Name,
      masterOwner2Email: masters.owner2Email,
      masterOwner2Password: masters.owner2Password,
      masterOwner2Name: masters.owner2Name,
      port,
      createdAt: new Date().toISOString(),
    };
  }

  /** Garante jwtSecret em installs antigos (secrets.json sem o campo). */
  ensureJwtSecret(doc: SecretsDocument): SecretsDocument {
    if (doc.jwtSecret && doc.jwtSecret.length >= 32) return doc;
    const next = { ...doc, jwtSecret: randomSecret(48) };
    this.save(next);
    return next;
  }

  /**
   * Garante campos MASTER_* para ensureBootstrapOwners.
   * Idempotente: não regenera senha/segredo já persistidos.
   */
  ensureMasterBootstrap(doc: SecretsDocument): SecretsDocument {
    let changed = false;
    const next: SecretsDocument = { ...doc };
    const masters = resolveProfessionalMasterDefaults();

    if (!next.masterJwtSecret || next.masterJwtSecret.length < 32) {
      next.masterJwtSecret = randomSecret(48);
      changed = true;
    }

    const email1 = String(next.masterOwner1Email || '').trim().toLowerCase();
    const password1 = String(next.masterOwner1Password || '');
    const name1 = String(next.masterOwner1Name || '').trim();

    if (!email1 || !password1 || password1.length < 8) {
      next.masterOwner1Email = email1 || masters.owner1Email;
      next.masterOwner1Password = password1.length >= 8 ? password1 : masters.owner1Password;
      next.masterOwner1Name = name1 || masters.owner1Name;
      changed = true;
    } else if (!name1) {
      next.masterOwner1Name = masters.owner1Name;
      changed = true;
    }

    const email2 = String(next.masterOwner2Email || '').trim().toLowerCase();
    const password2 = String(next.masterOwner2Password || '');
    const name2 = String(next.masterOwner2Name || '').trim();

    if (!email2 || !password2 || password2.length < 8) {
      next.masterOwner2Email = email2 || masters.owner2Email;
      next.masterOwner2Password = password2.length >= 8 ? password2 : masters.owner2Password;
      next.masterOwner2Name = name2 || masters.owner2Name;
      changed = true;
    } else if (!name2) {
      next.masterOwner2Name = masters.owner2Name;
      changed = true;
    }

    if (changed) this.save(next);
    return next;
  }

  /** jwt + Master bootstrap (ordem usada no provisionamento). */
  ensureInstallSecrets(doc: SecretsDocument): SecretsDocument {
    return this.ensureMasterBootstrap(this.ensureJwtSecret(doc));
  }

  save(doc: SecretsDocument): void {
    fs.mkdirSync(path.dirname(this.secretsFile), { recursive: true });
    // UTF-8 sem BOM — evita JSON.parse falhar no bootstrap.
    fs.writeFileSync(this.secretsFile, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8' });
  }

  load(): SecretsDocument | null {
    if (!fs.existsSync(this.secretsFile)) return null;
    const raw = fs.readFileSync(this.secretsFile, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(raw) as SecretsDocument;
  }

  loadOrCreate(port: number): SecretsDocument {
    const existing = this.load();
    if (existing) return this.ensureInstallSecrets(existing);
    const doc = this.generate(port);
    this.save(doc);
    return doc;
  }

  toConnectionConfig(secrets: SecretsDocument): Omit<PostgresConnectionConfig, 'database'> {
    return {
      host: '127.0.0.1',
      port: secrets.port,
      superuser: 'postgres',
      superuserPassword: secrets.postgresSuperuserPassword,
      appUser: 'pontoweb_app',
      appPassword: secrets.pontowebAppPassword,
      migrateUser: 'pontoweb_migrate',
      migratePassword: secrets.pontowebMigratePassword,
    };
  }
}
