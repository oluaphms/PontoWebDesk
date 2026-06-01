# Runbook de Comandos da VPS - PontoWebDesk

Este guia reúne comandos operacionais para acessar a VPS, navegar no projeto, editar arquivos, aplicar migrations, entrar no PostgreSQL, consultar tabelas, validar o backend e reiniciar serviços.

> Importante: não grave senhas reais neste arquivo. Use placeholders como `<SENHA_URL_ENCODED>`. Se a senha tiver `@`, use `%40` na `DATABASE_URL`.

## 1. Variáveis e Caminhos Padrão

```bash
# Caminho do projeto na VPS
cd /root/PontoWebDesk

# Backend
cd /root/PontoWebDesk/backend

# Migrations
cd /root/PontoWebDesk/supabase/migrations

# URL do banco com senha URL-encoded
export DATABASE_URL='postgresql://admin:<SENHA_URL_ENCODED>@localhost:5432/pontowebdesk'

# Exemplo de escape:
# senha Admin@123456 vira Admin%40123456
```

## 2. Acessar a VPS

No Windows PowerShell:

```powershell
ssh root@srv1694106
```

Com IP:

```powershell
ssh root@IP_DA_VPS
```

Sair da VPS:

```bash
exit
```

Fechar sessão travada de SSH:

```text
Enter
~.
```

## 3. Navegação no Linux

Mostrar pasta atual:

```bash
pwd
```

Listar arquivos:

```bash
ls
ls -la
ls -lah
```

Entrar em uma pasta:

```bash
cd /root/PontoWebDesk
cd backend
cd ..
cd ~
```

Limpar terminal:

```bash
clear
```

Ver histórico:

```bash
history
history | tail -50
```

Procurar arquivo:

```bash
find /root/PontoWebDesk -name "package.json"
find /root/PontoWebDesk -name "*.sql"
find /root/PontoWebDesk -path "*migrations*" -name "*.sql"
```

Procurar texto:

```bash
grep -R "DATABASE_URL" /root/PontoWebDesk 2>/dev/null
grep -R "20260601110500" /root/PontoWebDesk 2>/dev/null
```

## 4. Abrir, Fechar, Salvar, Copiar e Colar Arquivos

### 4.1 Abrir Arquivo Somente Leitura

```bash
less /root/PontoWebDesk/backend/package.json
less /root/PontoWebDesk/.env
```

Comandos dentro do `less`:

```text
q        sair/fechar
/texto   buscar texto
n        próxima ocorrência
N        ocorrência anterior
g        início do arquivo
G        fim do arquivo
```

Mostrar começo/fim do arquivo:

```bash
head -50 /root/PontoWebDesk/backend/package.json
tail -50 /root/PontoWebDesk/backend/package.json
tail -f /root/.pm2/logs/pontoweb-api-out.log
```

### 4.2 Abrir e Editar com Nano

Abrir arquivo:

```bash
nano /root/PontoWebDesk/backend/.env
nano /root/PontoWebDesk/backend/src/app.ts
nano /root/PontoWebDesk/supabase/migrations/20260601110500_employee_schedule_shift_links.sql
```

Comandos do `nano`:

```text
Ctrl + O      salvar
Enter         confirmar nome do arquivo ao salvar
Ctrl + X      sair/fechar
Ctrl + K      cortar linha
Ctrl + U      colar linha cortada
Ctrl + W      buscar texto
Ctrl + \      substituir texto
Alt + A       iniciar seleção
Setas         selecionar texto após Alt+A
Alt + 6       copiar seleção
Ctrl + U      colar seleção
Ctrl + C      mostrar posição do cursor
```

### 4.3 Abrir e Editar com Vim

Abrir arquivo:

```bash
vim /root/PontoWebDesk/backend/.env
vim /root/PontoWebDesk/backend/src/app.ts
```

Comandos do `vim`:

