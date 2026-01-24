# 🔥 Como Configurar o Firebase

## ⚠️ Erro Atual
Você está recebendo o erro: `Firebase: Error (auth/invalid-api-key)`

Isso acontece porque as credenciais do Firebase não estão configuradas no arquivo `.env.local`.

## 📋 Passo a Passo

### 1. Obter Credenciais do Firebase

1. Acesse o [Firebase Console](https://console.firebase.google.com/)
2. Selecione seu projeto (ou crie um novo)
3. Clique no ícone de **⚙️ Configurações do Projeto** (Settings)
4. Role até a seção **"Seus apps"** (Your apps)
5. Se não tiver um app web, clique em **"Adicionar app"** > **"Web"** (ícone `</>`)
6. Copie as credenciais que aparecem

### 2. Configurar o Arquivo .env.local

Abra o arquivo `.env.local` na raiz do projeto e substitua os valores:

```env
# Firebase Configuration
VITE_FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
VITE_FIREBASE_AUTH_DOMAIN=seu-projeto.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=seu-projeto-id
VITE_FIREBASE_STORAGE_BUCKET=seu-projeto.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
VITE_FIREBASE_APP_ID=1:123456789012:web:abcdef123456
```

### 3. Exemplo de Como Ficaria

```env
VITE_FIREBASE_API_KEY=AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz1234567
VITE_FIREBASE_AUTH_DOMAIN=meu-ponto-eletronico.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=meu-ponto-eletronico
VITE_FIREBASE_STORAGE_BUCKET=meu-ponto-eletronico.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=987654321098
VITE_FIREBASE_APP_ID=1:987654321098:web:fedcba654321
```

### 4. Reiniciar o Servidor

Após configurar o `.env.local`:

1. **Pare o servidor** (Ctrl+C no terminal)
2. **Reinicie** com `npm run dev`

## 🔒 Segurança

⚠️ **IMPORTANTE:**
- **NUNCA** commite o arquivo `.env.local` no Git
- O arquivo já está no `.gitignore`
- Mantenha suas credenciais seguras

## 🧪 Testar a Configuração

Após configurar, você deve ver:
- ✅ O app carrega sem erros de Firebase
- ✅ A tela de login aparece
- ✅ É possível criar conta/fazer login

## 🆘 Se Ainda Tiver Problemas

1. Verifique se todas as variáveis começam com `VITE_`
2. Verifique se não há espaços extras nas variáveis
3. Certifique-se de que reiniciou o servidor após alterar o `.env.local`
4. Verifique no console do navegador se as variáveis estão sendo carregadas

## 📚 Recursos

- [Documentação do Firebase](https://firebase.google.com/docs)
- [Firebase Console](https://console.firebase.google.com/)
