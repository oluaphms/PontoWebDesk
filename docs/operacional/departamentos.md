# Departamentos

**Menu:** Pessoas → Departamentos  
**Caminho:** `/admin/departments`

---

## 1. O que é

**Departamentos** é o cadastro de setores ou áreas da empresa (ex.: Produção, RH, Comercial). Cada departamento tem um nome e, opcionalmente, um número de folha para integração com sistemas de pagamento.

---

## 2. Para que serve

Organiza colaboradores por área e permite filtrar relatórios, espelho de ponto e análises por setor. Em empresas com muitos funcionários, o departamento é o primeiro filtro usado pelo RH para fechar ponto ou auditar um grupo específico.

---

## 3. Como funciona

**Entrada:** nome do departamento e número de folha (opcional).

**Processamento:** o sistema grava o registro e disponibiliza na lista de departamentos para vínculo em colaboradores.

**Saída:** ao cadastrar um colaborador, o departamento escolhido passa a filtrar espelho, cálculos e relatórios daquele grupo.

**Exemplo:** o departamento **“Logística”** com número de folha `03` agrupa todos os motoristas; ao filtrar o espelho por Logística, aparecem apenas eles.

---

## 4. Como usar (passo a passo)

1. Acesse **Pessoas → Departamentos**.
2. Clique em **Incluir**.
3. Informe a **Descrição** (nome do departamento) — campo obrigatório.
4. Se a empresa usa código na folha externa, preencha o **Nº Folha**.
5. Clique em **Salvar**.
6. Para alterar, selecione o departamento e use **Editar**.
7. Para excluir, confirme a ação — o sistema avisa se ainda houver colaboradores vinculados (eles ficarão sem departamento).

---

## 5. Regras importantes

- O **nome** é obrigatório.
- **Excluir** um departamento não apaga colaboradores; apenas remove o vínculo — revise antes de excluir.
- O **número de folha** do departamento pode ser usado em exportações de cálculos para o sistema de folha de pagamento.

---

## 6. Boas práticas

- Crie departamentos **antes** de cadastrar colaboradores em massa.
- Use nomes claros e alinhados à estrutura real da empresa (evite siglas internas que só o RH entende).
- Não duplique departamentos com nomes parecidos (“TI” e “Tecnologia”) — isso confunde filtros.
- Revise periodicamente departamentos vazios ou obsoletos.

---

## 7. Erros comuns

| Problema | Como evitar |
|----------|-------------|
| Colaborador sem departamento nos relatórios | Sempre selecione departamento no cadastro |
| Filtro do espelho vazio | Verifique se o departamento tem colaboradores ativos vinculados |
| Código de folha errado na exportação | Conferir Nº Folha com o departamento no sistema de folha |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Colaboradores** | Cada pessoa pode ter um departamento principal |
| **Espelho de Ponto** | Filtro por departamento na consulta |
| **Relatórios** | Agrupamento e filtros por setor |
| **Cálculos** | Exportação pode incluir código do departamento |

---

*Documentação operacional — PontoWebDesk. Acesso: perfis Administrador e RH.*
