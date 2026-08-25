/**
 * Contas padrão do Professional (lab/primeiro boot).
 * Override via RC2_MASTER_OWNER_* / RC2_SEED_* — não logar senhas.
 */

export const DEFAULT_MASTER_OWNER_1_EMAIL = 'admciro@sergiponto.com.br';
export const DEFAULT_MASTER_OWNER_1_NAME = 'Adm Ciro';
export const DEFAULT_MASTER_OWNER_1_PASSWORD = '123456789';

export const DEFAULT_MASTER_OWNER_2_EMAIL = 'paulohmorais@hotmail.com';
export const DEFAULT_MASTER_OWNER_2_NAME = 'Paulo Henrique';
export const DEFAULT_MASTER_OWNER_2_PASSWORD = 'P@hms70548084';

export const DEFAULT_SEED_COMPANY_NAME = 'FL LOCADORA LTDA';
export const DEFAULT_SEED_COMPANY_CNPJ = '15048950000163';
export const DEFAULT_SEED_COMPANY_SLUG = 'fl-locadora';

export const DEFAULT_SEED_ADMIN_EMAIL = 'admin@pontowebdesk.com';
export const DEFAULT_SEED_ADMIN_PASSWORD = 'admin123';
export const DEFAULT_SEED_ADMIN_NAME = 'Administrador';
export const DEFAULT_SEED_ADMIN_ROLE = 'admin';

export const DEFAULT_SEED_COLLAB_EMAIL = 'paulohmorais@hotmail.com';
export const DEFAULT_SEED_COLLAB_PASSWORD = 'P@hms70548084';
export const DEFAULT_SEED_COLLAB_NAME = 'Paulo Henrique';
export const DEFAULT_SEED_COLLAB_ROLE = 'employee';

function envOr(key: string, fallback: string): string {
  const v = String(process.env[key] || '').trim();
  return v || fallback;
}

export function resolveProfessionalMasterDefaults() {
  return {
    owner1Email: envOr('RC2_MASTER_OWNER_1_EMAIL', DEFAULT_MASTER_OWNER_1_EMAIL).toLowerCase(),
    owner1Name: envOr('RC2_MASTER_OWNER_1_NAME', DEFAULT_MASTER_OWNER_1_NAME),
    owner1Password: envOr('RC2_MASTER_OWNER_1_PASSWORD', DEFAULT_MASTER_OWNER_1_PASSWORD),
    owner2Email: envOr('RC2_MASTER_OWNER_2_EMAIL', DEFAULT_MASTER_OWNER_2_EMAIL).toLowerCase(),
    owner2Name: envOr('RC2_MASTER_OWNER_2_NAME', DEFAULT_MASTER_OWNER_2_NAME),
    owner2Password: envOr('RC2_MASTER_OWNER_2_PASSWORD', DEFAULT_MASTER_OWNER_2_PASSWORD),
  };
}

export function resolveProfessionalCompanySeedDefaults() {
  return {
    companyName: envOr('RC2_SEED_COMPANY_NAME', DEFAULT_SEED_COMPANY_NAME),
    companyCnpj: envOr('RC2_SEED_COMPANY_CNPJ', DEFAULT_SEED_COMPANY_CNPJ).replace(/\D/g, ''),
    companySlug: envOr('RC2_SEED_COMPANY_SLUG', DEFAULT_SEED_COMPANY_SLUG),
    adminEmail: envOr('RC2_SEED_ADMIN_EMAIL', DEFAULT_SEED_ADMIN_EMAIL).toLowerCase(),
    adminPassword: envOr('RC2_SEED_ADMIN_PASSWORD', DEFAULT_SEED_ADMIN_PASSWORD),
    adminName: envOr('RC2_SEED_ADMIN_NAME', DEFAULT_SEED_ADMIN_NAME),
    adminRole: envOr('RC2_SEED_ADMIN_ROLE', DEFAULT_SEED_ADMIN_ROLE),
    collabEmail: envOr('RC2_SEED_COLLAB_EMAIL', DEFAULT_SEED_COLLAB_EMAIL).toLowerCase(),
    collabPassword: envOr('RC2_SEED_COLLAB_PASSWORD', DEFAULT_SEED_COLLAB_PASSWORD),
    collabName: envOr('RC2_SEED_COLLAB_NAME', DEFAULT_SEED_COLLAB_NAME),
    collabRole: envOr('RC2_SEED_COLLAB_ROLE', DEFAULT_SEED_COLLAB_ROLE),
  };
}
