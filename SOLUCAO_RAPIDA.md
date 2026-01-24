# 🚀 Solução Rápida para Instalar Dependências

## ⚠️ PROBLEMA PRINCIPAL
Você tem `NPM_CONFIG_OFFLINE=true` configurado como variável de ambiente do sistema, o que impede o npm de baixar pacotes.

## ✅ SOLUÇÃO DEFINITIVA (Faça isso PRIMEIRO)

### Passo 1: Remover a Variável de Ambiente

**Opção A - Via Interface Gráfica (Mais Fácil):**
1. Pressione `Win + R`
2. Digite: `sysdm.cpl` e pressione Enter
3. Clique na aba "Avançado"
4. Clique em "Variáveis de Ambiente"
5. Em "Variáveis do usuário", procure por `NPM_CONFIG_OFFLINE`
6. Se encontrar, selecione e clique em "Excluir"
7. Clique em "OK" em todas as janelas
8. **FECHE TODOS OS TERMINAIS/POWERSHELL**
9. Abra um NOVO PowerShell
10. Execute: `npm install`

**Opção B - Via PowerShell (Como Administrador):**
```powershell
# Abra PowerShell como Administrador e execute:
[System.Environment]::SetEnvironmentVariable("NPM_CONFIG_OFFLINE", $null, "User")
```

Depois disso, **FECHE e REABRA o PowerShell** antes de continuar.

### Passo 2: Verificar se Funcionou
```powershell
npm config get offline
# Deve retornar: false (não true)
```

### Passo 3: Instalar Dependências
```powershell
cd "d:\APP Smartponto"
npm install
```

## 🔄 SOLUÇÃO ALTERNATIVA: Usar pnpm ou Yarn

Se o npm continuar com problemas, use outro gerenciador de pacotes:

### Opção 1: Usar pnpm
```powershell
# Instalar pnpm globalmente (se npm funcionar para isso)
npm install -g pnpm

# Ou baixar diretamente:
iwr https://get.pnpm.io/install.ps1 -useb | iex

# Depois instalar dependências
cd "d:\APP Smartponto"
pnpm install
pnpm run dev
```

### Opção 2: Usar Yarn
```powershell
# Instalar yarn globalmente
npm install -g yarn

# Instalar dependências
cd "d:\APP Smartponto"
yarn install
yarn dev
```

## 🛠️ Se Tiver Erros de Permissão

Se você receber erros `EPERM`, tente:

1. **Executar PowerShell como Administrador**
2. **Ou mudar o cache do npm:**
```powershell
npm config set cache "D:\npm-cache" --global
npm install
```

## 📝 Resumo dos Comandos

Depois de remover `NPM_CONFIG_OFFLINE`:

```powershell
# 1. Fechar e reabrir PowerShell
# 2. Navegar para o projeto
cd "d:\APP Smartponto"

# 3. Limpar instalações anteriores (opcional)
Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "package-lock.json" -Force -ErrorAction SilentlyContinue

# 4. Instalar
npm install

# 5. Verificar se vite foi instalado
Test-Path "node_modules\vite"

# 6. Executar o projeto
npm run dev
```
