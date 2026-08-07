import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { PostgresConnectionConfig } from '../types.js';

export interface SecretsDocument {
  version: 1;
  postgresSuperuserPassword: string;
  pontowebAppPassword: string;
  pontowebMigratePassword: string;
  port: number;
  createdAt: string;
}

/**
 * Credenciais locais RC2.2 (arquivo restrito em ProgramData\Config).
 * RC2.3+: migrar para DPAPI secrets.dat.
 */
export class SecretsStore {
  constructor(private readonly secretsFile: string) {}

  generate(port: number): SecretsDocument {
    return {
      version: 1,
      postgresSuperuserPassword: crypto.randomBytes(24).toString('base64url'),
      pontowebAppPassword: crypto.randomBytes(24).toString('base64url'),
      pontowebMigratePassword: crypto.randomBytes(24).toString('base64url'),
      port,
      createdAt: new Date().toISOString(),
    };
  }

  save(doc: SecretsDocument): void {
    fs.mkdirSync(path.dirname(this.secretsFile), { recursive: true });
    fs.writeFileSync(this.secretsFile, `${JSON.stringify(doc, null, 2)}\n`, { encoding: 'utf8' });
  }

  load(): SecretsDocument | null {
    if (!fs.existsSync(this.secretsFile)) return null;
    return JSON.parse(fs.readFileSync(this.secretsFile, 'utf8')) as SecretsDocument;
  }

  loadOrCreate(port: number): SecretsDocument {
    const existing = this.load();
    if (existing) return existing;
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
