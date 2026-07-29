# Instruções do Painel Master — Passo a passo

> **Público:** operador comercial / administrador da plataforma PontoWebDesk.  
> **URL:** `/master` (login em `/master/login`)  
> **Escopo:** gestão comercial de empresas, licenças, planos, pagamentos manuais e convite de primeiro acesso.  
> **Fora do Master:** ponto, espelho, REP, RH e operações do dia a dia da empresa — isso fica no **Sistema Operacional** (SaaS), não neste painel.

---

## 1. Acessar o Painel Master

1. Abra o navegador em **`/master/login`**.
2. Informe o **e-mail** e a **senha** da conta Master.
3. Clique em entrar.
4. Você será direcionado à **Página inicial** (`/master`) — Dashboard Comercial.

> Se a sessão expirar, o sistema volta para `/master/login`. Faça login novamente.

---

## 2. Orientar-se no menu

No menu lateral (operação diária):

| Item | Rota | Para que serve |
| --- | --- | --- |
| Página inicial | `/master` | Indicadores e atalhos rápidos |
| Empresas | `/master/tenants` | Lista / CRM comercial |
| Licenças | `/master/licenses` | Central de licenciamento |
| Planos | `/master/plans` | Catálogo de planos (mensal / anual) |
| Assinaturas | `/master/subscriptions` | Planos vinculados às empresas |
| Pagamentos | `/master/payments` | Pagamentos (confirmação manual) |
| Relatórios | `/master/finance` | Relatórios comerciais |
| Usuários Master | `/master/users` | Contas e perfis do próprio Master |
| Configurações | `/master/settings` | Opções administrativas do dia a dia |
| Atualizações | `/master/updates` | Releases e control plane de updates |

Atalhos no topo do dashboard: **Nova empresa**, **Empresas**, **Licenças**, **Pagamentos**, **Relatórios**, **Atualizações**, **Configurações**.

Para voltar ao dashboard a qualquer momento, use **Voltar ao dashboard** (quando disponível na página).

---

## 3. Fluxo principal recomendado (empresa nova)

Use esta sequência no dia a dia:

```text
Login Master
  → Nova empresa (cadastro)
    → Detalhe da empresa
      → (opcional) Confirmar pagamento e ativar
      → Verificar Provisionamento e convite
      → Reenviar convite se necessário
        → Cliente faz 1º login no Sistema Operacional
          → Troca obrigatória de senha
```

---

## 4. Cadastrar uma nova empresa

**Caminho:** Página inicial → atalho **Nova empresa**  
**ou** Empresas → botão de nova empresa  
**Rota:** `/master/tenants/new`

### Passo a passo

1. Abra **Cadastrar empresa**.
2. Preencha:
   - **Nome** *(obrigatório)* — razão social / nome da empresa.
   - **CNPJ** *(opcional)*.
   - **Nome fantasia** *(opcional)*.
   - **Administrador** *(obrigatório)* — nome do responsável.
   - **E-mail admin** *(obrigatório)* — receberá o convite de primeiro acesso.
   - **Domínio** *(obrigatório)*.
   - **Tipo de instalação** *(obrigatório)*:
     - **SaaS Web** → plano **Mensal**.
     - **On-premise** → plano **Anual**.
   - **Plano** — respeita o tipo de instalação (só Mensal ou só Anual).
   - **Situação inicial** — Rascunho / Ativo / Teste.
3. Clique em **Salvar**.
4. O Master **provisiona** a empresa (tenant, company operacional, admin, licença/assinatura conforme o fluxo) e abre o **detalhe** da empresa em `/master/tenants/:id`.

> Não há provedor de pagamento no cadastro. Pagamentos são registrados/confirmados **manualmente** no Master.

---

## 5. Página de detalhe da empresa

**Rota:** `/master/tenants/:id`

Aqui você acompanha e opera o cliente.

### 5.1 Ações do cabeçalho