```text
i        modo inserir
Esc      sair do modo inserir
:w       salvar
:q       sair/fechar
:wq      salvar e sair
:q!      sair sem salvar
/texto   buscar texto
n        próxima ocorrência
N        ocorrência anterior
gg       início do arquivo
G        fim do arquivo
dd       cortar linha
yy       copiar linha
p        colar
v        iniciar seleção visual
y        copiar seleção visual
d        cortar seleção visual
u        desfazer
Ctrl+r   refazer
```

### 4.4 Copiar e Colar no Terminal SSH

No Windows Terminal / PowerShell:

```text
Selecionar texto com mouse = copia visualmente em muitos terminais
Ctrl + Shift + C = copiar
Ctrl + Shift + V = colar
Botão direito = colar, dependendo do terminal
Shift + Insert = colar
```

No Linux sem interface gráfica, use arquivos temporários:

```bash
echo "texto" > /tmp/arquivo.txt
cat /tmp/arquivo.txt
```

Copiar arquivo local para VPS:

```powershell
scp "D:\PontoWebDesk\supabase\migrations\ARQUIVO.sql" root@srv1694106:/root/PontoWebDesk/supabase/migrations/
```

Copiar arquivo da VPS para o Windows:

```powershell
scp root@srv1694106:/root/PontoWebDesk/backend/.env "D:\backup-env-vps.txt"
```

## 5. Git na VPS

Entrar no projeto:

```bash
cd /root/PontoWebDesk
```

Ver branch e alterações:

```bash
git status
git branch --show-current
git log --oneline -10
git diff --stat
git diff
```

Atualizar código:

```bash
git pull
```

Se houver alterações locais que impedem o pull, guardar temporariamente:

```bash
git stash push -m "backup-local-vps-$(date +%F-%H%M)"
git pull
git stash list
```

Restaurar stash, se necessário:

```bash
git stash pop
```

Ver arquivos modificados:

```bash
git status --short
git diff --name-only
```

## 6. Node, Dependências e Build

Instalar dependências da raiz:

```bash
cd /root/PontoWebDesk
npm ci
```

Build frontend:

```bash
cd /root/PontoWebDesk
npm run build
```

Instalar dependências do backend:

```bash
cd /root/PontoWebDesk/backend
npm ci
```

Build backend:

```bash
cd /root/PontoWebDesk/backend
npm run build
```

Ver scripts disponíveis:

```bash
cd /root/PontoWebDesk
npm run

cd /root/PontoWebDesk/backend
npm run
```

Não rode automaticamente:

```bash
npm audit fix --force
```

Use `--force` somente com planejamento, pois pode quebrar versões.

## 7. PM2 - Abrir, Fechar, Reiniciar e Logs da API

Listar serviços:

```bash
pm2 list
```

Ver detalhes da API:

```bash
pm2 describe pontoweb-api
```

Reiniciar API:

```bash
pm2 restart pontoweb-api
pm2 restart pontoweb-api --update-env
```

Reiniciar tudo:

```bash
pm2 restart all
```

Parar API:

```bash
pm2 stop pontoweb-api
```

Iniciar API parada:

```bash
pm2 start pontoweb-api
```

Remover processo do PM2:

```bash
pm2 delete pontoweb-api
```

Salvar lista atual do PM2:

```bash
pm2 save
```

Logs ao vivo:

```bash
pm2 logs pontoweb-api
pm2 logs pontoweb-api --lines 100
```

Limpar logs:

```bash
pm2 flush
```

Monitor:

```bash
pm2 monit
```

## 8. Nginx e Portas

Testar configuração Nginx:

```bash
nginx -t
```

Recarregar Nginx:

```bash
systemctl reload nginx
```

Reiniciar Nginx:

```bash
systemctl restart nginx
```

Status do Nginx:

```bash
systemctl status nginx
```

Logs do Nginx:

```bash
journalctl -u nginx -n 100 --no-pager
tail -100 /var/log/nginx/error.log
tail -100 /var/log/nginx/access.log
```

