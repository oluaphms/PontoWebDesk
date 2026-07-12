import type { TipoVinculo } from '../../../constants/cadastroTrabalhista';

/** Configuração adicional do funcionário (employee_config JSONB) */
export interface EmployeeConfig {
  photo_url?: string;
  assinatura_digital?: string; // hash ou indicação
  perifericos?: 'padrao' | 'habilitado' | 'desabilitado';
  dados_web?: {
    senha_web?: string;
    periodo_encerrado?: string;
    nao_alterar_dados_web?: boolean;
    nao_inclusao_ponto_manual?: boolean;
    bloquear_web?: boolean;
    controlar_solicitacoes?: 'aceitar_local' | 'marcar_vistos' | '';
  };
  afastamentos?: { periodo_inicio: string; periodo_fim: string; justificativa: string; motivo: string }[];
}

export interface EmployeeRow {
  id: string;
  legacy_id?: string;
  nome: string;
  cpf?: string;
  email: string;
  role?: string;
  phone?: string;
  cargo: string;
  department_id?: string;
  department_name?: string;
  departamento?: string;
  schedule_id?: string;
  schedule_name?: string;
  shift_id?: string;
  shift_label?: string;
  estrutura_id?: string;
  estrutura_name?: string;
  status: string;
  created_at: string;
  numero_folha?: string;
  salario_base?: number | null;
  pis_pasep?: string;
  numero_identificador?: string;
  ctps?: string;
  admissao?: string;
  demissao?: string;
  motivo_demissao_id?: string;
  motivo_demissao_name?: string;
  observacoes?: string;
  invisivel?: boolean;
  employee_config?: EmployeeConfig;
  company_name?: string;
  tipo_vinculo?: TipoVinculo;
  contrato_fim?: string;
  data_nascimento?: string;
  rg?: string;
  rg_orgao?: string;
  /** Naturalidade / cidade (texto ou legado resolvido a partir de cidade_id). */
  naturalidade?: string | null;
  /** Estado civil (texto ou legado resolvido a partir de estado_civil_id). */
  estado_civil_text?: string | null;
  endereco_rua?: string | null;
  endereco_numero?: string | null;
  endereco_bairro?: string | null;
  endereco_cidade?: string | null;
  endereco_estado?: string | null;
  endereco_cep?: string | null;
  jornada_tipo?: string;
  carga_horaria?: number;
  endereco?: string;
  reliability_score?: number;
}
