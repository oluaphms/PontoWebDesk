-- ============================================================
-- SmartPonto – Empresa de teste (dados fictícios, Portaria 1510)
-- ============================================================
-- Execute no Supabase: SQL Editor → colar e rodar.
-- Idempotente: ON CONFLICT atualiza os campos principais.
--
-- ID da empresa: comp_teste_pontowebdesk
-- Para vincular um usuário existente:
--   UPDATE public.users SET company_id = 'comp_teste_pontowebdesk' WHERE email = 'seu@email.com';
-- ============================================================

INSERT INTO public.companies (
  id,
  nome,
  name,
  slug,
  cnpj,
  address,
  phone,
  email,
  timezone,
  geofence,
  settings,
  bairro,
  cidade,
  cep,
  estado,
  pais,
  telefone,
  fax,
  cei,
  numero_folha,
  inscricao_estadual,
  responsavel_nome,
  responsavel_cargo,
  responsavel_email,
  receipt_fields,
  use_default_timezone,
  cartao_ponto_footer,
  created_at,
  updated_at
)
VALUES (
  'comp_teste_pontowebdesk',
  'PontoWebDesk Empresa Teste LTDA',
  'PontoWebDesk Empresa Teste LTDA',
  'pontowebdesk-empresa-teste',
  '12.345.678/0001-90',
  'Av. Paulista, 1578, Conj. 123',
  '(11) 3000-0000',
  'rh.teste@pontowebdesk.local',
  'America/Sao_Paulo',
  '{"lat": -23.5614, "lng": -46.6559, "radius": 150}'::jsonb,
  '{
    "fence": {"lat": -23.5614, "lng": -46.6559, "radius": 150},
    "allowManualPunch": true,
    "requirePhoto": false,
    "standardHours": {"start": "09:00", "end": "18:00"},
    "delayPolicy": {"toleranceMinutes": 15}
  }'::jsonb,
  'Bela Vista',
  'São Paulo',
  '01310-200',
  'SP',
  'Brasil',
  '(11) 98888-7777',
  NULL,
  '12.345.67890-12',
  '001',
  '123.456.789.110',
  'Maria Teste Silva',
  'Responsável pelo RH',
  'maria.teste@pontowebdesk.local',
  '["data", "hora", "tipo", "empresa"]'::jsonb,
  true,
  'Documento gerado em ambiente de testes – PontoWebDesk.',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  nome = EXCLUDED.nome,
  name = EXCLUDED.name,
  slug = EXCLUDED.slug,
  cnpj = EXCLUDED.cnpj,
  address = EXCLUDED.address,
  phone = EXCLUDED.phone,
  email = EXCLUDED.email,
  timezone = EXCLUDED.timezone,
  geofence = EXCLUDED.geofence,
  settings = EXCLUDED.settings,
  bairro = EXCLUDED.bairro,
  cidade = EXCLUDED.cidade,
  cep = EXCLUDED.cep,
  estado = EXCLUDED.estado,
  pais = EXCLUDED.pais,
  telefone = EXCLUDED.telefone,
  fax = EXCLUDED.fax,
  cei = EXCLUDED.cei,
  numero_folha = EXCLUDED.numero_folha,
  inscricao_estadual = EXCLUDED.inscricao_estadual,
  responsavel_nome = EXCLUDED.responsavel_nome,
  responsavel_cargo = EXCLUDED.responsavel_cargo,
  responsavel_email = EXCLUDED.responsavel_email,
  receipt_fields = EXCLUDED.receipt_fields,
  use_default_timezone = EXCLUDED.use_default_timezone,
  cartao_ponto_footer = EXCLUDED.cartao_ponto_footer,
  updated_at = NOW();

SELECT id, nome, name, cnpj
FROM public.companies
WHERE id = 'comp_teste_pontowebdesk';
