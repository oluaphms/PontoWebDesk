$body = @'
{
  "action": "create-user",
  "email": "teste.script@pontowebdesk.local",
  "password": "123456",
  "metadata": {
    "nome": "Teste Script",
    "cpf": "90000000002",
    "company_id": "a145b0cd-76f4-4dc8-b50c-02b0c9bfe24b"
  }
}
'@

$body | Set-Content -Encoding utf8 body.json

Invoke-WebRequest `
  -Method POST `
  -Uri "https://pontowebdesk.vercel.app/api/auth/admin" `
  -ContentType "application/json" `
  -InFile "body.json" |
  Select-Object -ExpandProperty Content
