# Relatório RC2.1.5 — Layout físico Professional

**Data:** 2026-08-06  
**Entrega:** documentação `RC2-LAYOUT-1.0.0`  
**Referências:** `docs/ARQUITETURA_INSTALADOR_PROFISSIONAL_RC2.md`, `docs/RELATORIO_RC2_1_FINAL.md`  
**Restrições respeitadas:** sem código, sem scripts, sem Setup, sem PostgreSQL, sem serviços.

---

## 1. Objetivo

Projetar o **layout físico definitivo** da instalação PontoWebDesk Professional para uso em RC2.2, RC2.3, RC2.4 e Setup futuro.

---

## 2. Entregáveis

| Item | Status | Documento |
|------|--------|-----------|
| Árvore Program Files completa | OK | `docs/RC2_INSTALL_LAYOUT.md` §3.1 |
| Árvore ProgramData completa | OK | §3.2 |
| Logs / Backups / Temp / Updates / Rollback | OK | §3.2, §6 |
| Agent / Updater / Database / Runtime / Config | OK | §3 |
| Classificação instalador × usuário | OK | §4 |
| Nunca remover × recriável | OK | §4.3–4.4 |
| ACL e permissões | OK | §5 |
| Uploads e cache | OK | §6 |
| Layout install / update / rollback / repair / uninstall | OK | §7 |
| Diagramas Mermaid | OK | §2, §7.1 |
| Validação RC2-ARCH-1.0.0 | OK | §10 |
| Alinhamento Bootstrap paths | OK | `install-state.json`, `Logs`, `Config` na raiz PD |

---

## 3. Decisões de projeto

| Decisão | Escolha |
|---------|---------|
| Raiz RC2 Professional | `%ProgramFiles%\PontoWebDesk` + `%ProgramData%\PontoWebDesk` |
| Coexistência RC1 | Paths `\Local\` inalterados |
| Uploads produção | `ProgramData\Storage\uploads` + `UPLOAD_DIR` |
| Rollback | `Rollback\last-good` + `Backups\pg` + `Backups\app` pareados |
| Versão do layout | `RC2-LAYOUT-1.0.0` em `layout.manifest.json` |
| Frontend ADR-001 | Árvore PF `Frontend\www` reservada; variante serviço documentada §9 |

---

## 4. Validação arquitetural

| Critério | Resultado |
|----------|-----------|
| Seção 5 RC2-ARCH (estrutura PF/PD) | **PASS** — superset documentado |
| Recuperação / artefatos § Recuperação | **PASS** — Backups + Rollback + install-state |
| Segurança §9 (Config DPAPI) | **PASS** |
| Updater §8 (cache/staging/backup) | **PASS** |
| Bootstrap RC2.1 paths | **PASS** — compatível com `ConfigManager` |
| ADR-001 pendente | **WARNING** — não bloqueia árvore; bloqueia homologação final |

---

## 5. Riscos residuais

| Risco | Mitigação |
|-------|-----------|
| ADR-001 alterar serviço Web | Layout PF já reserva `Frontend\www`; só muda SCM/firewall |
| ADR-004 formato `.pwdupdate` | `Updates\cache` agnóstico a extensão |
| Migração RC1→RC2 | Fora RC2.1.5 — RC2.4 migrador (arch) |

---

## 6. Próximos passos (fora deste escopo)

1. RC2.2: `ConfigManager` / Bootstrap referenciar subpaths de `RC2_INSTALL_LAYOUT.md`.
2. Fechar ADR-001 antes de homologação com frontend real.
3. Gerar `layout.manifest.json` no pipeline de build.

---

## 7. Autoauditoria

| Veredito | Condição |
|----------|----------|
| Layout completo e validado | Sim |
| Implementação | Não solicitada |
| Conformidade RC2-ARCH | Sim, com WARNING ADR-001 |

---

## 8. Resultado final

**PASS**
