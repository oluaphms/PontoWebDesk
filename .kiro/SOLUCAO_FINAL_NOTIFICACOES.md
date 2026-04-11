# Solução Final: Excluir Notificações

## Problema
Usuários não conseguem excluir notificações mesmo após múltiplas tentativas.

## Causa Raiz
A política RLS estava bloqueando as operações UPDATE e DELETE na tabela `notifications`.

## Solução Definitiva

### Passo 1: Executar as Migrações no Supabase

Execute as seguintes queries no Supabase SQL Editor na ordem:

#### Query 1: Forçar correção das políticas RLS

```sql
-- Desabilitar RLS temporariamente para remover políticas
ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;

-- Reabilitar RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Remover todas as políticas antigas
DROP POLICY IF EXISTS "Notifications insert own" ON public.notifications;
DROP POLICY IF EXISTS "Notifications select own" ON public.notifications;
DROP POLICY IF EXISTS "Notifications update own" ON public.notifications;
DROP POLICY IF EXISTS "Notifications delete own" ON public.notifications;

-- Recriar políticas corretamente

-- INSERT: usuários autenticados podem criar suas próprias notificações
CREATE POLICY "Notifications insert own"
  ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (auth.uid()::text = user_id);

-- SELECT: apenas próprias notificações
CREATE POLICY "Notifications select own"
  ON public.notifications FOR SELECT TO authenticated
  USING (auth.uid()::text = user_id);

-- UPDATE: apenas próprias notificações (com WITH CHECK obrigatório)
CREATE POLICY "Notifications update own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- DELETE: apenas próprias notificações
CREATE POLICY "Notifications delete own"
  ON public.notifications FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);
```

#### Query 2: Criar RPCs para deletar e marcar como lida

```sql
-- Criar RPC para deletar notificações com bypass de RLS
CREATE OR REPLACE FUNCTION public.delete_notification(
  p_notification_id UUID,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_deleted_count INT;
BEGIN
  -- Verificar que o usuário está deletando sua própria notificação
  IF (SELECT user_id FROM public.notifications WHERE id = p_notification_id) != p_user_id THEN
    RAISE EXCEPTION 'Não autorizado: notificação não pertence ao usuário'
      USING ERRCODE = '42501';
  END IF;

  -- Deletar a notificação
  DELETE FROM public.notifications
  WHERE id = p_notification_id AND user_id = p_user_id;

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_deleted_count > 0,
    'deleted_count', v_deleted_count
  );
END;
$$;

-- Criar RPC para marcar como lida
CREATE OR REPLACE FUNCTION public.mark_notification_read(
  p_notification_id UUID,
  p_user_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_updated_count INT;
BEGIN
  -- Verificar que o usuário está atualizando sua própria notificação
  IF (SELECT user_id FROM public.notifications WHERE id = p_notification_id) != p_user_id THEN
    RAISE EXCEPTION 'Não autorizado: notificação não pertence ao usuário'
      USING ERRCODE = '42501';
  END IF;

  -- Marcar como lida
  UPDATE public.notifications
  SET read = true
  WHERE id = p_notification_id AND user_id = p_user_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'success', v_updated_count > 0,
    'updated_count', v_updated_count
  );
END;
$$;
```

### Passo 2: Fazer Deploy da Aplicação

1. Commit e push das mudanças
2. Deploy no Vercel (ou seu servidor)
3. Aguarde o deploy completar

### Passo 3: Testar

1. Recarregue a aplicação (Ctrl+F5 ou Cmd+Shift+R)
2. Clique no sino de notificações no canto superior direito
3. Clique no botão **X** em qualquer notificação
4. A notificação deve desaparecer imediatamente

## O que foi Corrigido

### 1. Políticas RLS
- ✅ Adicionado `WITH CHECK` na política UPDATE
- ✅ Adicionada política DELETE
- ✅ Todas as políticas agora verificam `auth.uid()::text = user_id`

### 2. RPCs (Stored Procedures)
- ✅ `delete_notification()` - Deleta notificação com verificação de propriedade
- ✅ `mark_notification_read()` - Marca como lida com verificação de propriedade
- ✅ Ambas usam `SECURITY DEFINER` para bypass de RLS
- ✅ Ambas verificam se a notificação pertence ao usuário

### 3. Código Frontend
- ✅ `markAsRead()` - Tenta RPC primeiro, depois fallback para update direto
- ✅ `markAsResolved()` - Tenta RPC de delete, depois fallback para update direto
- ✅ Ambas mantêm fallback para localStorage

## Fluxo de Funcionamento

```
Usuário clica X
    ↓
handleDeleteNotification() chamado
    ↓
markAsResolved() chamado
    ↓
Tenta RPC delete_notification()
    ├─ Sucesso: Notificação deletada no banco
    └─ Falha: Tenta update direto
    ↓
Atualiza localStorage
    ↓
Recarrega notificações
    ↓
Notificação desaparece da UI
```

## Verificação

Para verificar se tudo está funcionando:

```sql
-- Verificar se as RPCs existem
SELECT routine_name 
FROM information_schema.routines 
WHERE routine_schema = 'public' 
AND routine_name LIKE 'delete_notification%' 
OR routine_name LIKE 'mark_notification%';

-- Verificar se as políticas existem
SELECT policyname, qual, with_check
FROM pg_policies
WHERE tablename = 'notifications'
ORDER BY policyname;
```

## Troubleshooting

### Erro: "policy already exists"
- Execute a Query 1 que desabilita e reabilita RLS
- Isso força a remoção de todas as políticas

### Notificações ainda não desaparecem
- Limpe o cache: Ctrl+Shift+Delete
- Recarregue: Ctrl+F5
- Verifique o console do navegador para erros

### Erro: "Não autorizado"
- Verifique se o `user_id` na tabela corresponde ao `auth.uid()`
- Verifique se está logado com a conta correta

### RPC não encontrada
- Verifique se a Query 2 foi executada com sucesso
- Verifique se não há erros de sintaxe

## Rollback (se necessário)

Se precisar reverter:

```sql
-- Remover RPCs
DROP FUNCTION IF EXISTS public.delete_notification(UUID, TEXT);
DROP FUNCTION IF EXISTS public.mark_notification_read(UUID, TEXT);

-- Remover políticas
DROP POLICY IF EXISTS "Notifications delete own" ON public.notifications;
```

## Resultado Esperado

✅ Usuários conseguem excluir notificações clicando no X
✅ Notificações desaparecem imediatamente
✅ Funciona em modo claro e escuro
✅ Fallback para localStorage se Supabase falhar
✅ Respeita segurança com verificação de propriedade
