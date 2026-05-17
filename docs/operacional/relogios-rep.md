# Relógios REP

**Menu:** Smart → Relógios REP  
**Caminho:** `/admin/rep-devices`

---

## 1. O que é

**Relógios REP** gerencia os equipamentos registradores eletrônicos de ponto (REP) conectados à empresa — cadastro, teste de conexão, sincronização de batidas e envio/recebimento de cadastro de colaboradores no dispositivo.

É o ponto de integração entre o hardware na portaria/fábrica e o espelho digital do PontoWebDesk.

---

## 2. Para que serve

- Cadastrar cada relógio (IP, URL, fabricante, modelo).
- Testar se o equipamento responde na rede.
- **Sincronizar** batidas do relógio para o sistema.
- Promover batidas pendentes para o espelho oficial.
- Enviar lista de colaboradores ao REP e alinhar PIS/matrícula.
- Acompanhar status de sync (última comunicação, erros).

---

## 3. Como funciona

**Entrada:** dados do dispositivo e comandos do operador (sync, teste, push de colaboradores).

**Processamento:** APIs de integração leem batidas do equipamento, gravam em `rep_punch_logs` e, quando válidas, promovem para `time_records` (espelho). Identificação por PIS, CPF ou matrícula conforme o equipamento.

**Saída:** batidas no espelho; pendências na coluna REP ou em **Auditoria — Jornada**.

**Fluxo típico:**

```
Relógio na empresa → Sync → Logs REP → Validação → Espelho de Ponto
```

**Exemplo:** relógio “Portaria 1” sincronizado às 23h; 150 batidas do dia; 3 ficam pendentes porque PIS não existe no cadastro.

---

## 4. Como usar (passo a passo)

### Cadastrar relógio

1. Acesse **Smart → Relógios REP**.
2. Clique em **Incluir** / **Novo dispositivo**.
3. Informe nome, fabricante, endereço IP ou URL e credenciais se exigidas.
4. Salve.

### Testar conexão

1. Na linha do dispositivo, use **Testar conexão**.
2. Aguarde sucesso ou mensagem de erro (rede, firewall, senha).

### Sincronizar batidas

1. Clique em **Sincronizar** (ou sync manual).
2. Aguarde conclusão — verifique quantidade importada.
3. Abra **Espelho** ou **Auditoria** para pendências.

### Enviar colaboradores ao relógio

1. Use **Enviar colaboradores** (quando disponível para o modelo).
2. Confirme que PIS/matrícula no cadastro batem com o relógio.

### Promover pendentes

1. Se houver batidas em staging, use a ação de **promover** pendentes ou resolva na auditoria.

---

## 5. Regras importantes

- **Período fechado** no espelho bloqueia promoção de novas batidas REP naquele mês.
- PIS/CPF/matrícula no cadastro devem **coincidir** com o relógio.
- Alteração de PIS no colaborador pode disparar **reprocessamento** automático de batidas REP.
- Equipamento offline: batidas ficam no relógio até o próximo sync — não perdem se o relógio estiver conforme Portaria 671.

**Legal:** REP e arquivos AFD seguem Portaria MTP nº 671/2021 e IN 89/2022.

---

## 6. Boas práticas

- Sync automático diário + sync manual após queda de energia.
- Padronize PIS com 11 dígitos no cadastro e no relógio.
- Monitore relógios sem comunicação há mais de 24h.
- Mantenha um responsável técnico (TI) para IP e firewall.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Batida não aparece | Sync não rodou ou PIS inválido |
| Sync falha sempre | IP, VPN, credencial ou firmware |
| Duplicata no espelho | Não importar AFD e sync do mesmo dia sem conferir |
| Promoção bloqueada | Reabrir período fechado ou corrigir cadastro |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho de Ponto** | Destino final das batidas |
| **Importar AFD** | Alternativa quando não há sync online |
| **Auditoria** | Fila de REP pendente |
| **Fiscalização** | Exportação AFD/AEJ usa mesma base |
| **Colaboradores** | Identificadores devem estar corretos |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*
