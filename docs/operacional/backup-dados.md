# Backup dos dados

**Menu:** Smart → Backup dos dados  
**Caminho:** `/admin/backup`

---

## 1. O que é

**Backup dos dados** permite **exportar** uma cópia completa dos dados da empresa em JSON e configurar **backup automático** agendado (diário ou semanal). É a salvaguarda operacional contra perda de informação ou necessidade de migração.

---

## 2. Para que serve

- Ter cópia local dos cadastros, batidas e configurações.
- Atender política interna de continuidade de negócio.
- Recuperar referência após erro humano (consulta, não substitui restore automático sem suporte).
- Documentar estado da empresa em data específica (auditoria).

---

## 3. Como funciona

**Exportação manual:** monta payload com tabelas principais da empresa e baixa arquivo `.json`.

**Agendamento:** grava preferências em `company_backup_settings` — ativo/inativo, frequência (diária/semanal), dia da semana, horário e data da última execução.

**Conteúdo típico do backup (entre outros):**

- Empresa, colaboradores, departamentos, escalas, horários
- Batidas (`time_records` — com limite de volume, ex.: 25 mil registros)
- Resumos diários, banco de horas, saldos
- Feriados, justificativas, eventos de folha
- Relógios REP e logs REP pendentes
- Regras da empresa (`company_rules`)

---

## 4. Como usar (passo a passo)

### Exportar agora

1. Acesse **Smart → Backup dos dados**.
2. Clique em **Exportar JSON** (ou botão equivalente).
3. Aguarde a geração — pode levar minutos em empresas grandes.
4. Salve o arquivo em local seguro (nuvem corporativa, não pendrive pessoal).

### Configurar backup automático

1. Ative **Backup automático**.
2. Escolha **Frequência**: diária ou semanal.
3. Se semanal, selecione o **dia da semana**.
4. Defina o **horário** (ex.: 02:00 — fora do expediente).
5. Salve as configurações.
6. Acompanhe **Última execução** na tela.

---

## 5. Regras importantes

- O JSON exportado pode conter **dados pessoais** (CPF, e-mail) — trate como confidencial (LGPD).
- Limite de batidas no export: empresas muito grandes podem ter histórico parcial no arquivo — combine com exportações mensais do espelho.
- Backup automático depende da infraestrutura do serviço — confirme com suporte se os arquivos são armazenados em nuvem ou apenas processados.
- **Não é substituto** do backup do provedor de banco de dados (Supabase/nuvem).

---

## 6. Boas práticas

- Exporte manualmente antes de migrações ou mudanças em massa de cadastro.
- Criptografe ou restrinja acesso à pasta de backups.
- Teste abrir o JSON em ambiente seguro para validar conteúdo (amostra).
- Mantenha política de retenção (ex.: 12 meses de backups mensais).

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Export falhou | Reduzir carga; tentar fora do horário de pico; suporte |
| Arquivo muito grande | Exportações periódicas por mês |
| Achar que é restore com 1 clique | Restauração exige procedimento técnico/suporte |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Todos os módulos** | Cópia de leitura — não altera operação |
| **Segurança** | Protege contra perda; vazamento se mal armazenado |
| **Fiscalização** | Complementar aos AFD oficiais |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*
