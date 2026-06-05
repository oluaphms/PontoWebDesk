# Tecnologia do Sistema PontoWebDesk

Este documento explica, em linguagem direta, quais tecnologias compõem o PontoWebDesk e qual é o papel de cada camada: frontend, backend e banco de dados.

## Visão Geral

O PontoWebDesk é uma aplicação web para controle de ponto, gestão de jornada, auditoria operacional, REP, geolocalização, anexos/fotos e rotinas administrativas de RH.

A arquitetura é dividida em três partes principais:

```text
Usuário no navegador
        |
        v
Frontend React/Vite
        |
        v
Backend/API Node.js
        |
        v
Banco de dados PostgreSQL
```

Além dessas camadas, o projeto possui scripts operacionais, integrações REP, documentação, testes automatizados e rotinas de deploy.

## Frontend

O frontend é a parte visual do sistema, ou seja, aquilo que o usuário acessa no navegador.

### Principais tecnologias

- **React**: biblioteca usada para criar as telas e componentes da aplicação.
- **TypeScript**: adiciona tipagem ao JavaScript, reduzindo erros em tempo de desenvolvimento.
- **Vite**: ferramenta de build e desenvolvimento rápido do frontend.
- **React Router**: organiza as rotas/telas da aplicação.
- **TanStack React Query**: gerencia cache, carregamento e revalidação de dados.
- **Tailwind CSS**: usado para estilos visuais e layout.
- **Vitest**: usado para testes automatizados.

### O que o frontend faz

O frontend é responsável por:

- Exibir as telas de login, dashboard, ponto, espelho, relatórios, cadastros e administração.
- Separar experiências de **administrador/RH** e **colaborador**.
- Enviar requisições para a API do backend.
- Validar entradas básicas do usuário antes de enviar ao servidor.
- Mostrar mensagens, alertas, estados de carregamento e erros.
- Executar parte da lógica visual de geolocalização, anexos e operações em tempo real.
- Solicitar ao backend URLs temporárias e assinadas para que administradores/RH visualizem fotos de marcação sem tornar os arquivos públicos.

### Onde fica no projeto

Arquivos principais:

- `src/`: código principal do frontend.
- `src/pages/`: páginas da aplicação.
- `src/components/`: componentes reutilizáveis.
- `src/services/`: serviços de comunicação com API e regras de apoio.
- `components/`: componentes legados/compartilhados ainda usados.
- `vite.config.ts`: configuração do Vite.
- `package.json`: scripts e dependências do frontend.

### Build do frontend

O comando principal é:

```bash
npm run build
```

Ele gera a pasta:

```text
dist/
```

Essa pasta contém os arquivos estáticos finais que podem ser servidos por Vercel, Nginx ou outro servidor web.

## Backend

O backend é a camada de servidor. Ele recebe requisições do frontend, valida permissões, executa regras de negócio e conversa com o banco de dados.

### Principais tecnologias

- **Node.js**: ambiente de execução JavaScript no servidor.
- **Express**: framework HTTP usado para criar a API.
- **TypeScript**: usado também no backend para tipagem.
- **PostgreSQL (`pg`)**: biblioteca de acesso ao banco.
- **JWT**: usado para autenticação e autorização.
- **bcryptjs**: usado para hashing/validação de senhas.
- **Pino**: logger estruturado para observabilidade.
- **Vitest**: testes automatizados do backend.

### O que o backend faz

O backend é responsável por:

- Autenticação e sessão.
- Validação de permissões por usuário, empresa e perfil.
- Rotas da API em `/api`.
- Operações de cadastro, edição, exclusão e consulta.
- Registro de ponto e processamento operacional.
- Upload seguro de arquivos/fotos.
- Integração com REP e rotinas auxiliares.
- Logs estruturados com `requestId` e `correlationId`.
- Tratamento padronizado de erros.
- Comunicação segura com o banco de dados.

### Onde fica no projeto

Arquivos principais:

- `backend/src/app.ts`: configura o servidor Express.
- `backend/src/server.ts`: inicialização do backend.
- `backend/src/routes/`: rotas da API.
- `backend/src/controllers/`: entrada das regras de cada rota.
- `backend/src/services/`: serviços de negócio do backend.
- `backend/src/db/`: conexão/configuração de banco.
- `backend/src/logger/`: logger estruturado.
- `backend/package.json`: scripts e dependências do backend.

### Build do backend

Dentro da pasta `backend/`, o comando é:

```bash
npm run build
```

Ele compila TypeScript para JavaScript na pasta:

```text
backend/dist/
```

Em produção na VPS, o backend pode ser executado por PM2, por exemplo:

```bash
pm2 restart pontoweb-api
```

## API Serverless / Compatibilidade

O projeto também possui a pasta:

```text
api/
```

Ela contém handlers serverless e rotas auxiliares, usadas especialmente em ambientes como Vercel ou para compatibilidade com fluxos antigos.

Na arquitetura atual, existem dois estilos convivendo:

- **Backend Express na VPS**: API principal para produção VPS.
- **Handlers em `api/`**: rotas serverless/compatibilidade para deploys e fluxos específicos.

