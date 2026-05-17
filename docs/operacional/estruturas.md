# Estruturas

**Menu:** Pessoas → Estruturas  
**Caminho:** `/admin/estruturas`

---

## 1. O que é

**Estruturas** representa a organização hierárquica da empresa — filiais, unidades, centros de custo ou áreas que podem ter uma estrutura “pai” e responsáveis designados. É diferente do departamento: estrutura costuma refletir a árvore organizacional ou contábil.

---

## 2. Para que serve

Permite agrupar colaboradores por unidade de negócio, definir responsáveis por área e refletir a hierarquia real (ex.: Matriz → Filial SP → Setor Expedição). Útil em empresas com várias unidades ou centros de custo.

---

## 3. Como funciona

**Entrada:** código, descrição, estrutura pai (opcional) e lista de responsáveis.

**Processamento:** o sistema valida que o **código não se repita** na empresa e grava os vínculos de responsáveis.

**Saída:** no cadastro do colaborador, a estrutura pode ser selecionada no campo correspondente.

**Exemplo:**

```
Matriz (código 01)
 └── Filial Campinas (código 01.02)
      └── Centro de Distribuição (código 01.02.01)
```

---

## 4. Como usar (passo a passo)

1. Acesse **Pessoas → Estruturas**.
2. Clique em **Incluir**.
3. Informe o **Código** (obrigatório, único) e a **Descrição** (obrigatória).
4. Se a estrutura for subordinada a outra, selecione a **Estrutura pai**.
5. Marque os **Responsáveis** (colaboradores que gerenciam aquela unidade).
6. Clique em **Salvar**.
7. Para editar ou excluir, use os botões na linha da estrutura.

---

## 5. Regras importantes

- O **código** deve ser único — o sistema não permite códigos repetidos.
- Uma estrutura pode ter **vários responsáveis**.
- A hierarquia é opcional: estruturas de topo não precisam de pai.

---

## 6. Boas práticas

- Defina um **padrão de codificação** (ex.: `01`, `01.01`, `01.01.02`) e documente internamente.
- Monte a árvore de cima para baixo (matriz antes das filiais).
- Atribua responsáveis reais — facilita futuras rotinas de aprovação e comunicação.
- Não exclua estruturas com colaboradores vinculados sem antes realocá-los.

---

## 7. Erros comuns

| Problema | Como evitar |
|----------|-------------|
| “Código já existe” | Consultar lista antes de criar |
| Colaborador na estrutura errada | Revisar vínculo no cadastro do colaborador |
| Hierarquia confusa | Planejar códigos antes de cadastrar em massa |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Colaboradores** | Campo estrutura no cadastro |
| **Relatórios** | Possível agrupamento por unidade (conforme relatórios disponíveis) |
| **Organização** | Base para expansão de permissões por unidade no futuro |

---

*Documentação operacional — PontoWebDesk. Acesso: perfis Administrador e RH.*
