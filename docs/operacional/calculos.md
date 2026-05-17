# Cálculos

**Menu:** Ponto → Cálculos  
**Caminho:** `/admin/calculos`

---

## 1. O que é

A tela de **Cálculos** é uma ferramenta analítica para simular e conferir horas trabalhadas, extras, intervalos, adicional noturno e inconsistências em um período — com opções flexíveis de tolerância e agrupamento. Complementa o Espelho de Ponto, mas **não substitui** o fechamento oficial do espelho.

---

## 2. Para que serve

- Validar impacto de mudanças de horário antes de aplicar em massa.
- Gerar relatório de horas extras por colaborador ou departamento.
- Encontrar dias com inconsistências em períodos longos (até 120 dias).
- Exportar PDF para análise gerencial ou sindicato.
- Rodar cálculo pesado em segundo plano (job no servidor) em empresas grandes.

---

## 3. Como funciona

**Entrada:** período, colaborador (opcional), opções de cálculo.

**Processamento:** o motor (`processEmployeeDay`) lê batidas, aplica jornada do colaborador, feriados, tolerâncias de entrada/saída, regra de intervalo mínimo (6h trabalhadas → 30 min de intervalo, quando ativado), horas extras e adicional noturno.

**Saída:** tabela com totais por dia, semana ou mês; opção de filtrar “somente inconsistências”; exportação PDF.

**Exemplo:** período 01/04 a 30/04, colaborador Maria, tolerância 10 min — o sistema mostra que ela teve 12h de extras no mês e 3 dias com intervalo inferior ao mínimo legal configurado.

---

## 4. Como usar (passo a passo)

1. Acesse **Ponto → Cálculos**.
2. Defina **Data início** e **Data fim** (máximo 120 dias).
3. Opcional: filtre por **Colaborador** ou número de folha.
4. Marque as opções desejadas:
   - Aplicar tolerância de entrada/saída
   - Exigir intervalo mínimo após 6h
   - Calcular horas extras e adicional noturno
   - Agrupar por dia, semana ou mês
   - Mostrar apenas inconsistências
5. Clique em **Calcular**.
6. Revise os resultados na tela.
7. Use **Imprimir** ou **Exportar PDF** se necessário.
8. Em volumes grandes, aguarde o processamento em segundo plano concluir.

---

## 5. Regras importantes

- Período máximo: **120 dias** por consulta.
- Se o espelho do período estiver **fechado**, algumas ações de recálculo podem estar limitadas — o fechamento oficial continua sendo no Espelho.
- **Intervalo mínimo:** quando ativado, jornadas acima de 6h sem intervalo de 30 min são sinalizadas (alinhado à prática CLT de intervalo intrajornada).
- **Tolerância** não “esconde” atrasos para sempre — apenas dentro do limite configurado na empresa.
- Feriados cadastrados em **Feriados** entram no cálculo automaticamente.

---

## 6. Boas práticas

- Use Cálculos para **auditoria e análise**; use o Espelho para **fechamento oficial**.
- Compare sempre o mesmo período e as mesmas opções ao refazer um cálculo.
- Antes de questionar o colaborador, confira se a jornada/escala dele está correta no cadastro.
- Arquive PDFs de meses com acordo de banco de horas ou horas extras.

---

## 7. Erros comuns

| Problema | Causa | Solução |
|----------|-------|---------|
| Totais diferentes do espelho | Opções de tolerância/intervalo diferentes | Alinhar parâmetros ou conferir espelho |
| “Nada calculado” | Período sem batidas ou colaborador errado | Verificar filtros |
| Job demorado | Muitos colaboradores no período | Reduzir período ou filtrar um colaborador |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho de Ponto** | Fonte das batidas; fechamento não ocorre aqui |
| **Pré-Folha** | Valores finais vêm do processamento oficial, não desta tela isolada |
| **Banco de Horas** | Indireto — créditos vêm do motor após processamento diário |
| **Relatórios** | Complementar aos relatórios de horas extras do hub |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*
