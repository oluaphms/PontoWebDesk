# 📤 Como Enviar o Projeto para o GitHub

## ⚠️ Problema de Permissão

Se você encontrar erros de permissão do Git, siga estas instruções:

## 🔧 Solução 1: Executar o Script (Recomendado)

1. **Abra o PowerShell como Administrador**
   - Clique com botão direito no PowerShell
   - Selecione "Executar como administrador"

2. **Navegue até o projeto:**
   ```powershell
   cd "d:\APP Smartponto"
   ```

3. **Execute o script:**
   ```powershell
   .\enviar-para-github.ps1
   ```

## 🔧 Solução 2: Comandos Manuais

Se o script não funcionar, execute os comandos manualmente:

```powershell
# 1. Configurar diretório seguro
git config --global --add safe.directory "D:/APP Smartponto"

# 2. Remover .git se existir
Remove-Item ".git" -Recurse -Force -ErrorAction SilentlyContinue

# 3. Inicializar repositório
git init

# 4. Configurar usuário
git config user.name "Paulo Henrique"
git config user.email "oluaphms@users.noreply.github.com"

# 5. Adicionar remote
git remote add origin https://github.com/oluaphms/APP-Smartponto.git

# 6. Adicionar arquivos
git add .

# 7. Fazer commit
git commit -m "Initial commit: SmartaPonto - Sistema de Ponto Eletrônico"

# 8. Renomear branch
git branch -M main

# 9. Enviar para GitHub
git push -u origin main
```

## 🔐 Autenticação no GitHub

Se você receber erro de autenticação, você tem 3 opções:

### Opção 1: Personal Access Token (Recomendado)

1. Acesse: https://github.com/settings/tokens
2. Clique em "Generate new token (classic)"
3. Dê um nome (ex: "SmartaPonto")
4. Selecione o escopo `repo`
5. Clique em "Generate token"
6. Copie o token
7. Quando o Git pedir senha, use o token ao invés da senha

### Opção 2: GitHub CLI

```powershell
# Instalar GitHub CLI (se não tiver)
winget install GitHub.cli

# Fazer login
gh auth login

# Depois fazer push normalmente
git push -u origin main
```

### Opção 3: SSH Keys

1. Gerar chave SSH:
   ```powershell
   ssh-keygen -t ed25519 -C "oluaphms@users.noreply.github.com"
   ```

2. Adicionar chave ao GitHub:
   - Copie o conteúdo de `~/.ssh/id_ed25519.pub`
   - Vá em: https://github.com/settings/keys
   - Clique em "New SSH key"
   - Cole a chave

3. Alterar remote para SSH:
   ```powershell
   git remote set-url origin git@github.com:oluaphms/APP-Smartponto.git
   git push -u origin main
   ```

## ✅ Verificação

Após o push bem-sucedido, verifique:

1. Acesse: https://github.com/oluaphms/APP-Smartponto
2. Você deve ver todos os arquivos do projeto
3. O README.md deve estar visível

## 📝 Arquivos que NÃO serão enviados

O arquivo `.gitignore` garante que os seguintes arquivos NÃO sejam enviados:

- `node_modules/` - Dependências (instale com `npm install`)
- `.env.local` - Variáveis de ambiente sensíveis
- `dist/` - Build de produção
- Arquivos de cache e logs

## 🆘 Problemas Comuns

### Erro: "dubious ownership"
```powershell
git config --global --add safe.directory "D:/APP Smartponto"
```

### Erro: "Permission denied"
- Execute o PowerShell como Administrador
- Ou mova o projeto para uma pasta do usuário (ex: `C:\Users\...`)

### Erro: "Authentication failed"
- Use Personal Access Token ao invés de senha
- Ou configure SSH keys

### Erro: "remote origin already exists"
```powershell
git remote remove origin
git remote add origin https://github.com/oluaphms/APP-Smartponto.git
```
