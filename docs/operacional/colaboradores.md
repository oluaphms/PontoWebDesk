# Colaboradores

**Menu:** Pessoas → Colaboradores  
**Caminho:** `/admin/employees`

---

## 1. O que é

A tela de **Colaboradores** é o cadastro central de todas as pessoas que batem ponto na empresa. Cada registro reúne dados pessoais, profissionais, de acesso ao portal web e vínculos com departamento, cargo, escala e horário de trabalho.

---

## 2. Para que serve

No dia a dia do RH e da administração, esta tela permite:

- Incluir novos funcionários antes de liberarem o acesso ao app ou ao relógio REP.
- Manter dados atualizados (PIS, CPF, matrícula, cargo, departamento).
- Vincular a jornada correta (escala e horário) para que o sistema calcule horas, extras e faltas de forma adequada.
- Controlar quem pode registrar ponto pela web e quem depende apenas do relógio.
- Importar vários colaboradores de uma vez por planilha CSV.

Sem o cadastro correto, batidas do REP podem ficar sem dono, cálculos saem errados e a pré-folha não reflete a realidade.

---

## 3. Como funciona

**Entrada:** dados digitados no formulário ou importados por CSV.

**Processamento:** o sistema valida campos obrigatórios (nome), CPF e e-mail na importação, cria o usuário de acesso quando necessário e associa departamento, cargo, escala (`schedule_id`) e horário (`shift_id`).

**Saída:** registro em **Colaboradores** usado em todo o fluxo de ponto — espelho, jornada, REP, solicitações, banco de horas e pré-folha.

**Exemplo prático:** ao cadastrar João Silva com horário **Seg–Sex 08:00–12:00 / 14:00–18:00** e PIS `123.45678.90-1`, qualquer batida do relógio com esse PIS será automaticamente vinculada a ele.

---

## 4. Como usar (passo a passo)

### Incluir um colaborador manualmente

1. Acesse **Pessoas → Colaboradores**.
2. Clique em **Incluir**.
3. Preencha a seção **Identificação**: nome (obrigatório), PIS/PASEP, CPF, número de folha e identificador para REP.
4. Na seção **Dados profissionais**, selecione departamento, cargo, estrutura organizacional, escala e horário.
5. Informe data de admissão e tipo de vínculo (ex.: CLT).
6. Em **Dados Web**, defina se o colaborador pode bater ponto pelo celular/computador, se aceita ajuste manual e a senha de acesso.
7. Clique em **Salvar**.

### Importar por planilha

1. Clique em **Importar colaborador**.
2. Baixe o modelo CSV, preencha as colunas (nome, e-mail, cargo, departamento etc.).
3. Envie o arquivo, revise o mapeamento das colunas e confirme a importação.

### Editar ou desativar

1. Localize o colaborador na lista (use a busca).
2. Clique no ícone de **editar** para alterar dados.
3. Use **desativar** para quem saiu da empresa — ele deixa de aparecer nas rotinas ativas, mas o histórico de ponto permanece.

### Atalhos úteis na lista

- **Jornada** — abre o vínculo datado de horário/escala do colaborador.
- **Ausências** — registra ou consulta ausências daquela pessoa.

---

## 5. Regras importantes

- **Nome** é obrigatório; sem ele o cadastro não é salvo.
- **PIS, CPF e matrícula** devem estar corretos para integração com relógios REP e importação de AFD. Alterações nesses campos podem disparar reprocessamento automático de batidas REP.
- O **tipo de vínculo** (CLT, estagiário etc.) orienta relatórios e políticas internas.
- Marcar **“não inclusão de ponto manual”** impede que o RH inclua batidas no espelho para aquele colaborador.
- Marcar **“bloquear web”** impede registro de ponto pelo aplicativo/navegador.
- Colaboradores **inativos** não devem ser excluídos se houver histórico de ponto — prefira desativar.

**Relação com a CLT:** o cadastro não substitui a obrigação legal de controle de jornada (art. 74 e Portaria 671/2021). Ele garante que cada trabalhador tenha jornada definida e identificação compatível com o REP.

---

## 6. Boas práticas

- Cadastre **departamento, cargo, escala e horário** antes de incluir colaboradores em massa.
- Padronize o **número de folha** se a empresa usa folha de pagamento externa — facilita exportações.
- Revise PIS e matrícula **antes** de sincronizar com relógios REP.
- Use a importação CSV apenas após validar o modelo; erros de CPF duplicado geram falhas em lote.
- Mantenha e-mails atualizados para convite de acesso ao portal do colaborador.

---

## 7. Erros comuns

| Problema | Causa provável | Como evitar |
|----------|----------------|-------------|
| Batida REP sem colaborador | PIS/matrícula não cadastrados ou divergentes | Conferir identificadores antes do sync |
| Cálculo de horas errado | Escala ou horário não vinculados | Verificar dados profissionais no cadastro |
| Colaborador não acessa o app | E-mail incorreto ou acesso web bloqueado | Revisar Dados Web e reenviar convite |
| Importação falhou | CPF inválido ou duplicado | Validar planilha antes de enviar |

---

## 8. Impacto no sistema

| Área afetada | Como o cadastro influencia |
|--------------|----------------------------|
| **Espelho de Ponto** | Define de quem são as batidas e qual jornada comparar |
| **Relógios REP** | PIS/matrícula identificam o dono de cada marcação |
| **Cálculos e Pré-Folha** | Escala/horário alimentam horas trabalhadas, extras e faltas |
| **Banco de Horas** | Só movimenta quem tem colaborador ativo e jornada processada |
| **Solicitações** | Ajustes aprovados entram no espelho do colaborador correto |
| **Auditoria** | Inconsistências aparecem quando cadastro e batidas não batem |

---

*Documentação operacional — PontoWebDesk. Acesso: perfis Administrador e RH.*
