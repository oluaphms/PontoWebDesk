import { observabilityConsole } from '../../services/observabilityConsole.js';
/**
 * Teste manual CRUD colaboradores (requer API rodando + JWT).
 * Uso: cd backend && node scripts/test-employees-crud.mjs
 */
const base = (process.env.API_BASE || 'http://127.0.0.1:3000/api').replace(/\/+$/, '');

async function req(method, path, body, token) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const email = process.env.TEST_EMAIL || 'admin@test.com';
const password = process.env.TEST_PASSWORD || 'admin123';

const login = await req('POST', '/api/auth/login', { identifier: email, password });
if (!login.json?.token) {
  observabilityConsole.error('Login falhou', login);
  process.exit(1);
}
const token = login.json.token;
const companyId = login.json.user?.company_id || process.env.TEST_COMPANY_ID;
observabilityConsole.log('[OK] login', companyId);

const created = await req(
  'POST',
  '/employees',
  {
    company_id: companyId,
    nome: 'Teste API Completo',
    cpf: '529.982.247-25',
    email: `teste.${Date.now()}@empresa.local`,
    telefone: '11999990000',
    data_admissao: '2024-06-01',
    cargo: 'Analista RH',
    departamento: 'Recursos Humanos',
    salario: 5200.5,
    jornada_tipo: '44h_semanais',
    carga_horaria: 8,
    endereco: 'Rua Teste, 100, Centro, São Paulo - SP',
  },
  token,
);
observabilityConsole.log('[CREATE]', created.status, created.json);
const id = created.json?.employee?.id;
if (!id) process.exit(1);

const list = await req('GET', `/employees?companyId=${encodeURIComponent(companyId)}`, null, token);
const found = (list.json?.employees || []).find((e) => e.id === id);
observabilityConsole.log('[LIST]', found ? 'campos OK' : 'não encontrado', found);

const updated = await req(
  'PATCH',
  `/employees/${id}`,
  { cargo: 'Coordenador RH', salario: 5800 },
  token,
);
observabilityConsole.log('[PATCH]', updated.status, updated.json?.employee?.cargo);

const removed = await req('DELETE', `/employees/${id}`, null, token);
observabilityConsole.log('[DELETE]', removed.status, removed.json);
observabilityConsole.log('[DONE] CRUD colaboradores');
