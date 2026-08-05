# Fase Founder — proteção permanente da conta Fundador Master

## Entrega

- Coluna `master_users.is_founder` (boolean, default false).
- Trigger BEFORE DELETE: bloqueia exclusão de Founder.
- Trigger BEFORE UPDATE: impede `is_founder=false`, `active=false` e mudança de `role` em Founder.
- Proteção independente de e-mail/nome (somente a flag).

## Migration

- `backend/db/migrations/036_master_founder_protection.sql`
- `supabase/migrations/20260722130000_master_founder_protection.sql`

## Bootstrap

- Slot 1: `MASTER_OWNER_1_IS_FOUNDER` (default `true` na criação).
- Slot 2: `MASTER_OWNER_2_IS_FOUNDER=true` para marcar como Founder.
- Opcional: `MASTER_FOUNDER_USER_IDS` (IDs permanentes, não e-mail).

## Segurança

- Sem alteração de autenticação, sessões ou permissões de roles.
- API/service/UI reforçam a mesma regra; banco é a última linha.
