# Guia do Painel Master — Dashboard Comercial

> **Público:** operador comercial do PontoWebDesk (Master).
> **Objetivo:** passo a passo de como usar cada atalho do painel `PontoWebDesk · Master`.
> **Regra de ouro:** o Master é a **única fonte de verdade comercial**. A empresa (SaaS) recebe
> plano, licença e bloqueio como projeção **somente leitura** — nunca altera esses dados.

---

## Como chegar ao Dashboard

1. Acesse `/master/login` e entre com o e-mail e senha Master.
2. Você cai no **Dashboard Comercial** (`/master`).
3. No topo do dashboard ficam os **Atalhos rápidos**. Cada card leva a uma área:

| Atalho | Sublinha | Para quê serve |
| --- | --- | --- |
| Nova empresa | Cadastro rápido | Cadastrar um cliente novo e iniciar a implantação |
| Empresas | CRM comercial | Listar, filtrar e acompanhar clientes (follow-up) |
| Licenças | Ativar / renovar | Central de licenciamento (plano, validade, bloqueio) |
| Pagamentos | Confirmar PIX | Confirmar manualmente PIX recebido no banco |
| Relatórios | Receita e export | KPIs comerciais e exportação CSV/Excel/PDF |
| Atualizações | Releases | Versões, changelog e atualização dos clientes |
| Configurações | Dia a dia | Plano padrão e mensagem de primeiro acesso |

> Para voltar ao dashboard a qualquer momento, use o botão **Voltar ao dashboard** no topo de cada página.

---

## 1. Nova empresa — *Cadastro rápido*

**Rota:** `/master/tenants/new`

1. Clique no atalho **Nova empresa**.
2. Preencha o formulário **Cadastrar empresa**:
   - **Nome** *(obrigatório)* — razão social.
   - **CNPJ** — opcional (`00.000.000/0001-00`).
   - **Nome fantasia** — opcional.
   - **Administrador** *(obrigatório)* — nome do responsável.
   - **E-mail admin** *(obrigatório)* — receberá o convite de primeiro acesso.
   - **Domínio** *(obrigatório)* — ex.: `empresa.pontowebdesk.local`.
   - **Plano** — `FREE`, `TRIAL`, `STARTER`, `PRO`, `ENTERPRISE`, `LOCAL` ou `HYBRID`.
   - **Modo** — `SAAS`, `LOCAL` ou `HYBRID`.
   - **Gateway** — `none` (padrão), `asaas`, `stripe`, `pagseguro`.
   - **Status inicial** — `draft`, `active` ou `trial`.
3. Clique em **Salvar**.
4. O sistema cria a empresa e **redireciona direto para o Assistente de Implantação**
   (`/master/tenants/:id/implantacao`).

### Assistente de Implantação (wizard retomável)

O wizard tem etapas sequenciais. Ele **pode ser retomado** de onde parou:

1. **Cadastrar empresa** — dados da empresa.
2. **Criar administrador** — usuário admin operacional.
3. **Escolher plano** — plano contratado.
4. **Gerar licença** — emite a licença vinculada ao tenant.
5. **Enviar primeiro acesso** — dispara o convite por e-mail ao admin.
6. **Gerar Token do Update Agent** — token para instalação `LOCAL`/`HYBRID`.
   - No modo `SAAS` esta etapa é **pulada** automaticamente.
   - **⚠️ O token aparece uma única vez.** Copie e configure no agente Windows.
7. **Finalizar implantação** — conclui a jornada.

> A instalação/atualização **nunca roda no navegador**: o Master apenas registra, aprova e gera o
> token. O Update Agent (no cliente) executa download, verificação, backup, instalação e health.

---

## 2. Empresas — *CRM comercial*

**Rota:** `/master/tenants`

Lista todas as empresas com perfil comercial (sem dados operacionais de ponto).

### Pesquisar e filtrar
1. Use a caixa **Pesquisar** (nome, responsável, cidade, plano, e-mail…).
2. Aplique filtros: **Plano**, **Situação CRM**, **Cidade**, **Modo**, **Status do tenant**,
   **Vencimento até**, **Último acesso após**, **Última atualização após**.
3. Clique em **Aplicar filtros**. Use **Limpar pesquisa e filtros** para resetar.

### Ações por empresa (coluna *Ações*)
- **Abrir** — vai ao detalhe da empresa.
- **Editar** (lápis) — altera dados cadastrais.
- **Bloquear** (proibido) — bloqueia a empresa (revoga sessão da empresa imediatamente).
- **Desbloquear** (cadeado) — libera empresa suspensa/bloqueada.
- **Renovar** — leva à Central de Licenças.
- **Contato** — abre o CRM da empresa para registrar follow-up.

> Clicar na **linha** da empresa também abre o detalhe.

### Situações de CRM
`prospect` · `negociacao` · `ativo` · `implantacao` · `inadimplente` · `churn` · `pausado`.

No detalhe da empresa (aba CRM) você pode: mudar a **situação**, **registrar um atendimento**
(histórico) e **criar lembretes** de follow-up.

---

## 3. Licenças — *Ativar / renovar*

**Rota:** `/master/licenses`

Central única de licenciamento. **Só o Master** altera esses dados; toda ação dispara a projeção
comercial Master → SaaS.

### Criar uma licença
1. No formulário superior, informe:
   - **Empresa** (nome), **Tenant ID** (`tn_…`), **Tipo** (`SAAS`/`LOCAL`/`HYBRID`),
     **Status** (`Trial`/`Ativa`/`Expirada`/`Bloqueada`), **Plano**,
     **Funcionários** (limite) e **Dispositivos** (limite).
