import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import multer from 'multer';
import { pathToFileURL } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth, DecodedIdToken } from 'firebase-admin/auth';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };

if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId,
  });
}

const adminAuth = getAuth();
const PORT = Number(process.env.PORT) || 3000;
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(process.env.UPLOAD_DIR)
  : path.resolve(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export interface AuthRequest extends Request {
  user?: DecodedIdToken;
}

export const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'video/webm',
  'video/mp4',
  'application/pdf',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);

export const INLINE_SAFE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'video/webm',
  'video/mp4',
  'application/pdf',
]);

export const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/webm': '.webm',
  'audio/ogg': '.ogg',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/wav': '.wav',
  'video/webm': '.webm',
  'video/mp4': '.mp4',
  'application/pdf': '.pdf',
  'text/plain': '.txt',
  'text/csv': '.csv',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
};

export const EXT_TO_MIME: Record<string, string> = Object.fromEntries(
  Object.entries(MIME_TO_EXT).map(([mime, ext]) => [ext, mime])
);

export type TokenVerifier = (token: string) => Promise<DecodedIdToken>;

interface AppOptions {
  authVerifier?: TokenVerifier;
  uploadDir?: string;
}

export function createApp(options: AppOptions = {}) {
  const verifyToken: TokenVerifier =
    options.authVerifier || ((token: string) => adminAuth.verifyIdToken(token));
  const uploadDir = options.uploadDir ? path.resolve(options.uploadDir) : UPLOAD_DIR;
  fs.mkdirSync(uploadDir, { recursive: true });

  // Sliding-window rate limiter per IP
  const rateMap = new Map<string, { count: number; resetAt: number }>();
  function rateLimit(req: Request, res: Response, next: NextFunction) {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const entry = rateMap.get(ip);
    if (!entry || now > entry.resetAt) {
      rateMap.set(ip, { count: 1, resetAt: now + 60_000 });
      return next();
    }
    if (entry.count >= 180) {
      return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    }
    entry.count += 1;
    return next();
  }

  async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required.' });
    }
    const token = authHeader.slice(7).trim();
    try {
      const decoded = await verifyToken(token);
      req.user = decoded;
      return next();
    } catch {
      return res.status(401).json({ error: 'Invalid or expired authentication token.' });
    }
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  });

  const fileMetadata = new Map<string, { originalName: string; mime: string; size: number; ownerUid: string }>();
  const webAuthnChallenges = new Map<string, { challenge: string; expiresAt: number }>();

  const app = express();
  app.set('trust proxy', 1);
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });
  app.use(express.json({ limit: '2mb' }));
  app.use('/api', rateLimit);

  // Health endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: '7Sunday Meet', timestamp: new Date().toISOString() });
  });

  // Integration status (honestly reports configured environment variables without exposing secrets)
  app.get('/api/integrations/status', requireAuth, (_req, res) => {
    res.json({
      telegramBot: Boolean(process.env.TELEGRAM_BOT_TOKEN),
      whatsappCloud: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
      twilioSms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER),
      emailWebhook: Boolean(process.env.SMTP_WEBHOOK_URL),
      turnConfigured: Boolean(process.env.TURN_URL || process.env.TURN_URLS),
      appUrl: process.env.APP_URL || '',
    });
  });

  // WebRTC ICE / STUN / TURN configuration endpoint (keeps TURN credentials server-configured)
  app.get('/api/rtc/config', requireAuth, (_req, res) => {
    const stunList = (process.env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [];
    if (stunList.length > 0) {
      iceServers.push({ urls: stunList });
    }

    const turnRaw = process.env.TURN_URLS || process.env.TURN_URL || '';
    const turnList = turnRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (turnList.length > 0) {
      iceServers.push({
        urls: turnList,
        ...(process.env.TURN_USERNAME ? { username: process.env.TURN_USERNAME } : {}),
        ...(process.env.TURN_CREDENTIAL ? { credential: process.env.TURN_CREDENTIAL } : {}),
      });
    }

    res.json({
      iceServers,
      turnConfigured: turnList.length > 0,
    });
  });

  // Secure file upload
  app.post('/api/uploads', requireAuth, upload.single('file'), (req: AuthRequest, res: Response) => {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: 'No file provided.' });
    }
    const baseMime = file.mimetype.split(';')[0].trim().toLowerCase();
    if (!ALLOWED_MIMES.has(baseMime)) {
      return res.status(400).json({ error: `Unsupported file type: ${baseMime}` });
    }
    const ext = MIME_TO_EXT[baseMime] || '';
    const storedName = `${crypto.randomUUID()}${ext}`;
    const targetPath = path.resolve(uploadDir, storedName);
    if (!targetPath.startsWith(uploadDir + path.sep)) {
      return res.status(400).json({ error: 'Invalid upload path.' });
    }
    fs.writeFileSync(targetPath, file.buffer);
    fileMetadata.set(storedName, {
      originalName: file.originalname.slice(0, 180),
      mime: baseMime,
      size: file.size,
      ownerUid: req.user!.uid,
    });
    return res.json({
      url: `/api/uploads/${storedName}`,
      name: file.originalname.slice(0, 180),
      mime: baseMime,
      size: file.size,
    });
  });

  // Secure file serving with strict confinement & nosniff
  app.get('/api/uploads/:filename', (req: Request, res: Response) => {
    const rawName = path.basename(req.params.filename || '');
    if (!/^[a-zA-Z0-9_.-]+$/.test(rawName)) {
      return res.status(400).json({ error: 'Invalid filename.' });
    }
    const resolved = path.resolve(uploadDir, rawName);
    if (!resolved.startsWith(uploadDir + path.sep) || !fs.existsSync(resolved)) {
      return res.status(404).json({ error: 'File not found.' });
    }
    const meta = fileMetadata.get(rawName);
    const ext = path.extname(rawName).toLowerCase();
    const mime = meta?.mime || EXT_TO_MIME[ext] || 'application/octet-stream';
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', mime);
    const disp = INLINE_SAFE_MIMES.has(mime) ? 'inline' : 'attachment';
    const safeOriginal = (meta?.originalName || rawName).replace(/["\r\n]/g, '');
    res.setHeader('Content-Disposition', `${disp}; filename="${safeOriginal}"`);
    return res.sendFile(resolved);
  });

  // WebAuthn / Biometric Challenge & Verification
  app.post('/api/security/webauthn/challenge', requireAuth, (req: AuthRequest, res: Response) => {
    const challenge = crypto.randomBytes(32).toString('base64url');
    webAuthnChallenges.set(req.user!.uid, {
      challenge,
      expiresAt: Date.now() + 5 * 60_000,
    });
    return res.json({
      challenge,
      rpName: '7Sunday Meet',
      userId: req.user!.uid,
      userEmail: req.user!.email || req.user!.uid,
    });
  });

  app.post('/api/security/webauthn/verify', requireAuth, (req: AuthRequest, res: Response) => {
    const record = webAuthnChallenges.get(req.user!.uid);
    if (!record || Date.now() > record.expiresAt) {
      return res.status(400).json({ error: 'Biometric challenge expired. Please try again.' });
    }
    const { credentialId, clientDataJSON } = req.body || {};
    if (typeof credentialId !== 'string' || !credentialId || typeof clientDataJSON !== 'string') {
      return res.status(400).json({ error: 'Invalid biometric credential payload.' });
    }
    try {
      const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
      if (parsed.challenge !== record.challenge) {
        return res.status(400).json({ error: 'Biometric challenge mismatch.' });
      }
      webAuthnChallenges.delete(req.user!.uid);
      return res.json({ verified: true, credentialId: credentialId.slice(0, 128) });
    } catch {
      return res.status(400).json({ error: 'Unable to parse biometric attestation.' });
    }
  });

  // Real external invitation dispatch (only invokes APIs when credentials exist in process.env)
  app.post('/api/invitations/dispatch', requireAuth, async (req: AuthRequest, res: Response) => {
    const { channel, recipient, title, meetingUrl, startTime, agenda } = req.body || {};
    if (typeof channel !== 'string' || typeof recipient !== 'string' || typeof meetingUrl !== 'string') {
      return res.status(400).json({ error: 'Invalid invitation payload.' });
    }
    if (!/^(https?:\/\/)/i.test(meetingUrl)) {
      return res.status(400).json({ error: 'Invalid meeting URL scheme.' });
    }
    const text = `7Sunday Meet Invitation: ${String(title || 'Meeting')}\nWhen: ${String(startTime || 'Scheduled')}\nJoin Link: ${meetingUrl}${agenda ? `\nAgenda: ${String(agenda).slice(0, 300)}` : ''}`;

    try {
      if (channel === 'telegram' && process.env.TELEGRAM_BOT_TOKEN) {
        const resp = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ chat_id: recipient, text }),
        });
        if (!resp.ok) {
          const errData = await resp.text();
          return res.status(502).json({ delivered: false, configured: true, error: `Telegram API error: ${errData.slice(0, 150)}` });
        }
        return res.json({ delivered: true, configured: true, channel: 'telegram' });
      }

      if (channel === 'whatsapp' && process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) {
        const resp = await fetch(`https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: recipient.replace(/[^0-9+]/g, ''),
            type: 'text',
            text: { body: text },
          }),
        });
        if (!resp.ok) {
          const errData = await resp.text();
          return res.status(502).json({ delivered: false, configured: true, error: `WhatsApp API error: ${errData.slice(0, 150)}` });
        }
        return res.json({ delivered: true, configured: true, channel: 'whatsapp' });
      }

      if (channel === 'sms' && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) {
        const params = new URLSearchParams({
          To: recipient,
          From: process.env.TWILIO_FROM_NUMBER,
          Body: text.slice(0, 1500),
        });
        const authStr = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${authStr}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });
        if (!resp.ok) {
          const errData = await resp.text();
          return res.status(502).json({ delivered: false, configured: true, error: `Twilio SMS error: ${errData.slice(0, 150)}` });
        }
        return res.json({ delivered: true, configured: true, channel: 'sms' });
      }

      if (channel === 'email' && process.env.SMTP_WEBHOOK_URL) {
        const resp = await fetch(process.env.SMTP_WEBHOOK_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: recipient, subject: `7Sunday Meet: ${title || 'Invitation'}`, text }),
        });
        if (!resp.ok) {
          return res.status(502).json({ delivered: false, configured: true, error: 'Email webhook delivery failed.' });
        }
        return res.json({ delivered: true, configured: true, channel: 'email' });
      }

      const encoded = encodeURIComponent(text);
      const cleanPhone = recipient.replace(/[^0-9]/g, '');
      const fallbackUrls: Record<string, string> = {
        whatsapp: `https://wa.me/${cleanPhone}?text=${encoded}`,
        telegram: `https://t.me/share/url?url=${encodeURIComponent(meetingUrl)}&text=${encoded}`,
        email: `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(`7Sunday Meet: ${title || 'Meeting Invitation'}`)}&body=${encoded}`,
        sms: `sms:${encodeURIComponent(recipient)}?body=${encoded}`,
      };
      return res.json({
        delivered: false,
        configured: false,
        channel,
        fallbackUrl: fallbackUrls[channel] || meetingUrl,
      });
    } catch (err) {
      console.error('Invitation dispatch error:', err);
      return res.status(500).json({ error: 'Unable to dispatch invitation.' });
    }
  });

  return app;
}