Essa convivência existe porque o sistema evoluiu de uma arquitetura mais dependente de Supabase/Vercel para uma arquitetura com API própria em VPS.

## Banco de Dados

O banco de dados é onde ficam armazenadas as informações permanentes do sistema.

### Principal tecnologia

- **PostgreSQL**: banco relacional usado para guardar dados da aplicação.

Historicamente, o projeto usou Supabase como plataforma principal, pois Supabase fornece PostgreSQL, Auth, Storage e APIs automáticas. Hoje o código mantém nomes e camadas de compatibilidade com Supabase em alguns pontos, mas a camada `dbHttp` indica o acesso principal via API HTTP/VPS.

### O que o banco armazena

O banco guarda dados como:

- Usuários.
- Empresas/tenants.
- Colaboradores.
- Registros de ponto.
- Jornadas, escalas e horários.
- Departamentos e cargos.
- Justificativas, solicitações e ajustes.
- Logs operacionais e auditorias.
- Dispositivos REP.
- Eventos de geolocalização.
- Configurações e políticas do sistema.

### Multi-tenant

O sistema é multi-tenant, ou seja, uma mesma instalação pode atender várias empresas.

Por isso, muitas tabelas usam campos como:

- `company_id`
- `tenant_id`
- `user_id`

Esses campos são importantes para garantir que cada empresa veja apenas seus próprios dados.

### Onde ficam scripts e migrations

Os scripts SQL e migrations ficam principalmente em:

- `supabase/migrations/`
- `backend/db/migrations/`

Mesmo com o nome `supabase`, muitas migrations representam a estrutura PostgreSQL usada pelo sistema.

## Camada de Comunicação com Dados

No frontend, existe uma camada que preserva compatibilidade com chamadas antigas no estilo Supabase, mas redireciona operações para a API HTTP.

Arquivo importante:

```text
src/services/dbHttp.ts
```

Esse arquivo expõe funções como:

- `select`
- `insert`
- `update`
- `upsert`
- `delete`
- `rpc`

Na prática, essa camada permite que partes antigas do sistema continuem funcionando enquanto o acesso real passa pela API da VPS.

## Observabilidade e Logs

O sistema possui uma camada de observabilidade com logs estruturados.

Principais objetivos:

- Evitar `console.log` solto em produção.
- Padronizar logs em JSON.
- Incluir `requestId` e `correlationId`.
- Separar níveis como `info`, `warn`, `error` e `fatal`.
- Evitar vazamento de senhas, tokens, CPF, e-mail e outros dados sensíveis.

Arquivos importantes:

- `src/shared/logger/`
- `backend/src/logger/`
- `backend/src/middleware/requestContext.ts`

## Uploads e Arquivos

O sistema possui validações de upload para evitar arquivos maliciosos.

Pontos importantes:

- Uploads não devem ser aceitos apenas pela extensão.
- Validação deve considerar tipo, tamanho, conteúdo e segurança.
- Arquivos sensíveis não devem ser salvos em diretórios públicos sem controle.
- Fotos e anexos passam por políticas centralizadas.
- Fotos de marcação são armazenadas fora de diretórios públicos e servidas somente por URL assinada temporária.
- Administradores/RH podem visualizar fotos de marcação nas telas administrativas de ponto, e o frontend renova a URL assinada no momento da visualização.

Arquivos relacionados:

- `src/shared/upload/`
- `backend/src/upload/`
- `api/_shared/upload/`

## Deploy

O sistema pode ser publicado em mais de um formato.

### Frontend

O frontend gera arquivos estáticos em `dist/`.

Pode ser servido por:

- Vercel.
- Nginx em VPS.
- Outro servidor de arquivos estáticos.

### Backend

O backend Express roda como processo Node.js.

Em VPS, normalmente é gerenciado por:

- PM2.
- Nginx como proxy reverso.

Fluxo típico na VPS:

```bash
cd /root/PontoWebDesk
npm run build

cd /root/PontoWebDesk/backend
npm run build
pm2 restart pontoweb-api
sudo systemctl reload nginx
```

## Resumo Simples

- **Frontend**: telas que o usuário acessa no navegador. Feito com React, TypeScript e Vite.
- **Backend**: API que processa regras, autenticação, permissões e dados. Feito com Node.js, Express e TypeScript.
- **Banco de dados**: onde os dados são guardados de forma permanente. Usa PostgreSQL.
- **VPS/Vercel**: ambientes de deploy. A VPS hospeda backend e pode servir frontend; a Vercel pode hospedar frontend/serverless.
- **Supabase**: aparece em nomes e camadas de compatibilidade, e historicamente foi base do projeto, mas a arquitetura atual também opera com API própria e PostgreSQL em VPS.

## Referências Internas

- `README.md`
- `docs/database.md`
- `docs/arquitetura-ui.md`
- `docs/ARCHITECTURE_MAP.md`
- `docs/OPERATIONAL_RUNBOOK.md`
- `backend/src/app.ts`
- `src/services/dbHttp.ts`
