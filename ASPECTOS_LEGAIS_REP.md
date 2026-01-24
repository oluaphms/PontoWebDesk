# Aspectos legais e REP – SmartPonto

## Visão geral

O SmartPonto cobre **controle de ponto via app** (entrada, saída, pausa, geolocalização, foto). Para uso em **conformidade com a legislação brasileira** (CLT, Portaria 671/M labour etc.), é preciso considerar **REP** e demais requisitos.

---

## O que é REP?

**REP** = **Relógio Eletrônico de Ponto**. É o equipamento **certificado** pelo INMETRO que registra a jornada e que pode ser aceito como prova em ações trabalhistas.

- **REP “de verdade”**: hardware homologado, gerando arquivos AFD/ACJEF etc.
- **Apps de ponto**: não são REP. Podem servir como **controle auxiliar**, mas a validação legal depende de integração com REP ou de reconhecimento específico em acordo/norma.

---

## O que o SmartPonto faz hoje

- Registro de ponto (entrada, saída, pausa) com **data/hora**.
- **Geolocalização** e geofence (controle de local).
- **Foto** opcional (redução de fraude).
- **Audit logs** e relatórios (CSV, PDF).
- **Ajustes** por admin.

Isso atende a um **controle de ponto interno** e a **relatórios gerenciais**. Sozinho, **não substitui** um REP certificado.

---

## O que falta para cenários “legais” típicos

1. **Integração com REP**
   - Exportar dados em formato aceito pelo REP (ex.: AFD) ou
   - Enviar marcações para um REP/sistema que gera AFD.
   - Normalmente exige **protocolo e certificação** do fabricante do REP.

2. **Assinatura digital / não repúdio**
   - Garantir que o colaborador (e, se for o caso, o empregador) **reconheçam** as marcações.
   - Pode envolver certificado digital, biometria, token etc., conforme o que a empresa e o jurídico aceitarem.

3. **Consolidação e armazenamento**
   - Manter histórico **imutável** e **auditável** por período exigido em lei (geralmente 5 anos).
   - O Supabase já persiste os registros; é importante definir política de backup e retenção.

4. **Escalas e acordo de prorrogação**
   - Suporte a **escalas** (12×36, etc.) e **horas extras** conforme acordos.
   - O app pode evoluir para calcular isso; o jurídico precisa validar as regras.

5. **Afastamentos e folga**
   - Registro de **afastamentos** (férias, licenças, atestados) e **folgas** para não exigir ponto nesses dias.
   - Pode ser feito em módulo separado (cadastro de afastamentos) integrado aos relatórios.

---

## Recomendações

- **Uso interno / gestão**: o SmartPonto já serve para **organizar** a jornada e gerar relatórios. Consulte o jurídico para definir até onde isso pode ser usado (comprovantes, acordos internos etc.).
- **Substituir REP**: só com **integração a REP certificado** ou com solução **homologada** (ex.: sistema aprovado em acordo ou norma). O SmartPonto hoje **não** é REP.
- **Auditoria e disputas**: mantenha **audit logs**, **exportação PDF/CSV** e **backups** do banco; isso ajuda em auditorias e eventual necessidade de comprovação.

---

## Referências

- Portaria 671/2021 (Simplificação das obrigações trabalhistas).
- Normas do INMETRO sobre REP (consulte o site do INMETRO).
- Orientação do **advogado trabalhista** ou **contador** da empresa para o uso do ponto e de sistemas auxiliares.

---

**Resumo**: o SmartPonto é um **sistema de controle de ponto em app** útil para gestão e relatórios. Para **atender exigências legais de REP e CLT**, é necessário integrar com REP certificado ou adotar solução juridicamente reconhecida, conforme orientação do jurídico/contador.