Ver portas abertas:

```bash
ss -tulpn
ss -tulpn | grep node
ss -tulpn | grep postgres
```

Testar API local:

```bash
curl -i http://localhost:3000
curl -i http://localhost:3000/api/health
```

## 9. Banco de Dados - Entrar no PostgreSQL

Exportar URL do banco:

```bash
export DATABASE_URL='postgresql://admin:<SENHA_URL_ENCODED>@localhost:5432/pontowebdesk'
```

Testar conexão:

```bash
psql "$DATABASE_URL" -c "select current_user, current_database();"
```

Entrar no console `psql`:

```bash
psql "$DATABASE_URL"
```

Sair do `psql`:

```text
\q
```

Comandos úteis dentro do `psql`:

```text
\l                         listar bancos
\c pontowebdesk            conectar em um banco
\dn                        listar schemas
\dt public.*               listar tabelas públicas
\d public.users            descrever tabela users
\d public.employees        descrever tabela employees
\d+ public.time_records    descrever tabela com detalhes
\df public.*               listar funções públicas
\df+ public.nome_funcao    detalhes de uma função
\du                        listar usuários/roles
\x                         alternar modo expandido
\timing                    ligar/desligar tempo das queries
\pset pager off            desligar pager
\i caminho/arquivo.sql     executar arquivo SQL dentro do psql
\o /tmp/saida.txt          enviar saída para arquivo
\o                         voltar saída para terminal
```

Executar SQL direto sem entrar no console:

```bash
psql "$DATABASE_URL" -c "select now();"
```

Executar arquivo SQL:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f /root/PontoWebDesk/supabase/migrations/ARQUIVO.sql
```

## 10. Consultar Tabelas do Banco

Listar tabelas:

```bash
psql "$DATABASE_URL" -c "\dt public.*"
```

Abrir estrutura de uma tabela:

```bash
psql "$DATABASE_URL" -c "\d public.users"
psql "$DATABASE_URL" -c "\d public.employees"
psql "$DATABASE_URL" -c "\d public.time_records"
psql "$DATABASE_URL" -c "\d public.punches"
psql "$DATABASE_URL" -c "\d public.work_shifts"
psql "$DATABASE_URL" -c "\d public.schedules"
psql "$DATABASE_URL" -c "\d public.employee_shift_schedule"
```

Contar registros:

```bash
psql "$DATABASE_URL" -c "select count(*) from public.users;"
psql "$DATABASE_URL" -c "select count(*) from public.employees;"
psql "$DATABASE_URL" -c "select count(*) from public.time_records;"
psql "$DATABASE_URL" -c "select count(*) from public.punches;"
```

Ver últimos registros de ponto:

```bash
psql "$DATABASE_URL" -c "
select id, user_id, company_id, type, timestamp, source, created_at
from public.time_records
order by coalesce(timestamp, created_at) desc
limit 20;
"
```

Ver últimos punches:

```bash
psql "$DATABASE_URL" -c "
select id, employee_id, company_id, type, created_at, sent_at, error_count
from public.punches
order by created_at desc
limit 20;
"
```

Ver funcionários com horário/escala:

```bash
psql "$DATABASE_URL" -c "
select id, nome, company_id, schedule_id, shift_id
from public.employees
order by nome
limit 50;
"
```

Ver usuários com horário/escala:

```bash
psql "$DATABASE_URL" -c "
select id, nome, company_id, schedule_id, shift_id
from public.users
order by nome
limit 50;
"
```

Ver horários cadastrados:

```bash
psql "$DATABASE_URL" -c "
select id, company_id, name, description, start_time, end_time, ativo
from public.work_shifts
order by name
limit 100;
"
```

Ver escalas cadastradas:

```bash
psql "$DATABASE_URL" -c "
select id, company_id, name, shift_id
from public.schedules
order by name
limit 100;
"
```

## 11. Migrations - Listar, Aplicar, Registrar e Validar

Entrar na raiz:

```bash
cd /root/PontoWebDesk
```

Listar migrations no código:

```bash
ls -1 supabase/migrations
ls -1 supabase/migrations | tail -30
```

Ver histórico no banco:

```bash
psql "$DATABASE_URL" -c "\dt *.*migration*"
psql "$DATABASE_URL" -c "select * from public._schema_migrations order by applied_at desc limit 50;"
```

Consultar migration específica:

```bash
psql "$DATABASE_URL" -c "
select *
from public._schema_migrations
where name like '%20260601100000%'
   or name like '%20260601110500%'
