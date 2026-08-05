/**
 * Importador universal de funcionários: mapeamento de colunas, normalização e validação.
 * Obrigatórios para linha válida: nome e/ou e-mail e/ou cpf (validação em Employees).
 */

import type { ParsedRow } from './fileParser';

export const SYSTEM_FIELDS = [
  'nome',
  'email',
  'senha',
  'cpf',
  'telefone',
  'cargo',
  'departamento',
  'escala',
  'tipo_vinculo',
  'admissao',
  'contrato_fim',
  'data_nascimento',
  'rg',
  'rg_orgao',
  'cidade',
  'estado_civil',
] as const;

export type SystemField = (typeof SYSTEM_FIELDS)[number];

/** Mapeamento: campo do sistema → nome da coluna na planilha. */
export type ColumnMapping = Partial<Record<SystemField, string>>;

/** Linha normalizada para importação (mesma estrutura usada no bulk insert). */
export interface NormalizedEmployeeRow {
  nome: string;
  email: string;
  senha: string;
  cpf: string;
  telefone: string;
  cargo: string;
  departamento: string;
  escala: string;
  tipo_vinculo: string;
  admissao: string;
  contrato_fim: string;
  data_nascimento: string;
  rg: string;
  rg_orgao: string;
  cidade: string;
  estado_civil: string;
}

/**
 * Dicionário de equivalência para detecção automática de colunas.
 * Chave = campo do sistema; valor = possíveis nomes na planilha (lowercase).
 */
export const columnAliases: Record<SystemField, string[]> = {
  nome: ['nome', 'nome completo', 'funcionario', 'colaborador', 'nome_completo', 'nome do funcionário', 'funcionário'],
  cpf: ['cpf', 'documento', 'cpf funcionario', 'cpf do funcionário', 'doc'],
  email: ['email', 'e-mail', 'e-mail do funcionário', 'mail'],
  telefone: ['telefone', 'celular', 'phone', 'fone', 'tel'],
  departamento: ['setor', 'departamento', 'area', 'área', 'departamento/setor'],
  cargo: ['cargo', 'funcao', 'função', 'função/cargo', 'position'],
  escala: ['horario', 'turno', 'escala', 'horário', 'jornada'],
  senha: ['senha', 'senha inicial', 'password'],
  tipo_vinculo: ['tipo_vinculo', 'tipo de vínculo', 'tipo vinculo', 'vinculo', 'vínculo', 'regime'],
  admissao: ['admissao', 'admissão', 'data admissao', 'data admissão', 'dt admissao'],
  contrato_fim: ['contrato_fim', 'fim contrato', 'termino contrato', 'término contrato', 'fim estágio', 'fim estagio'],
  data_nascimento: ['data_nascimento', 'nascimento', 'data nascimento', 'dt nascimento', 'dn'],
  rg: ['rg', 'identidade'],
  rg_orgao: ['rg_orgao', 'orgao emissor', 'órgão emissor', 'orgao rg', 'ssp'],
  cidade: ['cidade', 'naturalidade', 'municipio', 'município'],
  estado_civil: ['estado_civil', 'estado civil', 'civil'],
};

/**
 * Sugere mapeamento automático: para cada campo do sistema, escolhe a primeira coluna
 * cujo nome (normalizado) coincide com algum alias.
 */
export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const headerLower = new Map(headers.map((h) => [h.toLowerCase().trim(), h]));
  const aliasSet = (field: SystemField) => new Set(columnAliases[field].map((a) => a.toLowerCase().trim()));

  for (const field of SYSTEM_FIELDS) {
    const aliases = aliasSet(field);
    for (const [lower, original] of headerLower) {
      if (aliases.has(lower)) {
        mapping[field] = original;
        break;
      }
    }
    if (!mapping[field]) {
      const aliasList = columnAliases[field];
      for (const [lower, original] of headerLower) {
        if (
          aliasList.some((a) => {
            const al = a.toLowerCase().trim();
            return lower.includes(al) || al.includes(lower);
          })
        ) {
          mapping[field] = original;
          break;
        }
      }
    }
  }

  return mapping;
}

/**
 * Normaliza uma linha bruta usando o mapeamento definido pelo usuário.
 */
export function normalizeEmployee(row: ParsedRow, mapping: ColumnMapping): NormalizedEmployeeRow {
  const get = (field: SystemField): string => {
    const col = mapping[field];
    if (!col) return '';
    const v = row[col];
    return v !== undefined && v !== null ? String(v).trim() : '';
  };

  return {
    nome: get('nome') || '',
    email: get('email') || '',
    senha: get('senha') || '123456',
    cpf: get('cpf') || '',
    telefone: get('telefone') || '',
    cargo: get('cargo') || '',
    departamento: get('departamento') || '',
    escala: get('escala') || '',
    tipo_vinculo: get('tipo_vinculo') || '',
    admissao: get('admissao') || '',
    contrato_fim: get('contrato_fim') || '',
    data_nascimento: get('data_nascimento') || '',
    rg: get('rg') || '',
    rg_orgao: get('rg_orgao') || '',
    cidade: get('cidade') || '',
    estado_civil: get('estado_civil') || '',
  };
}

/**
 * Normaliza todas as linhas e remove linhas completamente vazias (sem nome, email e cpf).
 */
export function normalizeAllRows(rows: ParsedRow[], mapping: ColumnMapping): NormalizedEmployeeRow[] {
  return rows
    .map((row) => normalizeEmployee(row, mapping))
    .filter((r) => r.nome?.trim() || r.email?.trim() || r.cpf?.trim());
}