- **Favorito** — marca a empresa para acesso rápido.
- **Editar** — altera cadastro comercial (`/master/tenants/:id/edit`).
- **Renovar** — atalho para Licenças.
- **Registrar Contato** — vai à seção CRM da mesma página.
- **Bloquear / Desbloquear / Suspender / Ativar / Cancelar** — muda o status comercial (com confirmação; bloqueio exige motivo).

### 5.2 Automação comercial (pagamento manual)

1. Após o pagamento ser reconhecido no mundo real (PIX/boleto/transferência), abra o detalhe.
2. Clique em **Confirmar pagamento e ativar**.
3. Confirme o diálogo.
4. Acompanhe a **timeline** (licença, empresa, admin, convite etc.).
5. Se houver falha de provisionamento: use **Retomar automação**.
6. Se o provisionamento ok e o **convite** falhou: a mensagem indica *Convite pendente* — use **Reenviar convite** (abaixo). O convite é etapa **independente** do provisionamento.

### 5.3 Provisionamento e convite (Primeiro Acesso)

Na seção **Ações da jornada → Provisionamento e convite**:

| Situação | O que fazer |
| --- | --- |
| Empresa / licença / admin / tenant incompletos | **Provisionar tudo** ou **Continuar provisionamento** |
| Convite pendente ou falhou | **Reenviar convite** (ou **Enviar / reenviar convite**) |
| Precisa invalidar a senha atual e criar outra | **Gerar senha provisória** |
| Convite já enviado e senha ainda válida | **Reenviar convite** apenas reenvia o **mesmo** convite (não troca a senha) |

#### Comportamento do convite (importante)

- **Reenviar convite** (senha provisória ainda válida):
  - **não** gera nova senha;
  - **não** altera `password_hash`;
  - reenvia o e-mail com a mesma senha;
  - incrementa o contador de envios.
- **Gerar senha provisória**:
  - gera **nova** senha;
  - invalida a anterior;
  - a senha aparece **uma vez** na tela (copie com cuidado).
- Nova senha também é gerada automaticamente se a provisória estiver **expirada**, já tiver sido **usada** (primeiro login) ou **invalidada** (senha já trocada).

#### Checklist do cliente (primeiro acesso no Sistema Operacional)

1. Abrir a URL do sistema recebida no e-mail.
2. Entrar com o **e-mail admin** + **senha provisória**.
3. Trocar a senha (obrigatório: `must_change_password`).
4. Após a troca, a senha provisória deixa de funcionar.

---

## 6. Listar e filtrar empresas (CRM)

**Rota:** `/master/tenants`

1. Abra **Empresas**.
2. Use a **pesquisa** (nome, e-mail, etc.).
3. Aplique filtros (plano, modo, status, situação CRM, datas…).
4. Clique na empresa para abrir o **detalhe**.
5. Se aparecer empresa operacional ainda sem domínio comercial Master, use a ação de **inicializar comercial** (quando disponível na lista) — isso **não** cria uma segunda company; apenas completa o vínculo Master.

---

## 7. Editar empresa

**Rota:** `/master/tenants/:id/edit`

1. No detalhe, clique em **Editar**.
2. Atualize nome, CNPJ, admin, domínio, tipo de instalação e plano compatível.
3. Salve.
4. (Opcional, só na edição) use **Gerar senha provisória** se precisar emitir uma senha nova e vê-la na tela.

---

## 8. Planos e assinatura da empresa

### Catálogo de planos

**Rota:** `/master/plans`

- Cadastre/ative planos **mensais** (SaaS Web) e **anuais** (On-premise).
- Respeite a regra: tipo de instalação define o ciclo permitido.

### No detalhe da empresa

1. Escolha o plano SaaS compatível.
2. **Atribuir** (primeira vez) ou **Alterar** plano.
3. Se necessário, **Cancelar** assinatura (com confirmação).
4. Use o painel de **financeiro da assinatura** para registrar pagamentos manuais, vencimentos e preferências de notificação.

---

## 9. Licenças

