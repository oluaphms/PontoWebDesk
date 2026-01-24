# Notificações – SmartPonto

## Lembretes locais (implementado)

O app usa **lembretes por notificação local** (sem servidor):

- Horários padrão: **08:00**, **12:00**, **18:00** (configurável via `pushReminderService`).
- Pedido de permissão ao usuário (preferência "notificações" ativa).
- Se o usuário permitir, checagem a cada 1 min; se estiver na janela do horário, exibe *"Hora de bater o ponto!"*.

Config e horários: `services/pushReminderService.ts` (`getReminderConfig`, `setReminderConfig`).

---

## Web Push (servidor) – futuro

Para **push enviado pelo servidor** (ex.: lembrete mesmo com o app fechado):

1. **VAPID**: gerar par de chaves (ex. `npx web-push generate-vapid-keys`).
2. **Backend**: endpoint que recebe assinaturas (subscription) e envia pushes com `web-push`.
3. **Frontend**: depois de `Notification.requestPermission()`, `registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` e enviar a subscription ao backend.
4. O **Service Worker** (`public/sw.js`) já trata `push` e `notificationclick`; basta o backend enviar no formato esperado.

Exemplo de payload para o SW:

```json
{ "title": "SmartPonto", "body": "Hora de bater o ponto!", "url": "/" }
```

---

## Referências

- [Web Push API](https://developer.mozilla.org/en-US/docs/Web/API/Push_API)
- [web-push (Node)](https://www.npmjs.com/package/web-push)
