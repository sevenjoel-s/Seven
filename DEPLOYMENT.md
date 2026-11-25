# 7Sunday Ethiopia — Production Deployment Guide (Render & Firebase)

## Architecture Overview
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS v4 + PWA service worker (`dist/`).
- **Backend & Signaling Server**: Express + Node `http` + WebSocket server (`/ws`) in `server.ts` serving API endpoints, uploaded media, WebRTC signaling, and the built SPA.
- **Database & Auth**: Firebase Authentication (Google + Email/Password with email verification) and Cloud Firestore (`firestore.rules` + `firebase-blueprint.json`).

---

## 1. Environment Variables
Configure the following in Render Dashboard → **Environment**:

| Variable | Required | Description |
| --- | --- | --- |
| `NODE_ENV` | Yes | Set to `production` |
| `PORT` | Auto (Render) | Injected automatically by Render (`server.ts` binds `0.0.0.0:$PORT`) |
| `APP_URL` | Yes | Your live Render URL, e.g. `https://sevensunday-connect.onrender.com` |
| `UPLOAD_DIR` | Recommended | Mount a Render Persistent Disk at `/var/data/uploads` and set `UPLOAD_DIR=/var/data/uploads` so uploaded product photos and chat attachments persist across deploys |
| `STUN_URLS` | Optional | Defaults to `stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302` |
| `TURN_URL` | Recommended | Relay URL (e.g. `turn:global.relay.metered.ca:80,turns:global.relay.metered.ca:443`) for reliable audio/video across strict mobile/corporate NATs |
| `TURN_USERNAME` | If TURN set | TURN server username |
| `TURN_CREDENTIAL` | If TURN set | TURN server credential/password |
| `TELEGRAM_BOT_TOKEN` | Optional | Real meeting invitation delivery via Telegram |
| `WHATSAPP_ACCESS_TOKEN` | Optional | WhatsApp Cloud API delivery |
| `WHATSAPP_PHONE_NUMBER_ID` | Optional | WhatsApp sender ID |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` | Optional | SMS meeting invitations |
| `SMTP_WEBHOOK_URL` | Optional | Server email webhook |

---

## 2. Render Web Service Setup
1. **Service Type**: Web Service (Node.js 20+)
2. **Build Command**:
   ```bash
   npm install && npm run build
   ```
3. **Start Command**:
   ```bash
   npm start
   ```
4. **Health Check Path**: `/api/health`
5. **Persistent Disk**: Attach a disk (e.g., 5 GB) mounted at `/var/data/uploads` and set `UPLOAD_DIR=/var/data/uploads`.
6. **WebSockets**: Render supports `wss://` on standard Web Services automatically via `/ws`.

---

## 3. Firebase Setup & Security Rules
1. Ensure `firebase-applet-config.json` contains your project's public Firebase Web config (`projectId`, `apiKey`, `authDomain`, `firestoreDatabaseId`).
2. Add your Render domain (`*.onrender.com` or custom domain) to **Firebase Console → Authentication → Settings → Authorized domains**.
3. Deploy `firestore.rules` cleanly:
   ```bash
   npx eslint firestore.rules
   firebase deploy --only firestore:rules
   ```
4. Optional data backfill / support routing sync (with `GOOGLE_APPLICATION_CREDENTIALS` set):
   ```bash
   npx tsx scripts/migrate-firestore.ts
   ```
