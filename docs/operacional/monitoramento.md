# Monitoramento em tempo real

**Menu:** Gestão → Monitoramento (admin) · Mapa em tempo real (colaborador)  
**Caminho:** `/admin/monitoring` · `/employee/monitoring`

---

## 1. O que é

O **Monitoramento** mostra onde cada colaborador está no expediente **agora**: trabalhando, em intervalo, em almoço ou fora do horário. Inclui visão em **cards** (Hoje) e **mapa** com localização quando a batida trouxe GPS válido.

---

## 2. Para que serve

- Gestores acompanharem equipe de campo ou home office em tempo real.
- Identificar quem ainda não bateu entrada ou está em intervalo prolongado.
- Visualizar última posição no mapa (com consentimento e política de privacidade da empresa).
- Apoio operacional — **não** substitui o espelho para fechamento.

---

## 3. Como funciona

**Entrada:** batidas recentes, estado operacional consolidado (`current_operational_state`) e, quando disponível, localização (`live_employee_location`).

**Processamento:** o sistema atualiza em **tempo real** (conexão ao banco) quando há nova batida ou mudança de estado. Se não houver estado consolidado, deriva da última batida do dia.

**Saída:** cards por status e pins no mapa (precisão GPS muito baixa pode ser ignorada por regra de qualidade).

**Exemplo às 10:30:** 45 “Trabalhando”, 3 “Intervalo”, 2 “Almoço”, 12 “Fora do expediente” (ainda não entraram ou já saíram).

---

## 4. Como usar (passo a passo)

1. Acesse **Gestão → Monitoramento**.
2. Aba **Hoje:** revise os cards e a lista por status.
3. Aba **Mapa:** visualize colaboradores com localização; use zoom para regiões com muitos pins.
4. Clique em um colaborador (quando disponível) para ver detalhe da última batida.
5. Colaborador no portal vê versão simplificada em **Mapa em tempo real** (conforme permissões).

---

## 5. Regras importantes

- **Somente leitura** — não altera ponto nem folha.
- GPS depende de configuração **GPS obrigatório** e do dispositivo do colaborador.
- Localização imprecisa pode não aparecer no mapa (filtro de qualidade).
- Dados de geolocalização devem respeitar LGPD e política interna de monitoramento.

---

## 6. Boas práticas

- Comunique aos colaboradores que o monitoramento existe e em quais horários.
- Use para gestão operacional, não como única prova disciplinar.
- Em caso de divergência, confira sempre o **Espelho de Ponto**.
- Não tome decisões de desligamento só com base no mapa.

---

## 7. Erros comuns

| Problema | Solução |
|----------|---------|
| Colaborador “fora” mas está trabalhando | Última batida não registrada ou atraso |
| Não aparece no mapa | GPS desligado, negado ou impreciso |
| Contagem desatualizada | Aguardar alguns segundos; verificar conexão |

---

## 8. Impacto no sistema

| Área | Impacto |
|------|---------|
| **Espelho** | Nenhum — fonte diferente, mesmas batidas no fundo |
| **Segurança** | Geo entra em análise de fraude em outra tela |
| **Configurações** | GPS obrigatório altera comportamento do app |

---

*Documentação operacional — PontoWebDesk. Acesso: Administrador, RH e colaborador (mapa conforme perfil).*
