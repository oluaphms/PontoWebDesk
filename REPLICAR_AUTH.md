# Replicar lógica de Login, Recuperação de Senha e Convite (GestaoQualividaResidence → Smartponto)

Este guia descreve como replicar a lógica de autenticação do projeto **GestaoQualividaResidence** (pasta `D:\GestaoQualividaResidence`) no **Smartponto**.

---

## 1. Login

### No GestaoQualividaResidence
- Formulário com seleção de perfil (Morador / Portaria / ADM), usuário/unidade, senha.
- **userAuth.ts**: bloqueio por tentativas (5 falhas → 15 min), resolução de identificador → e-mail (users, staff, residents), `signInWithPassword`, perfil em `users`/`staff`/`residents` por `auth_user_id`.
- Sessão: sessionStorage (`currentUser`, `userRole`) + Supabase Auth.

### No Smartponto (já existente)
- Login com escolha Admin/Funcionário, campo "Nome de usuário ou Email", senha.
- **authService.ts**: `signInWithEmail(email, password)`; usuário resolvido por `users` (id = auth user id).
- **supabase.ts**: `signInWithPassword`, `persistSession`, `detectSessionInUrl`.

### O que replicar (opcional)
- **Bloqueio por tentativas**: em `authService.signInWithEmail`, antes de chamar o Supabase, verificar `isUserBlocked(identifier)` e incrementar falhas em caso de erro (ver `userAuth.ts` do outro projeto).
- **Resolução identificador → e-mail**: se o usuário digitar algo que não é e-mail (ex.: nome de usuário), buscar e-mail na tabela `users` e fazer login com esse e-mail. No Smartponto hoje já existe fallback `identifier@smartponto.com`; você pode trocar por uma busca em `users` por `email` ou por um campo `username` se existir.

---

## 2. Recuperação de senha

### No GestaoQualividaResidence
- **Solicitar link**: usuário informa e-mail ou usuário/unidade → `getEmailForReset` resolve para e-mail → `requestPasswordReset(email)` (Supabase `resetPasswordForEmail`). Redirect configurado (VITE_APP_URL ou origin).
- **Redefinir**: usuário abre o link (hash `#type=recovery&access_token=...&refresh_token=...` ou `token_hash=...`). Página chama `getOrRestoreRecoverySession()` para estabelecer sessão a partir do hash, depois `supabase.auth.updateUser({ password })`, `clearRecoveryHashFromUrl()`, `signOut()`, volta ao login.
- Componente **ForgotPassword** tem dois passos: "request" (solicitar link) e "reset" (nova senha quando há hash de recovery).

### No Smartponto (parcial)
- **ForgotPasswordModal**: só passo "solicitar link" (e-mail → `authService.resetPassword`). Falta:
  - Aceitar "identificador" (e-mail ou algo que resolva para e-mail) via `getEmailForReset`.
  - **Página/rota de redefinição**: quando o usuário abre o link do e-mail, a URL é algo como `.../reset-password#type=recovery&...`. É preciso uma tela que:
    1. Detecte o hash `type=recovery`.
    2. Chame `getOrRestoreRecoverySession()` (Supabase processa o hash e estabelece sessão).
    3. Mostre formulário "Nova senha" + "Confirmar senha".
    4. Em submit: `updateUser({ password })`, `clearRecoveryHashFromUrl()`, `signOut()`, redirecionar para login.

### Implementação no Smartponto
- **authService** (ou módulo de auth):
  - `getOrRestoreRecoverySession()`: igual ao do outro projeto (inicializar auth, ler sessão; se não houver, ler hash `type=recovery` e usar `setSession` ou `verifyOtp`).
  - `clearRecoveryHashFromUrl()`: remover o hash da URL após sucesso.
  - `getEmailForReset(identifier)`: no Smartponto a tabela é `users` com `email`; buscar por `email` ou por um campo que identifique (ex.: `nome` se for único) e retornar o e-mail.
- **supabase**: `resetPasswordForEmail(email, { redirectTo })` já existe; usar `redirectTo: window.location.origin + '/reset-password'` (ou VITE_APP_URL).
- **Página ResetPassword**: rota `/reset-password`; se não há usuário logado mas há hash `type=recovery`, renderizar componente que restaura sessão e exibe formulário de nova senha.
- **ForgotPasswordModal**: no passo de solicitação, se o valor não for e-mail válido, chamar `getEmailForReset(valor)` antes de `resetPassword`.

---

## 3. Convite de acesso

