// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { createApp } from '../server';

const mockUser = {
  uid: 'test-user-1',
  email: 'tester@sevensundayethiopia.com',
  email_verified: true,
  name: 'Test Runner',
} as unknown as DecodedIdToken;

describe('API Tests — Express Backend Endpoints & Security Headers', () => {
  let tempDir: string;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), '7sunday-uploads-'));
    app = createApp({
      uploadDir: tempDir,
      authVerifier: async (token: string) => {
        if (token === 'valid-test-token') return mockUser;
        throw new Error('Invalid token');
      },
    });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET /api/health returns 200 OK with security headers and without X-Frame-Options blocking iframe', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('7Sunday Meet');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeUndefined();
  });

  it('GET /api/integrations/status blocks unauthenticated requests (401) and allows authenticated requests (200)', async () => {
    const unauth = await request(app).get('/api/integrations/status');
    expect(unauth.status).toBe(401);

    const auth = await request(app)
      .get('/api/integrations/status')
      .set('Authorization', 'Bearer valid-test-token');
    expect(auth.status).toBe(200);
    expect(auth.body).toHaveProperty('telegramBot');
    expect(auth.body).toHaveProperty('whatsappCloud');
    expect(auth.body).toHaveProperty('twilioSms');
    expect(auth.body).toHaveProperty('emailWebhook');
    expect(auth.body).toHaveProperty('turnConfigured');
  });

  it('GET /api/rtc/config enforces auth and returns STUN plus optional TURN ICE servers', async () => {
    const unauth = await request(app).get('/api/rtc/config');
    expect(unauth.status).toBe(401);

    const prevTurn = process.env.TURN_URL;
    const prevUser = process.env.TURN_USERNAME;
    const prevCred = process.env.TURN_CREDENTIAL;

    try {
      delete process.env.TURN_URL;
      delete process.env.TURN_URLS;
      const defaultRes = await request(app)
        .get('/api/rtc/config')
        .set('Authorization', 'Bearer valid-test-token');
      expect(defaultRes.status).toBe(200);
      expect(defaultRes.body.turnConfigured).toBe(false);
      expect(Array.isArray(defaultRes.body.iceServers)).toBe(true);
      expect(defaultRes.body.iceServers.length).toBeGreaterThanOrEqual(1);

      process.env.TURN_URL = 'turn:turn.sevensundayethiopia.com:3478';
      process.env.TURN_USERNAME = '7sunday_rtc';
      process.env.TURN_CREDENTIAL = 'secret_pass';

      const turnRes = await request(app)
        .get('/api/rtc/config')
        .set('Authorization', 'Bearer valid-test-token');
      expect(turnRes.status).toBe(200);
      expect(turnRes.body.turnConfigured).toBe(true);
      expect(turnRes.body.iceServers).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            urls: ['turn:turn.sevensundayethiopia.com:3478'],
            username: '7sunday_rtc',
            credential: 'secret_pass',
          }),
        ])
      );
    } finally {
      if (prevTurn === undefined) delete process.env.TURN_URL;
      else process.env.TURN_URL = prevTurn;
      if (prevUser === undefined) delete process.env.TURN_USERNAME;
      else process.env.TURN_USERNAME = prevUser;
      if (prevCred === undefined) delete process.env.TURN_CREDENTIAL;
      else process.env.TURN_CREDENTIAL = prevCred;
    }
  });

  it('POST /api/uploads accepts valid files and serves them securely with nosniff', async () => {
    const noFile = await request(app)
      .post('/api/uploads')
      .set('Authorization', 'Bearer valid-test-token');
    expect(noFile.status).toBe(400);

    const badMime = await request(app)
      .post('/api/uploads')
      .set('Authorization', 'Bearer valid-test-token')
      .attach('file', Buffer.from('<script>alert(1)</script>'), {
        filename: 'xss.html',
        contentType: 'text/html',
      });
    expect(badMime.status).toBe(400);

    const validUpload = await request(app)
      .post('/api/uploads')
      .set('Authorization', 'Bearer valid-test-token')
      .attach('file', Buffer.from('Hello 7Sunday Invoice'), {
        filename: 'brief.txt',
        contentType: 'text/plain',
      });
    expect(validUpload.status).toBe(200);
    expect(validUpload.body.url).toMatch(/^\/api\/uploads\/[a-f0-9-]+\.txt$/);

    const fetched = await request(app).get(validUpload.body.url);
    expect(fetched.status).toBe(200);
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
    expect(fetched.headers['content-disposition']).toContain('attachment');
  });

  it('GET /api/uploads/:filename blocks path traversal / invalid characters', async () => {
    const res = await request(app).get('/api/uploads/%2e%2e%2fpackage.json');
    expect([400, 404]).toContain(res.status);
  });

  it('POST /api/security/webauthn/challenge and /verify validate challenge integrity', async () => {
    const chRes = await request(app)
      .post('/api/security/webauthn/challenge')
      .set('Authorization', 'Bearer valid-test-token');
    expect(chRes.status).toBe(200);
    expect(typeof chRes.body.challenge).toBe('string');

    const mismatch = await request(app)
      .post('/api/security/webauthn/verify')
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        credentialId: 'cred_123',
        clientDataJSON: Buffer.from(JSON.stringify({ challenge: 'wrong' })).toString('base64url'),
      });
    expect(mismatch.status).toBe(400);

    const ok = await request(app)
      .post('/api/security/webauthn/verify')
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        credentialId: 'cred_123',
        clientDataJSON: Buffer.from(JSON.stringify({ challenge: chRes.body.challenge })).toString('base64url'),
      });
    expect(ok.status).toBe(200);
    expect(ok.body.verified).toBe(true);
  });

  it('POST /api/invitations/dispatch rejects dangerous URL schemes and returns safe fallback URLs', async () => {
    const badUrl = await request(app)
      .post('/api/invitations/dispatch')
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        channel: 'whatsapp',
        recipient: '+251911000000',
        title: 'Test Meeting',
        meetingUrl: 'javascript:alert(1)',
      });
    expect(badUrl.status).toBe(400);

    const validInvite = await request(app)
      .post('/api/invitations/dispatch')
      .set('Authorization', 'Bearer valid-test-token')
      .send({
        channel: 'whatsapp',
        recipient: '+251911000000',
        title: 'Weekly Sync',
        meetingUrl: 'https://sevensundayethiopia.com/?join=7SM-1234',
      });
    expect(validInvite.status).toBe(200);
    expect(validInvite.body.fallbackUrl).toContain('https://wa.me/251911000000');
  });
});
