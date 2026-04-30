# 🎤 Voice Assistant — Claude + Fastify + Expo

Głosowy asystent AI na Androida. Mówisz po polsku → Claude interpretuje intencję → backend wykonuje akcje (Trello, Gmail, Calendar).

## Architektura

```
📱 Android (Expo/RN)                    🖥️ EC2 (Fastify + PM2)
┌──────────────────────┐                ┌──────────────────────────┐
│                      │                │                          │
│  Android STT (free)  │   POST /api/   │  Claude API (Sonnet)     │
│  ───────────────────>│───── voice ───>│  ↓ JSON { action, params}│
│                      │                │  ↓                       │
│  Android TTS (free)  │<── response ──│  Executor:               │
│  <───────────────────│                │    ├─ Trello API         │
│                      │                │    ├─ Gmail API          │
│  Przycisk + Log UI   │                │    ├─ Calendar API       │
│                      │                │    └─ Notes (filesystem) │
└──────────────────────┘                └──────────────────────────┘
```

## Koszt

| Komponent         | Koszt              |
| ----------------- | ------------------ |
| Android STT       | **0 zł** (natywny) |
| Android TTS       | **0 zł** (natywny) |
| Claude Sonnet API | ~$3/mln input tok  |
| Trello API        | **0 zł** (free)    |
| Gmail API         | **0 zł** (OAuth2)  |
| Calendar API      | **0 zł** (OAuth2)  |

Średni koszt per request: **~$0.002-0.005** (Claude Sonnet, ~500 tok in + 300 tok out)

## Setup: Backend

### 1. Deploy na EC2

```bash
# Na jednej z Twoich 4 instancji EC2
cd /home/ubuntu
git clone <repo> mobile-assistant
cd mobile-assistant/backend

npm install
cp .env.example .env
nano .env   # uzupełnij klucze
```

### 2. Konfiguracja .env

**Claude:** Klucz API z console.anthropic.com

**Trello:**

1. Wejdź na https://trello.com/power-ups/admin → wygeneruj API Key
2. Token: https://trello.com/1/authorize?key=TWOJ_KEY&scope=read,write&name=VoiceAssistant&expiration=never&response_type=token
3. Board ID: otwórz board → dodaj `.json` do URL → skopiuj `id`
4. List ID: w tym samym JSON znajdź `lists[].id`

**Google (Gmail + Calendar):**

1. Google Cloud Console → APIs → włącz Gmail API + Calendar API
2. Credentials → OAuth 2.0 → Desktop App
3. Uzyskaj refresh_token:

```bash
# Consent screen → scopes: gmail.send, gmail.compose, calendar.events
# OAuth Playground: https://developers.google.com/oauthplayground/
# Albo:
npx google-auth-library authorize \
  --client-id=XXX \
  --client-secret=XXX \
  --scopes=https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.compose,https://www.googleapis.com/auth/calendar.events
```

### 3. PM2

```bash
pm2 start src/server.js --name mobile-assistant
pm2 save
```

### 4. Nginx proxy (opcjonalnie)

```nginx
server {
    listen 443 ssl;
    server_name voice.torweb.pl;

    ssl_certificate /etc/letsencrypt/live/voice.torweb.pl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/voice.torweb.pl/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3500;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

## Setup: Mobile (Expo)

### 1. Instalacja

```bash
cd mobile-assistant/mobile
npm install
```

### 2. Konfiguracja API URL

Edytuj `src/services/api.ts`:

```typescript
const API_URL = __DEV__
  ? "http://TWOJE_IP_LAN:3500" // dev — IP Twojego PC w sieci
  : "https://voice.torweb.pl"; // prod
```

### 3. Development

```bash
npx expo start
# Zeskanuj QR kodem z Expo Go (bez dev build nie zadziała voice)
# Albo od razu:
npx expo run:android
```

### 4. Build

```bash
npx eas build --platform android --profile preview
# APK do zainstalowania na telefonie
```

**UWAGA:** `@react-native-voice/voice` wymaga dev build (nie Expo Go).
Musisz zrobić `npx expo run:android` lub `eas build`.

## Dodawanie nowych akcji

### 1. Napisz handler

```javascript
// backend/src/actions/slack.js
export async function slackSendMessage({ channel, text }) {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, text }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error);
  return { channel, sent: true };
}
```

### 2. Zarejestruj w executor.js

```javascript
import { slackSendMessage } from '../actions/slack.js';

// dodaj do ACTION_REGISTRY:
slack_send: {
  handler: slackSendMessage,
  description: 'Wyślij wiadomość na Slack',
  params: ['channel', 'text']
},
```

### 3. Dodaj do system prompt w claude.js

```
10. slack_send — wyślij wiadomość na Slack
    params: { channel: string, text: string }
```

Gotowe. Claude automatycznie zacznie rozpoznawać "napisz na Slacku...".

## Testowanie backendu bez telefonu

```bash
curl -X POST http://localhost:3500/api/voice \
  -H 'Content-Type: application/json' \
  -d '{"text": "utwórz kartę w trello: naprawić buga na stronie głównej"}'
```

## Rozszerzenia na przyszłość

- [ ] WebSocket zamiast REST (streaming odpowiedzi)
- [ ] Wake word ("Hej asystent") — `react-native-porcupine`
- [ ] Widget na ekran główny Androida
- [ ] Kontekst lokalizacji (GPS) do akcji
- [ ] Integracja z Notion, GitHub Issues
- [ ] Historia konwersacji w SQLite na telefonie