order by name;
"
```

Aplicar migration específica:

```bash
cd /root/PontoWebDesk
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260601100000_punches_promote_to_time_records.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260601110500_employee_schedule_shift_links.sql
```

Registrar migration aplicada manualmente:

```bash
psql "$DATABASE_URL" -c "
insert into public._schema_migrations (name, applied_at)
values
  ('supabase/20260601100000_punches_promote_to_time_records.sql', now()),
  ('supabase/20260601110500_employee_schedule_shift_links.sql', now())
on conflict do nothing;
"
```

Validar migrations pelo projeto:

```bash
cd /root/PontoWebDesk
npm run validate:migrations
```

Rodar script de migration do backend, se disponível:

```bash
cd /root/PontoWebDesk/backend
npm run db:migrate
```

Se o script não existir:

```bash
cd /root/PontoWebDesk/backend
npm run
```

## 12. Validações Específicas das Correções Recentes

Confirmar funções criadas:

```bash
psql "$DATABASE_URL" -c "
select proname
from pg_proc
where pronamespace = 'public'::regnamespace
  and proname in (
    'promote_punch_to_time_record',
    'backfill_punches_to_time_records',
    'validate_employee_schedule_shift_links',
    'sync_employee_schedule_shift_to_user'
  )
order by proname;
"
```

Confirmar colunas `schedule_id` e `shift_id`:

```bash
psql "$DATABASE_URL" -c "
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('users','employees')
  and column_name in ('schedule_id','shift_id')