**Rota:** `/master/licenses`

1. Abra **Licenças**.
2. Localize a empresa / licença.
3. Ative, renove ou ajuste conforme a Central de Licenciamento.
4. Status comercial e bloqueios projetam no Sistema Operacional — o Master é a fonte de verdade.

---

## 10. Pagamentos e relatórios

### Pagamentos

**Rota:** `/master/payments`

1. Confirme recebimentos **manualmente** (não há gateway automático na operação diária).
2. Use o detalhe da empresa / financeiro da assinatura para manter o histórico alinhado.

### Relatórios

**Rota:** `/master/finance`

1. Consulte KPIs e extratos comerciais.
2. Exporte quando disponível (CSV / Excel / PDF, conforme a tela).

---

## 11. Usuários Master

**Rota:** `/master/users`

1. Liste contas do Painel Master (não são usuários da empresa).
2. Crie / edite / bloqueie conforme sua permissão.
3. Contas **Founder** têm proteção permanente (não desativar / rebaixar).

---

## 12. Configurações e atualizações

### Configurações

**Rota:** `/master/settings`

Ajustes administrativos do dia a dia do Master (conforme permissão `admin:write`).

### Atualizações

**Rota:** `/master/updates`

1. Publique / acompanhe releases.
2. Gerencie canais e agentes de atualização (Update Agent).
3. A instalação no cliente **não** roda no navegador — o Master registra e o agente no ambiente do cliente executa.

### Assistente de implantação (quando usar)

**Rota:** `/master/tenants/:id/implantacao`

Wizard retomável (etapas: empresa → admin → plano → licença → primeiro acesso → token do agent → finalizar).  
Útil para implantação guiada, especialmente **On-premise / híbrido**. No fluxo rápido de cadastro atual, o detalhe da empresa já concentra provisionamento e convite.

---

## 13. Boas práticas e cuidados

1. **Não confunda** Painel Master com o login da empresa (Sistema Operacional).
2. Prefira **Reenviar convite** quando o cliente “não recebeu o e-mail”, em vez de **Gerar senha provisória** — assim a senha do e-mail anterior continua válida.
3. Use **Gerar senha provisória** só quando quiser **invalidar** a senha atual de propósito.
4. Após o primeiro login bem-sucedido, a senha provisória é considerada **utilizada**; novo reenvio pode regenerar.
5. Bloqueio administrativo exige **motivo** (fica na auditoria).
6. Pagamento no Master é **manual** — confirmar só depois de validar o recebimento real.
7. Alterações comerciais no Master projetam para o SaaS; não “consertar” plano/licença manualmente no banco operacional.

---

## 14. Problemas comuns

| Sintoma | O que verificar / fazer |
| --- | --- |
| Cliente diz que a senha do e-mail não funciona | Pode ter havido **Gerar senha** ou expiração depois do e-mail antigo. Reenvie **depois** de gerar (se for o caso) e peça o e-mail **mais recente**. |
| Convite falhou (Sandbox / domínio) | Provisionamento pode estar ok. Ajuste remetente/domínio do e-mail e use **Reenviar convite**. |
| “Provisionamento concluído. Convite pendente” | Use **Reenviar convite** — não é falha da empresa. |
| Login Master 401 | Credencial Master incorreta ou conta bloqueada — não é a senha da empresa. |
| Empresa não aparece | Atualize a lista; confira filtros; verifique se o comercial foi inicializado. |

---

## 15. Resumo rápido (colinha)

1. Entrar em `/master/login`.
2. **Nova empresa** → preencher → **Salvar**.
3. No detalhe: conferir provisionamento.
4. Se preciso: **Confirmar pagamento e ativar**.
5. **Reenviar convite** se o e-mail não chegou (mantém a senha válida).
6. **Gerar senha provisória** só para forçar senha nova.
7. Cliente acessa o **Sistema Operacional**, troca a senha e opera normalmente.
8. Financeiro / plano / licença / bloqueio: sempre pelo Master.
