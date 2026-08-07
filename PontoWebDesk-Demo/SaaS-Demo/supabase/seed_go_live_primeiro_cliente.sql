-- ============================================================
-- Seed GO LIVE - Primeiro cliente (dados ficticios)
-- ============================================================
-- Objetivo: validar fluxo real de onboarding e operacao
-- (empresa -> admin -> funcionarios -> batidas -> relatorio)
--
-- Como usar:
-- 1) No Supabase Auth, crie os usuarios (Auto Confirm = true):
--    - admin.golive@pontowebdesk.local
--    - colaborador1.golive@pontowebdesk.local
--    - colaborador2.golive@pontowebdesk.local
-- 2) Execute este SQL no SQL Editor.
-- 3) Acesse o app com o admin e rode o checklist em docs/go-live-checklist.md.
--
-- Observacao:
-- - Script idempotente (ON CONFLICT).
-- - Nao sobrescreve senha/auth.users; apenas public.users e dados de negocio.
-- ============================================================

DO $$
DECLARE
  v_company_id text := 'comp_golive_primeiro_cliente';
  v_admin_id uuid;
  v_emp1_id uuid;
  v_emp2_id uuid;
BEGIN
  -- 1) Empresa
  INSERT INTO public.companies (
    id, nome, name, slug, cnpj, address, phone, email, timezone,
    geofence, settings, bairro, cidade, estado, cep,
    plan, created_at, updated_at
  ) VALUES (
    v_company_id,
    'Cliente Go Live LTDA',
    'Cliente Go Live LTDA',
    'cliente-go-live',
    '98.765.432/0001-10',
    'Av. Exemplo, 1000',
    '(11) 3333-4444',
    'contato@cliente-golive.local',
    'America/Sao_Paulo',
    '{"lat": -23.5505, "lng": -46.6333, "radius": 200}'::jsonb,
    '{
      "allowManualPunch": true,
      "requirePhoto": false,
      "standardHours": {"start": "09:00", "end": "18:00"},
      "delayPolicy": {"toleranceMinutes": 10}
    }'::jsonb,
    'Centro',
    'Sao Paulo',
    'SP',
    '01000-000',
    'pro',
    now(),
    now()
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
    estado = EXCLUDED.estado,
    cep = EXCLUDED.cep,
    plan = EXCLUDED.plan,
    updated_at = now();

  -- 2) Resolver IDs de auth.users
  SELECT id INTO v_admin_id
  FROM auth.users
  WHERE lower(trim(email::text)) = 'admin.golive@pontowebdesk.local'
  LIMIT 1;

  SELECT id INTO v_emp1_id
  FROM auth.users
  WHERE lower(trim(email::text)) = 'colaborador1.golive@pontowebdesk.local'
  LIMIT 1;

  SELECT id INTO v_emp2_id
  FROM auth.users
  WHERE lower(trim(email::text)) = 'colaborador2.golive@pontowebdesk.local'
  LIMIT 1;

  IF v_admin_id IS NULL OR v_emp1_id IS NULL OR v_emp2_id IS NULL THEN
    RAISE NOTICE
      'Usuarios faltantes em auth.users. Crie (Authentication > Users): admin.golive@pontowebdesk.local, colaborador1.golive@pontowebdesk.local, colaborador2.golive@pontowebdesk.local';
  END IF;

  -- 3) Perfis em public.users
  IF v_admin_id IS NOT NULL THEN
    INSERT INTO public.users (
      id, nome, email, cargo, role, company_id, department_id, preferences, created_at, updated_at
    ) VALUES (
      v_admin_id, 'Admin Go Live', 'admin.golive@pontowebdesk.local', 'Administrador', 'admin',
      v_company_id, '', '{"notifications": true, "theme": "light", "language": "pt-BR"}'::jsonb, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome,
      cargo = EXCLUDED.cargo,
      role = EXCLUDED.role,
      company_id = EXCLUDED.company_id,
      preferences = EXCLUDED.preferences,
      updated_at = now();
  END IF;

  IF v_emp1_id IS NOT NULL THEN
    INSERT INTO public.users (
      id, nome, email, cargo, role, company_id, department_id, preferences, created_at, updated_at
    ) VALUES (
      v_emp1_id, 'Colaborador Um', 'colaborador1.golive@pontowebdesk.local', 'Operador', 'employee',
      v_company_id, '', '{"notifications": true, "theme": "light", "language": "pt-BR"}'::jsonb, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome,
      cargo = EXCLUDED.cargo,
      role = EXCLUDED.role,
      company_id = EXCLUDED.company_id,
      preferences = EXCLUDED.preferences,
      updated_at = now();
  END IF;

  IF v_emp2_id IS NOT NULL THEN
    INSERT INTO public.users (
      id, nome, email, cargo, role, company_id, department_id, preferences, created_at, updated_at
    ) VALUES (
      v_emp2_id, 'Colaborador Dois', 'colaborador2.golive@pontowebdesk.local', 'Analista', 'employee',
      v_company_id, '', '{"notifications": true, "theme": "light", "language": "pt-BR"}'::jsonb, now(), now()
    )
    ON CONFLICT (id) DO UPDATE SET
      nome = EXCLUDED.nome,
      cargo = EXCLUDED.cargo,
      role = EXCLUDED.role,
      company_id = EXCLUDED.company_id,
      preferences = EXCLUDED.preferences,
      updated_at = now();
  END IF;

  -- 4) Batidas de teste (um dia util com intervalo)
  -- Empregado 1: 09:00 entrada, 12:00 pausa, 13:00 retorno, 18:00 saida
  IF v_emp1_id IS NOT NULL THEN
    INSERT INTO public.time_records (
      id, user_id, company_id, type, method, source, timestamp, created_at, updated_at, is_manual, manual_reason
    ) VALUES
      (gen_random_uuid()::text, v_emp1_id::text, v_company_id, 'entrada', 'admin', 'admin', now()::date + time '09:00', now(), now(), true, 'SEED_GO_LIVE'),
      (gen_random_uuid()::text, v_emp1_id::text, v_company_id, 'pausa',   'admin', 'admin', now()::date + time '12:00', now(), now(), true, 'SEED_GO_LIVE'),
      (gen_random_uuid()::text, v_emp1_id::text, v_company_id, 'entrada', 'admin', 'admin', now()::date + time '13:00', now(), now(), true, 'SEED_GO_LIVE'),
      (gen_random_uuid()::text, v_emp1_id::text, v_company_id, 'saida',   'admin', 'admin', now()::date + time '18:00', now(), now(), true, 'SEED_GO_LIVE')
    ON CONFLICT DO NOTHING;
  END IF;

  -- Empregado 2: jornada sem intervalo (teste de relatorio simplificado)
  IF v_emp2_id IS NOT NULL THEN
    INSERT INTO public.time_records (
      id, user_id, company_id, type, method, source, timestamp, created_at, updated_at, is_manual, manual_reason
    ) VALUES
      (gen_random_uuid()::text, v_emp2_id::text, v_company_id, 'entrada', 'admin', 'admin', now()::date + time '08:30', now(), now(), true, 'SEED_GO_LIVE'),
      (gen_random_uuid()::text, v_emp2_id::text, v_company_id, 'saida',   'admin', 'admin', now()::date + time '17:30', now(), now(), true, 'SEED_GO_LIVE')
    ON CONFLICT DO NOTHING;
  END IF;

  -- 5) Auditoria de seed (quando a tabela existir)
  BEGIN
    IF v_admin_id IS NOT NULL THEN
      INSERT INTO public.tenant_audit_log (
        tenant_id, user_id, action, details, created_at
      ) VALUES (
        v_company_id,
        v_admin_id,
        'seed_go_live_applied',
        jsonb_build_object(
          'script', 'supabase/seed_go_live_primeiro_cliente.sql',
          'employees_seeded', 2,
          'time_records_seeded', 6
        ),
        now()
      );
    ELSE
      INSERT INTO public.tenant_audit_log (
        tenant_id, user_id, action, details, created_at
      ) VALUES (
        v_company_id,
        NULL,
        'seed_go_live_applied',
        jsonb_build_object(
          'script', 'supabase/seed_go_live_primeiro_cliente.sql',
          'employees_seeded', 2,
          'time_records_seeded', 6,
          'note', 'admin auth user ausente no momento do seed'
        ),
        now()
      );
    END IF;
  EXCEPTION WHEN undefined_table THEN
    -- Ambiente sem tenant_audit_log: ignora
    NULL;
  END;
END $$;

-- Verificacao rapida
SELECT 'company' AS item, c.id AS ref, c.plan::text AS extra
FROM public.companies c
WHERE c.id = 'comp_golive_primeiro_cliente'
UNION ALL
SELECT 'users', u.id::text, u.role::text
FROM public.users u
WHERE u.company_id = 'comp_golive_primeiro_cliente'
UNION ALL
SELECT 'time_records', tr.id::text, tr.type::text
FROM public.time_records tr
WHERE tr.company_id = 'comp_golive_primeiro_cliente'
ORDER BY item, ref;
