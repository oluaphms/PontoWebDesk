# Segurança e Antifraude

**Menu:** Smart → Segurança e Antifraude  
**Caminho:** `/admin/security` · relatório: `/admin/reports/security`

---

## 1. O que é

**Segurança e Antifraude** exibe batidas de ponto com **score de fraude elevado** e alertas associados — localização suspeita, dispositivo desconhecido, divergência facial ou comportamento anômalo. Inclui mapa das batidas georreferenciadas para investigação.

É ferramenta de **análise**, não de bloqueio automático de ponto na maioria dos fluxos.

---

## 2. Para que serve

- Investigar batidas feitas longe do local permitido.
- Detectar uso de aparelho não cadastrado.
- Revisar tentativas com falha de reconhecimento facial (quando foto está ativa).
- Apoiar decisão do RH antes de advertência ou ajuste.
- Complementar política interna de uso do app de ponto.

---

## 3. Como funciona

**Entrada:** batidas em `time_records` com `fraud_score` acima do limite (ex.: > 50) e tabela de `fraud_alerts`.

**Processamento:** no registro da batida (app/web), o sistema avalia GPS, dispositivo, foto e padrões; grava score e flags.

**Saída:** lista filtrada + mapa Leaflet com pins das localizações.

**Flags comuns:**

| Flag | Significado operacional |
|------|-------------------------|
| location_violation | Batida fora da área permitida |
| device_unknown | Dispositivo não reconhecido |
| face_mismatch | Foto não confere com cadastro |
| behavior_anomaly | Padrão atípico de horários/frequência |

---

## 4. Como usar (passo a passo)

1. Acesse **Smart → Segurança e Antifraude**.
2. Revise a lista de registros suspeitos (período conforme filtros da tela).
3. Clique em um registro para ver detalhes (colaborador, horário, score, flags).
4. Use o **mapa** para comparar local da batida com cerca da empresa (configurada em Empresa/Configurações).
5. Abra o **Espelho de Ponto** do colaborador no mesmo dia para contexto.
6. Se procedente, tome ação interna (advertência, bloqueio web, ajuste).
7. Se falso positivo (GPS impreciso), documente e ignore — não há “aprovar fraude” obrigatório na tela.
8. Para visão agregada, use **Relatórios → Segurança**.

---

## 5. Regras importantes

- Score alto **não desliga** automaticamente o colaborador — RH decide.
- GPS em ambientes fechados pode gerar **falso positivo**.
- Foto obrigatória e biometria dependem de **Configurações** da empresa.
- Dados de localização: tratamento conforme **LGPD** e política interna.

---

## 6. Boas práticas

- Comunique na política de RH que batidas são geolocalizadas quando GPS está ativo.
- Investigue antes de penalizar — converse com o colaborador.
- Ajuste raio da cerca (geofence) se muitos falsos positivos no mesmo prédio.
- Revise semanalmente, não só quando há denúncia.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Todos com location_violation | Raio da cerca muito pequeno ou GPS ruim |
| Lista vazia | Período sem batidas ou score abaixo do limite |
| Mapa sem pin | Batida sem coordenadas ou precisão rejeitada |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho** | Batidas permanecem; investigação paralela |
| **Configurações** | GPS, foto e ponto manual alteram score |
| **Monitoramento** | Mesma origem de geo, foco diferente |
| **Solicitações** | Ajuste aprovado pode corrigir dia suspeito |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador e RH.*
