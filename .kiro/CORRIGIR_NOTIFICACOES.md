# Corrigir Exclusão de Notificações

## Problema
Usuários não conseguem excluir notificações mesmo após o deploy.

## Causa Raiz
A política RLS (Row Level Security) de UPDATE na tabela `notifications` estava incompleta:
- Tinha apenas `USING` (condição de leitura)
- Faltava `WITH CHECK` (condição de escrita)
- Isso bloqueava todas as atualizações

## Solução

### Passo 1: Executar a Migração no Supabase

1. Acesse o [Supabase Dashboard](https://app.supabase.com)
2. Selecione seu projeto
3. Vá para **SQL Editor** → **New query**
4. Copie e cole o SQL abaixo:

```sql
-- Corrigir política RLS de UPDATE para notificações
DROP POLICY IF EXISTS "Notifications update own" ON public.notifications;

CREATE POLICY "Notifications update own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

-- Também adicionar política DELETE para permitir exclusão
DROP POLICY IF EXISTS "Notifications delete own" ON public.notifications;

CREATE POLICY "Notifications delete own"
  ON public.notifications FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);
```

5. Clique em **Run**

### Passo 2: Verificar as Políticas

Execute esta query para verificar se as políticas foram criadas corretamente:

```sql
SELECT policyname, qual, with_check
FROM pg_policies
WHERE tablename = 'notifications'
ORDER BY policyname;
```

Você deve ver:
- `Notifications delete own` - DELETE policy
- `Notifications insert own` - INSERT policy
- `Notifications select own` - SELECT policy
- `Notifications update own` - UPDATE policy com WITH CHECK

### Passo 3: Testar

1. Recarregue a aplicação (Ctrl+F5 ou Cmd+Shift+R)
2. Clique no sino de notificações
3. Clique no botão **X** em qualquer notificação
4. A notificação deve desaparecer imediatamente

## O que foi Corrigido

### Política UPDATE
**Antes (incorreta):**
```sql
CREATE POLICY "Notifications update own"
  ON notifications FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id);
  -- Faltava WITH CHECK!
```

**Depois (correta):**
```sql
CREATE POLICY "Notifications update own"
  ON notifications FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);
```

### Política DELETE
**Adicionada:**
```sql
CREATE POLICY "Notifications delete own"
  ON notifications FOR DELETE TO authenticated
  USING (auth.uid()::text = user_id);
```

## Por que isso funciona agora?

1. **USING** - Verifica se o usuário autenticado é o dono da notificação (leitura)
2. **WITH CHECK** - Verifica se o usuário autenticado é o dono da notificação (escrita)
3. **DELETE policy** - Permite que o usuário delete suas próprias notificações

## Comportamento Esperado

Após a correção:
- ✅ Usuários podem marcar notificações como lidas (✓ botão)
- ✅ Usuários podem excluir notificações (X botão)
- ✅ Notificações excluídas desaparecem imediatamente
- ✅ Funciona em modo claro e escuro
- ✅ Fallback para localStorage se Supabase falhar

## Troubleshooting

### Erro: "new row violates row-level security policy"
- A política RLS ainda não foi atualizada
- Execute a migração novamente

### Notificações ainda não desaparecem
- Limpe o cache do navegador (Ctrl+Shift+Delete)
- Recarregue a página (Ctrl+F5)
- Verifique se está logado com a conta correta

### Erro de permissão
- Verifique se o `user_id` na tabela corresponde ao `auth.uid()` do usuário logado
- Verifique se o usuário está autenticado

## Rollback (se necessário)

Se precisar reverter:

```sql
DROP POLICY IF EXISTS "Notifications update own" ON public.notifications;
DROP POLICY IF EXISTS "Notifications delete own" ON public.notifications;

CREATE POLICY "Notifications update own"
  ON public.notifications FOR UPDATE TO authenticated
  USING (auth.uid()::text = user_id);
```
