# Porta fixa e diagnóstico (dev)

O servidor de desenvolvimento está configurado para usar **sempre a porta 3010**. Se a porta estiver ocupada, o `npm run dev` falha em vez de abrir outra porta (evitando problemas de login com Supabase ao trocar de porta).

## Verificar se a porta 3010 está em uso

**PowerShell:**

```powershell
netstat -ano | findstr :3010
```

**Ver processos Node ativos:**

```powershell
Get-Process node -ErrorAction SilentlyContinue
```

## Encerrar processos que ocupam a porta

1. Liste o PID que está usando a porta 3010 (última coluna do `netstat`):
   ```powershell
   netstat -ano | findstr :3010
   ```

2. Encerre o processo (substitua `PID` pelo número):
   ```powershell
   Stop-Process -Id PID -Force
   ```

**Encerrar todos os processos Node (cuidado: fecha qualquer app Node em execução):**

```powershell
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force
```

Depois rode `npm run dev` novamente. O app deve subir em `http://localhost:3010`.

## Variável de ambiente recomendada

No `.env.local`, defina a URL fixa do app em desenvolvimento para auth e redirects:

```
VITE_APP_URL=http://localhost:3010
```

Assim, mesmo que algo use a URL do app (ex.: recuperação de senha, OAuth), o valor será sempre `http://localhost:3010`.
