# 🚨 Resolução: Problema de Cache do npm

## Problema Identificado

O npm está configurado para usar apenas cache (`cache mode is 'only-if-cached'`), o que impede a instalação de novos pacotes.

## ✅ Solução Rápida

### Opção 1: Limpar configuração de cache (Recomendado)

Execute no PowerShell:

```powershell
cd "d:\APP Smartponto"

# Remover configuração de cache problemática
Remove-Item .npmrc -ErrorAction SilentlyContinue

# Limpar cache do npm
npm cache clean --force

# Reinstalar tudo
npm install --legacy-peer-deps
```

### Opção 2: Verificar configuração global do npm

O problema pode estar na configuração global do npm. Verifique:

```powershell
npm config get cache
npm config list
```

Se houver `cache=` ou `only-if-cached` configurado, remova:

```powershell
npm config delete cache
npm config delete prefer-offline
npm config delete only
```

### Opção 3: Usar Yarn (Alternativa)

Se o npm continuar com problemas:

```powershell
# Instalar Yarn
npm install -g yarn

# Remover node_modules
Remove-Item -Recurse -Force node_modules

# Instalar com Yarn
yarn install
```

### Opção 4: Reinstalar npm (Último recurso)

```powershell
# Reinstalar npm globalmente
npm install -g npm@latest

# Limpar cache
npm cache clean --force

# Tentar novamente
cd "d:\APP Smartponto"
npm install --legacy-peer-deps
```

## 🔍 Verificação

Após aplicar a solução, verifique:

```powershell
# Verificar se Vite está instalado
Test-Path "node_modules\vite"

# Listar pacotes instalados
npm list vite --depth=0
npm list @vitejs/plugin-react --depth=0

# Testar execução
npm run dev
```

## 📝 Nota

O arquivo `.npmrc` foi simplificado para conter apenas:
```
legacy-peer-deps=true
```

Se você precisar de outras configurações, adicione-as ao arquivo, mas **não** inclua `cache=` vazio, pois isso causa o problema.

## 🆘 Se Nada Funcionar

1. **Verifique permissões**: Execute PowerShell como Administrador
2. **Verifique antivírus**: Pode estar bloqueando downloads
3. **Verifique proxy/firewall**: Pode estar bloqueando conexões npm
4. **Use npx diretamente**: `npx vite` (instala temporariamente se necessário)

---

**Execute a Opção 1 primeiro - geralmente resolve o problema!**
