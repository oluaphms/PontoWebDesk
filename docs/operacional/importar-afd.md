# Importar AFD

**Menu:** Smart → Importar AFD  
**Caminho:** `/admin/import-rep`

---

## 1. O que é

**Importar AFD** permite carregar o arquivo **AFD** (Arquivo Fonte de Dados) exportado do relógio REP — extensões `.txt`, `.csv` ou `.afd` — quando não há sincronização online ou para recuperar histórico de um período.

---

## 2. Para que serve

- Migrar marcações de relógio antigo para o PontoWebDesk.
- Recuperar batidas após falha de sync.
- Importar arquivo entregue por terceiros ou fiscalização.
- Complementar espelho de um período específico.

---

## 3. Como funciona

**Entrada:** arquivo AFD + opções opcionais (forçar colaborador, vincular relógio cadastrado).

**Processamento:** envio ao servidor (`POST /api/rep/import-afd`); leitura de campos padrão Portaria 671 — NSR, data, hora, PIS/CPF, tipo entrada/saída; identificação do colaborador; gravação e deduplicação.

**Saída:** resumo com quantidades:

| Resultado | Significado |
|-----------|-------------|
| Importadas | Gravadas com sucesso |
| Duplicadas | Já existiam — ignoradas |
| Usuário não encontrado | PIS/CPF sem cadastro |
| Erros | Linha inválida ou regra violada |

Após importar, use **Espelho de Ponto** para conferir.

---

## 4. Como usar (passo a passo)

1. Exporte o AFD no relógio (menu do fabricante — consulte manual do equipamento).
2. Acesse **Smart → Importar AFD**.
3. Clique em **Selecionar arquivo** e escolha o `.afd` / `.txt` / `.csv`.
4. Opcional: **Forçar colaborador** — todas as linhas vão para uma pessoa (use só em casos excepcionais).
5. Opcional: **Vincular relógio** — associa ao dispositivo cadastrado em Relógios REP.
6. Clique em **Importar**.
7. Leia o resumo (importadas, duplicadas, não encontradas, erros).
8. Clique em **Fechar** ou vá ao **Espelho de Ponto** conferir o período.
9. Resolva “usuário não encontrado” cadastrando PIS ou corrigindo o arquivo.

---

## 5. Regras importantes

- **Período fechado:** importação bloqueada — reabra o espelho antes.
- Linhas sem colaborador correspondente **não entram** no espelho (aparecem como não encontradas).
- Duplicatas são ignoradas para não dobrar batidas.
- Layout deve seguir **Portaria 671** — arquivos customizados podem falhar.
- Não importe o mesmo arquivo duas vezes sem necessidade.

**Exemplo de linha conceitual:** NSR 1001, data 16/05/2026, hora 08:02, PIS 12345678901, tipo Entrada.

---

## 6. Boas práticas

- Importe **fora do horário de pico** em arquivos grandes.
- Faça backup do arquivo AFD original antes de importar.
- Corrija cadastro de PIS **antes** de reimportar linhas rejeitadas.
- Prefira sync online no dia a dia; AFD para exceções e migração.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Muitos “usuário não encontrado” | Conferir PIS no cadastro de colaboradores |
| Tudo duplicado | Arquivo já importado anteriormente |
| Erro de formato | Exportar AFD novamente do relógio |
| Importação bloqueada | Período fechado no espelho |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho** | Novas batidas após promoção |
| **Auditoria** | Pode gerar pendências ou inconsistências |
| **Fiscalização** | AFD importado alimenta a mesma base de exportação futura |
| **Relógios REP** | Vincular dispositivo ajuda rastreabilidade |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*