order by table_name, column_name;
"
```

Rodar backfill de punches para time_records:

```bash
psql "$DATABASE_URL" -c "select * from public.backfill_punches_to_time_records(5000);"
```

Ver punches pendentes:

```bash
psql "$DATABASE_URL" -c "
select id, employee_id, company_id, type, created_at, sent_at, error_count
from public.punches
where sent_at is null
order by created_at asc
limit 50;
"
```

Ver status de promoção:

```bash
psql "$DATABASE_URL" -c "
select raw_data->'promotion'->>'status' as status, count(*)
from public.punches
where sent_at is not null
group by 1
order by 2 desc;
"
```

## 13. Backup e Restore do Banco

Backup formato custom:

```bash
pg_dump "$DATABASE_URL" --format=custom --file "$HOME/pontowebdesk-backup-$(date +%F-%H%M).dump"
```

Backup SQL texto:

```bash
pg_dump "$DATABASE_URL" --file "$HOME/pontowebdesk-backup-$(date +%F-%H%M).sql"
```

Ver tamanho dos backups:

```bash
ls -lh ~/*.dump
ls -lh ~/*.sql
```

Listar conteúdo de backup custom:

```bash
pg_restore --list "$HOME/ARQUIVO.dump" | head -50
```

Restore custom em banco vazio:

```bash
pg_restore --dbname "$DATABASE_URL" --clean --if-exists "$HOME/ARQUIVO.dump"
```

Restore SQL:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$HOME/ARQUIVO.sql"
```

## 14. Logs e Diagnóstico da API

Logs PM2:

```bash
pm2 logs pontoweb-api --lines 200
```

Arquivos de log PM2:

```bash
ls -lah /root/.pm2/logs
tail -200 /root/.pm2/logs/pontoweb-api-out.log
tail -200 /root/.pm2/logs/pontoweb-api-error.log
tail -f /root/.pm2/logs/pontoweb-api-error.log
```

Ver processos Node:

```bash
ps aux | grep node
```

Ver uso de disco:

```bash
df -h
du -sh /root/PontoWebDesk
du -sh /root/.pm2/logs
```

Ver memória:

```bash
free -h
```

## 15. Editar Variáveis de Ambiente

Abrir `.env` global:

```bash
nano /root/.env
```

Abrir `.env` do backend:

```bash
nano /root/PontoWebDesk/backend/.env
```

Carregar variáveis no shell atual:

```bash
set -a
source /root/.env
set +a
```

Carregar variáveis do backend:

```bash
set -a
source /root/PontoWebDesk/backend/.env
set +a
```

Ver se uma variável existe:

```bash
echo "$DATABASE_URL"
printenv | grep DATABASE
```

Reiniciar API usando ambiente atualizado:

```bash
pm2 restart pontoweb-api --update-env
```

## 16. Comandos de Homologação Rápida

Após deploy/migration:

```bash
cd /root/PontoWebDesk
git status

cd /root/PontoWebDesk/backend
npm ci
npm run build

pm2 restart pontoweb-api --update-env
pm2 list
pm2 logs pontoweb-api --lines 50
```

Validar banco:

```bash
export DATABASE_URL='postgresql://admin:<SENHA_URL_ENCODED>@localhost:5432/pontowebdesk'

psql "$DATABASE_URL" -c "select current_user, current_database();"

psql "$DATABASE_URL" -c "
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('users','employees')
  and column_name in ('schedule_id','shift_id')
order by table_name, column_name;
"
```

Validar espelho:

```bash
psql "$DATABASE_URL" -c "
select id, user_id, company_id, type, timestamp, source, created_at
from public.time_records
order by coalesce(timestamp, created_at) desc
limit 20;
"
```

Validar horários:

```bash
psql "$DATABASE_URL" -c "
select id, company_id, name, description, start_time, end_time
from public.work_shifts
order by name
limit 50;
"
```

## 17. Checklist de Segurança

Antes de executar comandos destrutivos:

```bash
pwd
git status
pg_dump "$DATABASE_URL" --format=custom --file "$HOME/backup-antes-alteracao-$(date +%F-%H%M).dump"
```

Evite em produção sem plano:

```bash
rm -rf
git reset --hard
npm audit fix --force
DROP DATABASE
DROP TABLE
TRUNCATE
DELETE FROM tabela_sem_where
UPDATE tabela_sem_where
```

Antes de `DELETE` ou `UPDATE`, sempre rode um `SELECT` com o mesmo `WHERE`:

```bash
psql "$DATABASE_URL" -c "
select *
from public.NOME_DA_TABELA
where CONDICAO
limit 20;
"
```

## 18. Modelos Prontos

Entrar na VPS e atualizar tudo:

```bash
ssh root@srv1694106
cd /root/PontoWebDesk
git pull
cd backend
npm ci
npm run build
pm2 restart pontoweb-api --update-env
```

Aplicar migration nova:

```bash
ssh root@srv1694106
cd /root/PontoWebDesk
export DATABASE_URL='postgresql://admin:<SENHA_URL_ENCODED>@localhost:5432/pontowebdesk'
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/NOME_DA_MIGRATION.sql
```

Consultar uma tabela:

```bash
ssh root@srv1694106
export DATABASE_URL='postgresql://admin:<SENHA_URL_ENCODED>@localhost:5432/pontowebdesk'
psql "$DATABASE_URL" -c "select * from public.NOME_DA_TABELA limit 20;"
```

Abrir e salvar arquivo com nano:

```bash
ssh root@srv1694106
nano /root/PontoWebDesk/CAMINHO/DO/ARQUIVO
```

Dentro do nano:

```text
Ctrl+O
Enter
Ctrl+X
```

