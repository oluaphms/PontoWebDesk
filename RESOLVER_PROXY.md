# 🔧 Resolução: Problema de Proxy/Rede

## Problema Identificado

O erro `tunneling socket could not be established, cause=connect ECONNREFUSED 127.0.0.1:9` indica um problema de configuração de proxy.

## ✅ Soluções

### Opção 1: Desabilitar Proxy (Se não precisar)

```powershell
# Verificar configuração atual
npm config get proxy
npm config get https-proxy

# Remover proxy se configurado incorretamente
npm config delete proxy
npm config delete https-proxy

# Para Yarn
yarn config delete proxy
yarn config delete https-proxy
```

### Opção 2: Configurar Proxy Corretamente (Se precisar)

Se você usa proxy corporativo:

```powershell
# Substitua pelos valores corretos do seu proxy
npm config set proxy http://proxy.empresa.com:8080
npm config set https-proxy http://proxy.empresa.com:8080

# Para Yarn
yarn config set proxy http://proxy.empresa.com:8080
yarn config set https-proxy http://proxy.empresa.com:8080
```

### Opção 3: Usar Registry Diferente

```powershell
# Usar registry do npm diretamente
npm config set registry https://registry.npmjs.org/

# Para Yarn
yarn config set registry https://registry.npmjs.org/
```

### Opção 4: Verificar Variáveis de Ambiente

```powershell
# Verificar variáveis de ambiente de proxy
$env:HTTP_PROXY
$env:HTTPS_PROXY
$env:NO_PROXY

# Se estiverem configuradas incorretamente, remova:
Remove-Item Env:HTTP_PROXY -ErrorAction SilentlyContinue
Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
```

## 🚀 Tentar Instalação Novamente

Após corrigir o proxy:

```powershell
cd "d:\APP Smartponto"

# Com npm
npm install --legacy-peer-deps

# OU com Yarn
yarn install
```

## 📝 Nota

O nome do pacote no `package.json` já foi corrigido de:
- `chronos-premium---ponto-eletrônico` ❌
- Para: `chronos-premium-ponto-eletronico` ✅

Isso resolve o erro "Name contains illegal characters".