### No GestaoQualividaResidence
- **Staff**: tabela `staff_invites` (email, role, token, expires_at, created_by, used_at). Admin cria convite no app → insert na tabela → link `/accept-invite?token=...`. API GET `/api/staff-invite?token=` valida e retorna email, role, expiresAt. Página de aceite: nome + senha → POST `/api/accept-staff-invite` → cria usuário em auth, insere em `users` e `staff`, marca convite usado. E-mail opcional via Resend.
- **Morador**: tabela `resident_invites`, link `/accept-resident-invite?token=...`, fluxo análogo com nome + unidade + senha.

### No Smartponto (atual)
- **employeeInviteService**: chama `VITE_INVITE_API_URL` (POST) com email, nome, role, etc. Espera uma API externa que use Supabase Admin (ex.: `inviteUserByEmail`). Não há tabela de convites nem link único por token.

### Replicar no Smartponto (convite por link)
1. **Tabela** `employee_invites`:
   - `id` (uuid), `email`, `role`, `token` (único), `expires_at`, `created_by`, `used_at`, `company_id`.
2. **Serviço (front)**:
   - `createEmployeeInvite(email, role, companyId, createdById, expiresInDays)`: gera token, insert em `employee_invites`, retorna `inviteLink = origin + '/accept-invite?token=' + token`.
3. **APIs (backend/serverless)**:
   - GET `/api/employee-invite?token=` → valida token, retorna `email`, `role`, `expiresAt` (e opcionalmente `companyId`).
   - POST `/api/accept-employee-invite` body `{ token, name, password }` → valida convite, cria usuário em `auth.users` (admin), insere em `users` (id = auth user id, nome, email, role, company_id, etc.), marca `used_at`.
4. **Página** `/accept-invite`: lê `token` da query, GET na API para mostrar email/role, formulário nome + senha + confirmar, POST accept, mensagem de sucesso e link para login.
5. **UI no app**: na tela de Funcionários (Employees), botão/modal "Convidar por link" → informar e-mail e role → criar convite → mostrar link para copiar (e opcionalmente enviar e-mail via Resend se tiver API).

### Variáveis de ambiente
- **Login/recuperação**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`; opcional `VITE_APP_URL` para redirect de recuperação.
- **Convite (APIs)**: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` (ou `VITE_SUPABASE_URL`); para envio de e-mail: `RESEND_API_KEY`, `RESEND_FROM` ou `APP_SENDER_EMAIL`.

---

## Checklist de replicação

- [ ] **Login**: (opcional) Bloqueio por tentativas e resolução identificador → e-mail.




























































- [x] **Recuperação – solicitar link**: ForgotPasswordModal aceita identificador (e-mail ou nome) e usa `getEmailForReset` quando não for e-mail.
- [x] **Recuperação – redefinir**: `getOrRestoreRecoverySession`, `clearRecoveryHashFromUrl` no authService; página `/reset-password` com formulário de nova senha.
- [x] **Convite por link**: Tabela `employee_invites` (migration em `supabase/migrations/`); serviço `createEmployeeInviteByLink`; APIs `api/employee-invite.ts` e `api/accept-employee-invite.ts`; página `/accept-invite`; botão "Convidar por link" em Funcionários.
- [ ] **Supabase**: Redirect URLs em Authentication → URL Configuration incluir `.../reset-password` e `.../accept-invite`; configurar SMTP para e-mails de recuperação.
- [ ] **Deploy das APIs**: Em produção, exponha GET `/api/employee-invite` e POST `/api/accept-employee-invite` (ex.: Vercel coloca arquivos em `/api` automaticamente). Variáveis: `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL` (ou `VITE_SUPABASE_URL`).

---

## Arquivos de referência (GestaoQualividaResidence)

| Funcionalidade   | Arquivos |
|------------------|----------|
| Login            | `components/Login.tsx`, `services/userAuth.ts`, `services/supabase.ts` |
| Recuperação      | `components/ForgotPassword.tsx`, `services/userAuth.ts` (getOrRestoreRecoverySession, getEmailForReset, requestPasswordReset, clearRecoveryHashFromUrl) |
| Convite staff    | `services/dataService.ts` (createStaffInvite, generateInviteToken), `components/modals/ActionModals.tsx` (StaffInviteModal), `components/AcceptStaffInvitePage.tsx`, `api/staff-invite.ts`, `api/accept-staff-invite.ts`, `api/send-invite-email.ts` |
| Banco            | `supabase/migrations/20250225000000_staff_invites.sql` |

Os trechos de código relevantes foram usados para implementar as partes faltantes no Smartponto conforme as seções acima.
