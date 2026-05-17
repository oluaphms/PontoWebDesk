# Empresa

**Menu:** Smart → Empresa  
**Caminho:** `/admin/company`

---

## 1. O que é

A tela **Empresa** exibe e permite editar os **dados cadastrais da organização** no PontoWebDesk: razão social, CNPJ, endereço, responsável, fuso horário, parâmetros do comprovante de ponto e opções que afetam todos os colaboradores (foto obrigatória, ponto manual, cerca geográfica).

---

## 2. Para que serve

- Manter CNPJ e endereço corretos para relatórios e exportações legais (Portaria 1510 / 671).
- Definir **fuso horário** único da operação (padrão Brasil: America/Sao_Paulo).
- Configurar **cerca** (raio em metros) para validação de localização no app.
- Ver resumo rápido antes de ir às **Configurações** detalhadas.

---

## 3. Como funciona

**Entrada:** dados editados pelo administrador.

**Processamento:** gravação em `companies` e `settings` associados.

**Saída:** identidade da empresa em todo o sistema — comprovantes, exports AFD, telas de ponto.

**Campos importantes (conforme cadastro):**

| Campo | Uso |
|-------|-----|
| Nome / Razão social | Cabeçalhos e relatórios |
| CNPJ | Fiscalização e folha |
| Endereço completo | Documentos oficiais |
| CEI / IE | Quando aplicável |
| Timezone | Horário das batidas e do espelho |
| Jornada padrão | Referência visual |
| Cerca (lat/lng/raio) | Antifraude e monitoramento |
| Foto obrigatória | Exige selfie no registro |
| Ponto manual permitido | RH/colaborador podem lançar manual |

---

## 4. Como usar (passo a passo)

1. Acesse **Smart → Empresa**.
2. Revise os dados exibidos (nome, jornada padrão, cerca, foto, manual).
3. Para alterar, use o fluxo de edição da página ou clique em **Ir para Configurações** para campos completos.
4. Atualize CNPJ/endereço após mudança contratual na empresa.
5. Ajuste cerca após mudança de endereço do escritório/fábrica.
6. Salve e comunique ao RH se mudou foto obrigatória ou ponto manual.

---

## 5. Regras importantes

- **CNPJ** incorreto compromete exportações fiscais e REP-P.
- **Fuso horário** errado desloca todas as batidas — não altere sem planejamento.
- Desligar **ponto manual** impede correções no espelho (exceto fluxos aprovados).
- **Cerca** muito restritiva aumenta alertas de fraude (falsos positivos).

**CLT / MTE:** dados do empregador nos registros de ponto devem refletir o estabelecimento real (Portaria 1510 e 671).

---

## 6. Boas práticas

- Revise dados da empresa na implantação e anualmente.
- Alinhe cerca com o perímetro real + margem (ex.: 100–300 m).
- Documente internamente quem pode alterar dados da empresa (apenas admin).
- Após mudar endereço, teste uma batida de teste no app.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Batidas com horário “estranho” | Conferir fuso em Empresa/Configurações |
| Todos alertas de localização | Aumentar raio da cerca ou corrigir coordenadas |
| Colaborador não bate manual | `allowManualPunch` desligado |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Configurações** | Detalhamento de políticas |
| **App colaborador** | Foto, GPS, manual |
| **Fiscalização** | CNPJ/endereço nos arquivos |
| **Antifraude / Monitoramento** | Cerca e regras de geo |
| **Todos os colaboradores** | Escopo único por empresa (tenant) |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*