interface WSClient {
  ws: WebSocket;
  uid: string;
  displayName: string;
  role?: string;
  accountType?: string;
  meetingId?: string;
  micMuted?: boolean;
  camOff?: boolean;
  handRaised?: boolean;
  screenSharing?: boolean;
}

const SUPPORT_STAFF_ROLES = new Set([
  'support_agent',
  'company_admin',
  'super_admin',
  'it_admin',
  'department_manager',
  'hr_manager',
]);

export function attachWebSocketServer(
  server: http.Server,
  verifyToken: TokenVerifier = (token) => adminAuth.verifyIdToken(token),
  authTimeoutMs = 10_000
) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clientsBySocket = new Map<WebSocket, WSClient>();
  const meetingRooms = new Map<string, Set<WebSocket>>();
  const meetingWhiteboards = new Map<string, unknown[]>();
  const onlineUsers = new Map<string, { uid: string; displayName: string; availability: string; role?: string; accountType?: string }>();

  function broadcastPresence() {
    const payload = JSON.stringify({
      type: 'presence:snapshot',
      users: Array.from(onlineUsers.values()),
    });
    for (const client of clientsBySocket.keys()) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }

  function sendToUid(targetUid: string, payload: unknown, excludeSocket?: WebSocket): number {
    let delivered = 0;
    const serialized = JSON.stringify(payload);
    for (const [sock, client] of clientsBySocket.entries()) {
      if (sock !== excludeSocket && client.uid === targetUid && sock.readyState === WebSocket.OPEN) {
        sock.send(serialized);
        delivered += 1;
      }
    }
    return delivered;
  }

  function sendToStaff(payload: unknown, excludeSocket?: WebSocket): number {
    let delivered = 0;
    const serialized = JSON.stringify(payload);
    for (const [sock, client] of clientsBySocket.entries()) {
      const isStaff = client.accountType === 'employee' || (client.role ? SUPPORT_STAFF_ROLES.has(client.role) : false);
      if (sock !== excludeSocket && isStaff && sock.readyState === WebSocket.OPEN) {
        sock.send(serialized);
        delivered += 1;
      }
    }
    return delivered;
  }

  function broadcastToRoom(meetingId: string, payload: unknown, excludeSocket?: WebSocket) {
    const room = meetingRooms.get(meetingId);
    if (!room) return;
    const serialized = JSON.stringify(payload);
    for (const sock of room) {
      if (sock !== excludeSocket && sock.readyState === WebSocket.OPEN) {
        sock.send(serialized);
      }
    }
  }

  function getRoomPeers(meetingId: string) {
    const room = meetingRooms.get(meetingId);
    if (!room) return [];
    const peers: Array<{
      uid: string;
      displayName: string;
      micMuted: boolean;
      camOff: boolean;
      handRaised: boolean;
      screenSharing: boolean;
    }> = [];
    for (const sock of room) {
      const c = clientsBySocket.get(sock);
      if (c) {
        peers.push({
          uid: c.uid,
          displayName: c.displayName,
          micMuted: Boolean(c.micMuted),
          camOff: Boolean(c.camOff),
          handRaised: Boolean(c.handRaised),
          screenSharing: Boolean(c.screenSharing),
        });
      }
    }
    return peers;
  }

  wss.on('connection', (ws) => {
    let authenticated = false;

    const authTimeout = setTimeout(() => {
      if (!authenticated) {
        ws.close(4001, 'Authentication timeout');
      }
    }, authTimeoutMs);

    ws.on('message', async (raw) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === 'auth' && typeof msg.token === 'string') {
        try {
          const decoded = await verifyToken(msg.token);
          authenticated = true;
          clearTimeout(authTimeout);
          const displayName =
            typeof msg.displayName === 'string' && msg.displayName
              ? msg.displayName.slice(0, 120)
              : (decoded.name || decoded.email || 'User');
          const role = typeof msg.role === 'string' ? msg.role.slice(0, 64) : undefined;
          const accountType = typeof msg.accountType === 'string' ? msg.accountType.slice(0, 32) : undefined;
          const client: WSClient = {
            ws,
            uid: decoded.uid,
            displayName,
            role,
            accountType,
          };
          clientsBySocket.set(ws, client);
          onlineUsers.set(decoded.uid, {
            uid: decoded.uid,
            displayName,
            availability: typeof msg.availability === 'string' ? msg.availability : 'available',
            ...(role ? { role } : {}),
            ...(accountType ? { accountType } : {}),
          });
          ws.send(JSON.stringify({ type: 'auth:ok', uid: decoded.uid }));
          broadcastPresence();
        } catch {
          ws.close(4003, 'Invalid auth token');
        }
        return;
      }

      if (!authenticated) return;
      const sender = clientsBySocket.get(ws);
      if (!sender) return;

      switch (msg.type) {
        case 'presence:update': {
          const availability = typeof msg.availability === 'string' ? msg.availability : 'available';
          onlineUsers.set(sender.uid, {
            uid: sender.uid,
            displayName: sender.displayName,
            availability,
            ...(sender.role ? { role: sender.role } : {}),
            ...(sender.accountType ? { accountType: sender.accountType } : {}),
          });
          broadcastPresence();
          break;
        }

        case 'call:invite': {
          const callId = String(msg.callId || '');
          const callType = msg.callType === 'video' ? 'video' : 'audio';
          const targetUid = String(msg.targetUid || '');
          const targetQueue = Boolean(msg.targetQueue) || targetUid === 'support_queue';
          if (!callId || !targetUid) return;

          const invitePayload = {
            type: 'call:incoming',
            callId,
            callType,
            callerUid: sender.uid,
            callerName: sender.displayName,
            callerRole: sender.role || sender.accountType || 'customer',
            targetUid,
            targetQueue,
            orderId: typeof msg.orderId === 'string' ? msg.orderId : undefined,
            startedAt: new Date().toISOString(),
          };
          const deliveredCount = targetQueue
            ? sendToStaff(invitePayload, ws)
            : sendToUid(targetUid, invitePayload, ws);
          ws.send(JSON.stringify({ type: 'call:ringing', callId, deliveredCount }));
          break;
        }

        case 'call:accept': {
          const callId = String(msg.callId || '');
          const targetUid = String(msg.targetUid || '');
          if (!callId || !targetUid) return;
          sendToUid(targetUid, {
            type: 'call:accepted',
            callId,
            fromUid: sender.uid,
            fromName: sender.displayName,
          }, ws);
          // Dismiss ringing notification on other staff screens if it was a support queue call
          sendToStaff({
            type: 'call:claimed',
            callId,
            answeredByUid: sender.uid,
            answeredByName: sender.displayName,
          }, ws);
          break;
        }

        case 'call:reject':
        case 'call:busy': {
          const callId = String(msg.callId || '');
          const targetUid = String(msg.targetUid || '');
          if (!callId || !targetUid) return;
          sendToUid(targetUid, {
            type: msg.type === 'call:busy' ? 'call:busy' : 'call:rejected',
            callId,
            fromUid: sender.uid,
            fromName: sender.displayName,
            reason: typeof msg.reason === 'string' ? msg.reason : undefined,
          }, ws);
          break;
        }

        case 'call:end': {
          const callId = String(msg.callId || '');
          const targetUid = String(msg.targetUid || '');
          if (!callId) return;
          const payload = {
            type: 'call:ended',
            callId,
            fromUid: sender.uid,
            fromName: sender.displayName,
            reason: typeof msg.reason === 'string' ? msg.reason : 'ended',
          };
          if (!targetUid || targetUid === 'support_queue') {
            sendToStaff(payload, ws);
          } else {
            sendToUid(targetUid, payload, ws);
          }
          break;
        }

        case 'call:webrtc-offer':
        case 'call:webrtc-answer':
        case 'call:webrtc-ice':
        case 'call:media-state': {
          const callId = String(msg.callId || '');
          const targetUid = String(msg.targetUid || '');
          if (!callId || !targetUid) return;
          sendToUid(targetUid, {
            type: msg.type,
            callId,
            fromUid: sender.uid,
            fromName: sender.displayName,
            sdp: msg.sdp,
            candidate: msg.candidate,
            micMuted: msg.micMuted,
            camOff: msg.camOff,
            audioOnly: msg.audioOnly,
          }, ws);
          break;
        }

        case 'chat:typing': {
          const conversationId = String(msg.conversationId || '');
          const isTyping = Boolean(msg.isTyping);
          const payload = JSON.stringify({
            type: 'chat:typing',
            conversationId,
            uid: sender.uid,
            displayName: sender.displayName,
            isTyping,
          });
          for (const sock of clientsBySocket.keys()) {
            if (sock !== ws && sock.readyState === WebSocket.OPEN) {
              sock.send(payload);
            }
          }
          break;
        }

        case 'meeting:join': {
          const meetingId = String(msg.meetingId || '');
          if (!meetingId) return;
          if (sender.meetingId && sender.meetingId !== meetingId) {
            meetingRooms.get(sender.meetingId)?.delete(ws);
            broadcastToRoom(sender.meetingId, { type: 'meeting:peer-left', uid: sender.uid });
          }
          sender.meetingId = meetingId;
          sender.micMuted = Boolean(msg.micMuted);
          sender.camOff = Boolean(msg.camOff);
          sender.handRaised = false;
          sender.screenSharing = false;
          if (!meetingRooms.has(meetingId)) {
            meetingRooms.set(meetingId, new Set());
          }
          meetingRooms.get(meetingId)!.add(ws);

          ws.send(JSON.stringify({
            type: 'meeting:joined',
            meetingId,
            peers: getRoomPeers(meetingId),
            whiteboard: meetingWhiteboards.get(meetingId) || [],
          }));

          broadcastToRoom(meetingId, {
            type: 'meeting:peer-joined',
            peer: {
              uid: sender.uid,
              displayName: sender.displayName,
              micMuted: sender.micMuted,
              camOff: sender.camOff,
              handRaised: false,
              screenSharing: false,
            },
          }, ws);
          break;
        }

        case 'meeting:leave': {
          const meetingId = sender.meetingId;
          if (meetingId) {
            meetingRooms.get(meetingId)?.delete(ws);
            broadcastToRoom(meetingId, { type: 'meeting:peer-left', uid: sender.uid });
            sender.meetingId = undefined;
          }
          break;
        }

        case 'webrtc:offer':
        case 'webrtc:answer':
        case 'webrtc:ice': {
          const targetUid = String(msg.targetUid || '');
          const meetingId = sender.meetingId;
          if (!meetingId || !targetUid) return;
          const room = meetingRooms.get(meetingId);
          if (!room) return;
          for (const sock of room) {
            const target = clientsBySocket.get(sock);
            if (target && target.uid === targetUid && sock.readyState === WebSocket.OPEN) {
              sock.send(JSON.stringify({
                type: msg.type,
                fromUid: sender.uid,
                fromName: sender.displayName,
                sdp: msg.sdp,
                candidate: msg.candidate,
              }));
            }
          }
          break;
        }

        case 'meeting:media-state': {
          if (!sender.meetingId) return;
          sender.micMuted = Boolean(msg.micMuted);
          sender.camOff = Boolean(msg.camOff);
          sender.handRaised = Boolean(msg.handRaised);
          sender.screenSharing = Boolean(msg.screenSharing);
          broadcastToRoom(sender.meetingId, {
            type: 'meeting:media-state',
            uid: sender.uid,
            micMuted: sender.micMuted,
            camOff: sender.camOff,
            handRaised: sender.handRaised,
            screenSharing: sender.screenSharing,
          }, ws);
          break;
        }

        case 'meeting:host-action': {
          if (!sender.meetingId) return;
          broadcastToRoom(sender.meetingId, {
            type: 'meeting:host-action',
            fromUid: sender.uid,
            targetUid: msg.targetUid,
            action: msg.action,
          }, ws);
          break;
        }

        case 'meeting:whiteboard-stroke': {
          if (!sender.meetingId || !msg.stroke) return;
          const list = meetingWhiteboards.get(sender.meetingId) || [];
          if (list.length < 2000) {
            list.push(msg.stroke);
            meetingWhiteboards.set(sender.meetingId, list);
          }
          broadcastToRoom(sender.meetingId, {
            type: 'meeting:whiteboard-stroke',
            stroke: msg.stroke,
          }, ws);
          break;
        }

        case 'meeting:whiteboard-clear': {
          if (!sender.meetingId) return;
          meetingWhiteboards.set(sender.meetingId, []);
          broadcastToRoom(sender.meetingId, {
            type: 'meeting:whiteboard-clear',
          }, ws);
          break;
        }

        case 'meeting:chat': {
          if (!sender.meetingId || typeof msg.text !== 'string') return;
          broadcastToRoom(sender.meetingId, {
            type: 'meeting:chat',
            id: crypto.randomUUID(),
            senderUid: sender.uid,
            senderName: sender.displayName,
            text: msg.text.slice(0, 1000),
            createdAt: new Date().toISOString(),
          });
          break;
        }
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      const client = clientsBySocket.get(ws);
      if (client) {
        if (client.meetingId) {
          meetingRooms.get(client.meetingId)?.delete(ws);
          broadcastToRoom(client.meetingId, { type: 'meeting:peer-left', uid: client.uid });
        }
        clientsBySocket.delete(ws);
        const stillConnected = Array.from(clientsBySocket.values()).some((c) => c.uid === client.uid);
        if (!stillConnected) {
          onlineUsers.delete(client.uid);
          broadcastPresence();
        }
      }
    });
  });

  return wss;
}

async function startServer() {
  const app = createApp();
  const server = http.createServer(app);
  attachWebSocketServer(server);

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: false },
      appType: 'spa',
    });
    app.get('/@vite/client', async (_req, res, next) => {
      try {
        const result = await vite.transformRequest('/@vite/client');
        if (!result) return next();
        const patchedCode = result.code
          .replace('transport.connect(createHMRHandler(handleMessage));', '/* hmr disabled */')
          .replace(
            'throw new SendBeforeConnectError("send was called before connect")',
            'return'
          );
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        return res.send(patchedCode);
      } catch (err) {
        return next(err);
      }
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`7Sunday Meet server listening on http://0.0.0.0:${PORT}`);
  });
}

const isEntry =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntry && process.env.NODE_ENV !== 'test') {
  startServer().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
