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
  broadcastAll?: (payload: unknown) => number;
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
      emailWebhook: Boolean(process.env.SMTP_WEBHOOK_URL || process.env.RESEND_API_KEY),
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

  // Real multi-channel New Product Notification Broadcast (Email, SMS Text, WhatsApp, Telegram & WebSocket/Push)
  app.post('/api/notifications/broadcast-product', requireAuth, async (req: AuthRequest, res: Response) => {
    const body = req.body || {};
    const rawProduct = body.product;
    if (!rawProduct || typeof rawProduct !== 'object') {
      return res.status(400).json({ error: 'Product payload is required.' });
    }

    const name = typeof rawProduct.name === 'string' ? rawProduct.name.trim().slice(0, 160) : '';
    const sku = typeof rawProduct.sku === 'string' ? rawProduct.sku.trim().slice(0, 64) : '';
    const category = typeof rawProduct.category === 'string' ? rawProduct.category.trim().slice(0, 80) : 'Catalog';
    const description = typeof rawProduct.description === 'string' ? rawProduct.description.trim().slice(0, 500) : '';
    const unit = typeof rawProduct.unit === 'string' ? rawProduct.unit.trim().slice(0, 40) : 'Unit';
    const currency = typeof rawProduct.currency === 'string' ? rawProduct.currency.trim().slice(0, 8) : 'ETB';
    const contactForPrice = Boolean(rawProduct.contactForPrice);
    const price = typeof rawProduct.price === 'number' && Number.isFinite(rawProduct.price) && rawProduct.price >= 0 ? rawProduct.price : 0;
    const productId = typeof rawProduct.id === 'string' ? rawProduct.id.trim().slice(0, 128) : '';

    if (!name || !sku) {
      return res.status(400).json({ error: 'Product name and SKU are required.' });
    }

    const productUrlRaw = typeof body.productUrl === 'string' ? body.productUrl.trim() : '';
    if (productUrlRaw && !/^(https?:\/\/)/i.test(productUrlRaw)) {
      return res.status(400).json({ error: 'Invalid product URL scheme.' });
    }
    const productUrl = productUrlRaw || process.env.APP_URL || '';

    const allowedChannels = new Set(['in_app', 'push', 'email', 'sms', 'whatsapp', 'telegram']);
    const requestedChannels = new Set(
      Array.isArray(body.channels)
        ? body.channels.filter((c: unknown): c is string => typeof c === 'string' && allowedChannels.has(c)).slice(0, 8)
        : ['in_app', 'push', 'email', 'sms']
    );

    interface BroadcastRecipient {
      uid: string;
      fullName: string;
      email?: string;
      phone?: string;
      telegramChatId?: string;
    }

    const recipientsRaw = Array.isArray(body.recipients) ? body.recipients.slice(0, 500) : [];
    const recipients: BroadcastRecipient[] = [];
    const seenUids = new Set<string>();
    for (const r of recipientsRaw) {
      if (!r || typeof r !== 'object') continue;
      const uid = typeof r.uid === 'string' ? r.uid.trim().slice(0, 128) : '';
      if (!uid || seenUids.has(uid)) continue;
      seenUids.add(uid);
      const fullName = typeof r.fullName === 'string' && r.fullName.trim() ? r.fullName.trim().slice(0, 120) : 'Customer';
      const email = typeof r.email === 'string' ? r.email.trim().slice(0, 200) : '';
      const phone = typeof r.phone === 'string' ? r.phone.trim().slice(0, 40) : '';
      const telegramChatId = typeof r.telegramChatId === 'string' ? r.telegramChatId.trim().slice(0, 64) : '';
      recipients.push({
        uid,
        fullName,
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(telegramChatId ? { telegramChatId } : {}),
      });
    }

    const validEmails = Array.from(
      new Set(
        recipients
          .map((r) => r.email || '')
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      )
    );
    const validPhones = Array.from(
      new Set(
        recipients
          .map((r) => (r.phone || '').replace(/[^0-9+]/g, ''))
          .filter((p) => p.replace(/\D/g, '').length >= 6)
      )
    );

    const extraTg = typeof body.extraTelegramChatId === 'string' ? body.extraTelegramChatId.trim().slice(0, 64) : '';
    const telegramTargets = Array.from(
      new Set([
        ...recipients.map((r) => r.telegramChatId || '').filter(Boolean),
        ...(extraTg ? [extraTg] : []),
        ...(process.env.TELEGRAM_CHANNEL_ID ? [process.env.TELEGRAM_CHANNEL_ID.trim()] : []),
      ])
    );

    const priceLabel = contactForPrice ? 'Contact for Price' : `${currency} ${price.toFixed(2)} / ${unit}`;
    const customNote = typeof body.customMessage === 'string' && body.customMessage.trim()
      ? `\n${body.customMessage.trim().slice(0, 300)}`
      : '';
    const subject = `New Product Available: ${name} (${sku}) — 7Sunday Ethiopia`;
    const plainText = [
      `New Product Published at Seven Sunday PLC: ${name} (SKU: ${sku})`,
      `Category: ${category} | Price: ${priceLabel}`,
      description ? `Details: ${description}` : '',
      customNote.trim(),
      productUrl ? `View Product: ${productUrl}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="background:#082B59;color:#ffffff;padding:20px 24px;">
          <p style="margin:0;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:#EAF4FF;">Seven Sunday Manufacturing &amp; Trading PLC</p>
          <h2 style="margin:6px 0 0;font-size:20px;">New Product Announcement</h2>
        </div>
        <div style="padding:24px;color:#15243A;font-size:14px;line-height:1.5;">
          <p style="margin-top:0;"><strong>${escapeHtml(name)}</strong> (SKU: ${escapeHtml(sku)}) is now available in <strong>${escapeHtml(category)}</strong>.</p>
          <p><strong>Pricing:</strong> ${escapeHtml(priceLabel)}</p>
          ${description ? `<p>${escapeHtml(description)}</p>` : ''}
          ${customNote ? `<p>${escapeHtml(customNote.trim())}</p>` : ''}
          ${productUrl ? `<p style="margin-top:20px;"><a href="${escapeHtml(productUrl)}" style="display:inline-block;background:#1178B9;color:#ffffff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold;">Browse Product in 7Sunday Ethiopia</a></p>` : ''}
        </div>
      </div>
    `;

    // 1. Live WebSocket / Browser Push Broadcast
    const wsWanted = requestedChannels.has('push') || requestedChannels.has('in_app');
    const wsDelivered =
      wsWanted && options.broadcastAll
        ? options.broadcastAll({
            type: 'product:published',
            product: { id: productId, name, sku, category, price, contactForPrice, currency, unit },
            title: `New Product: ${name}`,
            message: `${category} · ${priceLabel}`,
            publishedBy: req.user?.name || req.user?.email || 'Admin',
            createdAt: new Date().toISOString(),
          })
        : 0;

    // 2. Email Broadcast
    const emailWanted = requestedChannels.has('email');
    const emailConfigured = Boolean(process.env.SMTP_WEBHOOK_URL || process.env.RESEND_API_KEY);
    let emailDelivered = 0;
    let emailFailed = 0;
    let emailDetail: string | undefined;

    if (emailWanted && emailConfigured && validEmails.length > 0) {
      if (process.env.SMTP_WEBHOOK_URL) {
        const results = await Promise.allSettled(
          validEmails.map(async (to) => {
            const resp = await fetch(process.env.SMTP_WEBHOOK_URL!, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ to, subject, text: plainText, html: htmlBody }),
            });
            if (!resp.ok) throw new Error(`Webhook HTTP ${resp.status}`);
          })
        );
        emailDelivered = results.filter((r) => r.status === 'fulfilled').length;
        emailFailed = results.length - emailDelivered;
      } else if (process.env.RESEND_API_KEY) {
        const from = process.env.EMAIL_FROM || 'Seven Sunday Ethiopia <onboarding@resend.dev>';
        const results = await Promise.allSettled(
          validEmails.map(async (to) => {
            const resp = await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ from, to: [to], subject, text: plainText, html: htmlBody }),
            });
            if (!resp.ok) throw new Error(`Resend HTTP ${resp.status}`);
          })
        );
        emailDelivered = results.filter((r) => r.status === 'fulfilled').length;
        emailFailed = results.length - emailDelivered;
      }
      emailDetail = `${emailDelivered}/${validEmails.length} email(s) sent.`;
    }

    const emailFallback =
      emailWanted && (!emailConfigured || emailDelivered === 0) && validEmails.length > 0
        ? `mailto:?bcc=${encodeURIComponent(validEmails.slice(0, 80).join(','))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`
        : emailWanted && (!emailConfigured || emailDelivered === 0)
        ? `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plainText)}`
        : undefined;

    // 3. SMS Text Broadcast
    const smsWanted = requestedChannels.has('sms');
    const smsConfigured = Boolean(
      process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
    );
    let smsDelivered = 0;
    let smsFailed = 0;
    let smsDetail: string | undefined;

    if (smsWanted && smsConfigured && validPhones.length > 0) {
      const authStr = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
      const results = await Promise.allSettled(
        validPhones.map(async (to) => {
          const params = new URLSearchParams({
            To: to,
            From: process.env.TWILIO_FROM_NUMBER!,
            Body: plainText.slice(0, 1500),
          });
          const resp = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`,
            {
              method: 'POST',
              headers: {
                Authorization: `Basic ${authStr}`,
                'Content-Type': 'application/x-www-form-urlencoded',
              },
              body: params.toString(),
            }
          );
          if (!resp.ok) throw new Error(`Twilio HTTP ${resp.status}`);
        })
      );
      smsDelivered = results.filter((r) => r.status === 'fulfilled').length;
      smsFailed = results.length - smsDelivered;
      smsDetail = `${smsDelivered}/${validPhones.length} SMS sent.`;
    }

    const smsFallback =
      smsWanted && (!smsConfigured || smsDelivered === 0)
        ? `sms:${validPhones.length > 0 ? encodeURIComponent(validPhones[0]) : ''}?body=${encodeURIComponent(plainText)}`
        : undefined;

    // 4. WhatsApp Broadcast
    const waWanted = requestedChannels.has('whatsapp');
    const waConfigured = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
    let waDelivered = 0;
    let waFailed = 0;

    if (waWanted && waConfigured && validPhones.length > 0) {
      const results = await Promise.allSettled(
        validPhones.map(async (to) => {
          const resp = await fetch(
            `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                messaging_product: 'whatsapp',
                to,
                type: 'text',
                text: { body: plainText },
              }),
            }
          );
          if (!resp.ok) throw new Error(`WhatsApp HTTP ${resp.status}`);
        })
      );
      waDelivered = results.filter((r) => r.status === 'fulfilled').length;
      waFailed = results.length - waDelivered;
    }

    const waFallback =
      waWanted && (!waConfigured || waDelivered === 0)
        ? `https://api.whatsapp.com/send?text=${encodeURIComponent(plainText)}`
        : undefined;

    // 5. Telegram Broadcast
    const tgWanted = requestedChannels.has('telegram');
    const tgConfigured = Boolean(process.env.TELEGRAM_BOT_TOKEN);
    let tgDelivered = 0;
    let tgFailed = 0;

    if (tgWanted && tgConfigured && telegramTargets.length > 0) {
      const results = await Promise.allSettled(
        telegramTargets.map(async (chatId) => {
          const resp = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ chat_id: chatId, text: plainText }),
          });
          if (!resp.ok) throw new Error(`Telegram HTTP ${resp.status}`);
        })
      );
      tgDelivered = results.filter((r) => r.status === 'fulfilled').length;
      tgFailed = results.length - tgDelivered;
    }

    const tgFallback =
      tgWanted && (!tgConfigured || tgDelivered === 0)
        ? `https://t.me/share/url?url=${encodeURIComponent(productUrl || 'https://sevensundayethiopia.com')}&text=${encodeURIComponent(plainText)}`
        : undefined;

    return res.json({
      totalRecipients: recipients.length,
      emailsCount: validEmails.length,
      phonesCount: validPhones.length,
      channels: {
        websocket: {
          requested: wsWanted,
          configured: true,
          attempted: wsWanted ? 1 : 0,
          delivered: wsDelivered,
          failed: 0,
        },
        email: {
          requested: emailWanted,
          configured: emailConfigured,
          attempted: emailWanted ? validEmails.length : 0,
          delivered: emailDelivered,
          failed: emailFailed,
          ...(emailFallback ? { fallbackUrl: emailFallback } : {}),
          ...(emailDetail ? { detail: emailDetail } : {}),
        },
        sms: {
          requested: smsWanted,
          configured: smsConfigured,
          attempted: smsWanted ? validPhones.length : 0,
          delivered: smsDelivered,
          failed: smsFailed,
          ...(smsFallback ? { fallbackUrl: smsFallback } : {}),
          ...(smsDetail ? { detail: smsDetail } : {}),
        },
        whatsapp: {
          requested: waWanted,
          configured: waConfigured,
          attempted: waWanted ? validPhones.length : 0,
          delivered: waDelivered,
          failed: waFailed,
          ...(waFallback ? { fallbackUrl: waFallback } : {}),
        },
        telegram: {
          requested: tgWanted,
          configured: tgConfigured,
          attempted: tgWanted ? telegramTargets.length : 0,
          delivered: tgDelivered,
          failed: tgFailed,
          ...(tgFallback ? { fallbackUrl: tgFallback } : {}),
        },
      },
    });
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

  function broadcastAll(payload: unknown): number {
    let delivered = 0;
    const serialized = JSON.stringify(payload);
    for (const sock of clientsBySocket.keys()) {
      if (sock.readyState === WebSocket.OPEN) {
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

  (wss as WebSocketServer & { broadcastAll: (payload: unknown) => number }).broadcastAll = broadcastAll;
  return wss as WebSocketServer & { broadcastAll: (payload: unknown) => number };
}

async function startServer() {
  let broadcastFn: ((payload: unknown) => number) | undefined;
  const app = createApp({
    broadcastAll: (payload) => (broadcastFn ? broadcastFn(payload) : 0),
  });
  const server = http.createServer(app);
  const wss = attachWebSocketServer(server);
  broadcastFn = wss.broadcastAll;

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