2. Clique em **Nova licença**.

### Ações por licença (na tabela)
- **Ativar** — coloca a licença como `Ativa`.
- **Suspender** — suspensão temporária.
- **Bloquear** — bloqueio comercial.
- **Desbloquear** — remove bloqueio/suspensão.
- **Renovar** — estende a validade (+365 dias).
- **Reativar** — reativa licença bloqueada/expirada.
- **Histórico** — abre o histórico completo de eventos da licença.
- **Excluir** — remove a licença (**ação irreversível**, pede confirmação).

> Ao clicar numa licença, o painel inferior mostra **Detalhe** + **Histórico completo**.

---

## 4. Pagamentos — *Confirmar PIX*

**Rota:** `/master/payments`

Fluxo **manual** (sem gateway automático nesta fase): o cliente paga o PIX no banco, você confere
e confirma aqui.

### Registrar um pagamento pendente
1. No formulário superior:
   - **Empresa (recomendado)** — selecione para **vincular** o pagamento; isso permite disparar a
     automação comercial na confirmação.
   - **Descrição** — ex.: "Mensalidade PIX".
   - **Valor (R$)** — ex.: `99.00`.
2. Clique em **Registrar pagamento pendente**. Ele entra na lista com status `pending`.

### Confirmar o pagamento
1. Confira no extrato do banco se o PIX **caiu de verdade**.
2. Na linha do pagamento, clique em **Confirmar Pagamento** e confirme o aviso.
3. Status muda para `paid`. Se havia empresa vinculada, a **automação comercial segue**.

### Outras ações
- **Cancelar** — cancela um pagamento `pending`.
- **Excluir** — remove o registro (não permitido para `paid`, que fica preservado como histórico).

---

## 5. Relatórios — *Receita e export*

**Rota:** `/master/finance`

Central de relatórios comerciais compostos pelo Master.

1. **Filtre por período** (campos **De** / **Até**) e clique em **Filtrar** (ou **Atualizar** para
   voltar ao padrão: mês/ano corrente).
2. Confira os **KPIs**: clientes ativos, bloqueados, em teste, receita mensal/anual, licenças
   vencendo, empresas sem login, sem atualização, atualizações OK/falhas, implantações concluídas.
3. Analise as **tabelas**: por cidade, por plano, licenças vencendo, sem login, sem atualização,
   atualizações realizadas/falhas, implantações concluídas.
4. **Exporte** no topo: **CSV**, **Excel** ou **PDF**.

---

## 6. Atualizações — *Releases*

**Rota:** `/master/updates`

Central do Updater. **O Master aprova e acompanha; a execução é exclusiva do Update Agent.**

No topo há KPIs (versão atual, última release, atualizados, pendentes, executando, falharam,
rollback) e **três abas**:

### Aba **Clientes**
1. Registre uma instalação: **ID da empresa**, **Empresa**, **Modo** (`LOCAL`/`HYBRID`),
   **Canal** (`Stable`/`Beta`/`RC`) e **Versão instalada**. Clique em **Registrar instalação**.
2. Na tabela de clientes, conforme o estado:
   - **Solicitar** — cria pedido de atualização para a versão alvo.
   - **Aprovar** — libera o pedido para o Agent executar.
   - **Cancelar** / **Reenviar** — gerencia pedidos pendentes ou que falharam.
   - **Rollback** — solicita retorno à versão anterior (quando definida).
   - **Histórico** — filtra o histórico daquela instalação.

### Aba **Versões e changelog**
1. Crie uma release (draft): **Componente** (Plataforma/Agente REP), **Versão SemVer**,
   **Canal**, **URL do artefato (HTTPS)**, **SHA-256** (64 hex), **Release de rollback** e
   **Changelog**. Clique em **Criar release draft**.
2. Nos cards de release: **Publicar** (torna disponível) ou **Retirar** (remove de circulação).

### Aba **Histórico**
Lista os eventos de atualização (empresa, versão origem→alvo, ator, data). Use **Limpar filtro**
para ver tudo.

---

## 7. Configurações — *Dia a dia*

**Rota:** `/master/settings`

Opções comerciais do dia a dia (configurações técnicas continuam disponíveis por URL direta).

1. Veja **Versão** do painel e o **Usuário Master** logado.
2. Em **Preferências comerciais**:
   - **Plano padrão** — plano sugerido para novos cadastros.
   - **Mensagem de primeiro acesso** — texto enviado ao admin no convite.
3. Clique em **Salvar** (aparece "Salvo.").
4. Atalhos ao final: **Atualizações** (central de versões) e informação sobre **Backup**
   (permanece no ambiente/VPS).

---

## Fluxo comercial recomendado (visão geral)

```
Nova empresa  →  Implantação (wizard)  →  Gerar licença  →  Enviar primeiro acesso
      │                                                             │
      ▼                                                             ▼
   Empresas (CRM)  ◄──────────────  acompanhar situação e follow-up
      │
      ▼
Cliente paga PIX  →  Pagamentos: Confirmar Pagamento (vinculado à empresa)
      │
      ▼
Relatórios (receita/KPIs)  +  Atualizações (manter clientes na versão atual)
```

---

### Observações importantes
- **Bloqueio comercial** (em Empresas ou Licenças) **revoga a sessão da empresa imediatamente**.
- **Licenças/planos** só mudam pelo Master; o SaaS enxerga tudo como leitura.
- **Atualizações e implantação** nunca executam no navegador — quem instala é o **Update Agent**.
- **Token do Update Agent** é exibido **uma única vez** no wizard; copie na hora.
