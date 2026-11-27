import React, { useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import {
  Camera,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  Laptop,
  Mic,
  RefreshCw,
  Shield,
  Smartphone,
  Tablet,
  Volume2,
  Bell,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { logAuditEvent, recordSyncCheckpoint } from '../../lib/firestoreActions';
import { SyncRecord } from '../../types/domain';

export function detectDeviceClass(ua = typeof navigator !== 'undefined' ? navigator.userAgent : '', width = typeof window !== 'undefined' ? window.innerWidth : 1280) {
  const lower = ua.toLowerCase();
  if (/iphone|ipod/.test(lower)) return { id: 'iphone', label: 'iPhone (iOS)', mobile: true };
  if (/ipad/.test(lower) || (/macintosh/.test(lower) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1)) {
    return { id: 'tablet', label: 'iPad / Tablet', mobile: false };
  }
  if (/android/.test(lower)) {
    if (/mobile/.test(lower) || width < 768) return { id: 'android', label: 'Android Phone', mobile: true };
    return { id: 'tablet', label: 'Android Tablet', mobile: false };
  }
  if (width < 768) return { id: 'android', label: 'Mobile Handset', mobile: true };
  if (width < 1024) return { id: 'tablet', label: 'Tablet Viewport', mobile: false };
  return { id: 'desktop', label: 'Desktop Browser', mobile: false };
}

export const SyncAndSecurityCenter: React.FC = () => {
  const { profile, getToken, requestPasswordReset } = useAuth();
  const [syncRecords, setSyncRecords] = useState<SyncRecord[]>([]);
  const [syncingType, setSyncingType] = useState<string | null>(null);
  const [autoSync, setAutoSync] = useState(() => window.localStorage.getItem('7sunday_autosync') !== 'false');

  // Biometrics & MFA
  const [biometricBusy, setBiometricBusy] = useState(false);
  const [securityNotice, setSecurityNotice] = useState<string | null>(null);
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  // Device settings
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedCam, setSelectedCam] = useState('');
  const [testingMedia, setTestingMedia] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const testStreamRef = useRef<MediaStream | null>(null);

  const detectedDevice = useMemo(() => detectDeviceClass(), []);
  const deviceCapabilities = useMemo(
    () => ({
      webrtc: typeof RTCPeerConnection !== 'undefined',
      mediaDevices: typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia),
      webauthn: typeof window !== 'undefined' && Boolean(window.PublicKeyCredential),
      serviceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      standalone:
        typeof window !== 'undefined' &&
        (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true),
    }),
    []
  );

  useEffect(() => {
    if (!profile) return;
    const unsub = onSnapshot(
      query(collection(db, 'syncRecords'), where('uid', '==', profile.uid)),
      (snap) => {
        setSyncRecords(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<SyncRecord, 'id'>) }))
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'syncRecords')
    );
    return () => unsub();
  }, [profile?.uid]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then((list) => setDevices(list)).catch(() => {});
    return () => {
      testStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const runSync = async (syncType: SyncRecord['syncType']) => {
    if (!profile) return;
    setSyncingType(syncType);
    try {
      await recordSyncCheckpoint(profile.uid, syncType, 1, 'synced');
      setSecurityNotice(`Synchronized ${syncType.replace('_', ' ')} across authorized devices.`);
    } catch (err) {
      await recordSyncCheckpoint(
        profile.uid,
        syncType,
        0,
        'failed',
        err instanceof Error ? err.message : 'Sync failed'
      ).catch(() => {});
    } finally {
      setSyncingType(null);
    }
  };

  const enrollBiometricPasskey = async () => {
    if (!profile) return;
    setBiometricBusy(true);
    setSecurityNotice(null);
    try {
      if (!window.PublicKeyCredential) {
        throw new Error('WebAuthn biometric authentication is not supported on this browser/device.');
      }
      const token = await getToken();
      if (!token) throw new Error('Authentication expired.');
      const chalResp = await fetch('/api/security/webauthn/challenge', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const chalData = await chalResp.json();
      const challengeBytes = Uint8Array.from(atob(chalData.challenge.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
        c.charCodeAt(0)
      );

      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: challengeBytes,
          rp: { name: '7Sunday Meet' },
          user: {
            id: new TextEncoder().encode(profile.uid.slice(0, 32)),
            name: profile.email,
            displayName: profile.fullName,
          },
          pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
          authenticatorSelection: { userVerification: 'preferred' },
          timeout: 60000,
        },
      })) as PublicKeyCredential | null;

      if (!cred) throw new Error('Biometric registration cancelled.');
      const clientDataB64 = btoa(
        String.fromCharCode(...new Uint8Array((cred.response as AuthenticatorAttestationResponse).clientDataJSON))
      )
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const verifyResp = await fetch('/api/security/webauthn/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          credentialId: cred.id,
          clientDataJSON: clientDataB64,
        }),
      });
      const verifyData = await verifyResp.json();
      if (!verifyData.verified) throw new Error(verifyData.error || 'Verification failed.');

      await updateDoc(doc(db, 'users', profile.uid), {
        biometricEnabled: true,
        updatedAt: new Date().toISOString(),
      });
      await logAuditEvent(profile, 'BIOMETRIC_ENROLLED', 'user', profile.uid, 'Registered WebAuthn device passkey');
      setSecurityNotice('Biometric / Fingerprint / Face ID passkey verified and enabled for this account.');
    } catch (err) {
      setSecurityNotice(err instanceof Error ? err.message : 'Unable to register biometric passkey.');
    } finally {
      setBiometricBusy(false);
    }
  };

  const toggleMfa = async () => {
    if (!profile) return;
    const next = !profile.mfaEnabled;
    await updateDoc(doc(db, 'users', profile.uid), {
      mfaEnabled: next,
      updatedAt: new Date().toISOString(),
    });
    await logAuditEvent(profile, next ? 'MFA_ENABLED' : 'MFA_DISABLED', 'user', profile.uid, 'Toggled account MFA');
    setSecurityNotice(next ? 'Multi-factor authentication policy enabled.' : 'Multi-factor authentication disabled.');
  };

  const toggleDeviceTest = async () => {
    if (testingMedia) {
      testStreamRef.current?.getTracks().forEach((t) => t.stop());
      testStreamRef.current = null;
      setTestingMedia(false);
      setMicLevel(0);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: selectedMic ? { deviceId: { exact: selectedMic } } : true,
        video: selectedCam ? { deviceId: { exact: selectedCam } } : true,
      });
      testStreamRef.current = stream;
      if (videoPreviewRef.current) videoPreviewRef.current.srcObject = stream;

      const audioCtx = new AudioContext();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      setTestingMedia(true);

      const sample = () => {
        if (!testStreamRef.current) {
          audioCtx.close().catch(() => {});
          return;
        }
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        requestAnimationFrame(sample);
      };
      sample();

      const updatedDevices = await navigator.mediaDevices.enumerateDevices();
      setDevices(updatedDevices);
    } catch {
      setSecurityNotice('Unable to access camera or microphone. Please verify browser permissions.');
    }
  };

  const mics = devices.filter((d) => d.kind === 'audioinput');
  const cams = devices.filter((d) => d.kind === 'videoinput');
  const speakers = devices.filter((d) => d.kind === 'audiooutput');

  return (
    <div className="space-y-6">
      {securityNotice && (
        <div className="rounded-xl border border-[#1178B9]/30 bg-[#EAF4FF] dark:bg-[#082B59]/40 p-4 text-xs text-[#082B59] dark:text-[#EAF4FF] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-[#1178B9]" />
          <span>{securityNotice}</span>
        </div>
      )}

      {/* Multi-Device Compatibility Matrix */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#15243A] dark:text-white">Multi-Device Readiness & Platform Diagnostics</h3>
            <p className="text-xs text-[#293858]/80 dark:text-slate-400">
              Active device detected: <strong className="text-[#1178B9]">{detectedDevice.label}</strong> ·{' '}
              {deviceCapabilities.standalone ? 'Installed PWA Mode' : 'Browser Mode'}
            </p>
          </div>
          <span className="px-3 py-1 rounded-lg bg-[#EAF4FF] dark:bg-[#082B59] text-[#082B59] dark:text-[#EAF4FF] text-xs font-semibold">
            {deviceCapabilities.webrtc && deviceCapabilities.serviceWorker ? 'All Device Modules Ready' : 'Standard Browser Mode'}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {[
            {
              id: 'android',
              title: 'Android Phones',
              Icon: Smartphone,
              desc: 'Touch 44px controls, WebRTC video, Chrome PWA install, fingerprint passkeys.',
            },
            {
              id: 'iphone',
              title: 'iPhone (iOS)',
              Icon: Smartphone,
              desc: 'Safe-area notch fit, Safari Home Screen app, Face ID / Passkey & WebRTC audio/video.',
            },
            {
              id: 'tablet',
              title: 'Tablets & iPadOS',
              Icon: Tablet,
              desc: 'Split-pane responsive workspace, stylus-ready collaborative whiteboard & HD rooms.',
            },
            {
              id: 'desktop',
              title: 'Desktop Browsers',
              Icon: Laptop,
              desc: 'Full command sidebar, screen sharing, Excel/PDF exports & print layout.',
            },
          ].map(({ id, title, Icon, desc }) => {
            const active = detectedDevice.id === id;
            return (
              <div
                key={id}
                className={`rounded-xl border p-4 space-y-1.5 ${
                  active
                    ? 'border-[#1178B9] bg-[#EAF4FF]/70 dark:bg-[#082B59]/40'
                    : 'border-slate-200 dark:border-slate-800 bg-[#F5F8FC] dark:bg-slate-950'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 font-semibold text-[#082B59] dark:text-white">
                    <Icon className="w-4 h-4 text-[#1178B9]" />
                    {title}
                  </span>
                  {active && <span className="text-[10px] font-bold text-[#1178B9] uppercase">Active</span>}
                </div>
                <p className="text-[#293858]/80 dark:text-slate-400 leading-relaxed">{desc}</p>
              </div>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Synchronization Center */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="text-base font-semibold text-[#15243A] dark:text-white">Encrypted Synchronization Center</h3>
              <p className="text-xs text-[#293858]/80 dark:text-slate-400">
                Synchronize messages, meetings, contacts, and offline data across devices.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={autoSync}
                onChange={(e) => {
                  setAutoSync(e.target.checked);
                  window.localStorage.setItem('7sunday_autosync', String(e.target.checked));
                }}
              />
              <span>Auto-Sync</span>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {(['full', 'messages', 'meetings', 'contacts', 'customer_data'] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={syncingType !== null}
                onClick={() => runSync(t)}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-xs font-medium capitalize"
              >
                <RefreshCw className={`w-3.5 h-3.5 text-[#1178B9] ${syncingType === t ? 'animate-spin' : ''}`} />
                <span>Sync {t.replace('_', ' ')}</span>
              </button>
            ))}
          </div>

          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {syncRecords.length === 0 ? (
              <p className="py-6 text-slate-500 text-center">No device sync checkpoints recorded yet. Run a sync above.</p>
            ) : (
              syncRecords.map((rec) => (
                <div key={rec.id} className="py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-[#15243A] dark:text-slate-100 capitalize">
                      {rec.syncType.replace('_', ' ')} · {rec.deviceName}
                    </p>
                    <p className="text-slate-500 tabular-nums">
                      Updated {new Date(rec.updatedAt).toLocaleString()}
                    </p>
                    {rec.errorMessage && <p className="text-red-600">{rec.errorMessage}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`font-semibold ${rec.status === 'synced' ? 'text-[#1178B9] dark:text-[#087CEB]' : 'text-red-600'}`}>
                      {rec.status}
                    </span>
                    {rec.status === 'failed' && (
                      <button type="button" onClick={() => runSync(rec.syncType)} className="text-[#1178B9] underline">
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Account Security & Biometrics */}
        <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-[#1178B9]" />
            <div>
              <h3 className="text-base font-semibold text-[#15243A] dark:text-white">Account Security & Biometric Auth</h3>
              <p className="text-xs text-[#293858]/80 dark:text-slate-400">
                Manage MFA, Fingerprint / Face ID passkeys, and password recovery.
              </p>
            </div>
          </div>

          <div className="space-y-3 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-sm">Biometric / Passkey (Fingerprint & Face ID)</p>
                <p className="text-slate-500">
                  Status: {profile?.biometricEnabled ? 'Enabled on device' : 'Not enrolled'}
                </p>
              </div>
              <button
                type="button"
                disabled={biometricBusy}
                onClick={enrollBiometricPasskey}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white font-medium"
              >
                <Fingerprint className="w-4 h-4" />
                <span>{biometricBusy ? 'Verifying...' : 'Enroll Biometric'}</span>
              </button>
            </div>

            <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-sm">Multi-Factor Authentication (MFA)</p>
                <p className="text-slate-500">
                  Require secondary verification on sensitive actions ({profile?.mfaEnabled ? 'Active' : 'Off'}).
                </p>
              </div>
              <button
                type="button"
                onClick={toggleMfa}
                className="min-h-[44px] px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 font-medium hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
              >
                {profile?.mfaEnabled ? 'Disable MFA' : 'Enable MFA'}
              </button>
            </div>

            <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-sm">Password Reset</p>
                <p className="text-slate-500">Send a verified password reset email to {profile?.email}</p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  if (!profile?.email) return;
                  await requestPasswordReset(profile.email);
                  setSecurityNotice(`Password reset link sent to ${profile.email}.`);
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 font-medium hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
              >
                <KeyRound className="w-3.5 h-3.5 text-[#1178B9]" />
                <span>Send Reset</span>
              </button>
            </div>

            <div className="pt-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-medium text-sm">Instant Device &amp; Browser Alerts</p>
                <p className="text-slate-500">
                  Receive live alerts for new products, orders, incoming calls, and support messages (
                  {notifPerm === 'unsupported'
                    ? 'Browser API unavailable'
                    : notifPerm === 'granted'
                    ? 'Enabled'
                    : notifPerm === 'denied'
                    ? 'Blocked in browser'
                    : 'Not enabled'}
                  ).
                </p>
              </div>
              <button
                type="button"
                disabled={notifPerm === 'unsupported' || notifPerm === 'granted'}
                onClick={async () => {
                  if (typeof Notification === 'undefined') return;
                  const perm = await Notification.requestPermission();
                  setNotifPerm(perm);
                  setSecurityNotice(
                    perm === 'granted'
                      ? 'Device push notifications enabled for new products, calls, and orders.'
                      : 'Notification permission was not granted by the browser.'
                  );
                }}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 font-medium hover:bg-[#EAF4FF] dark:hover:bg-slate-800 disabled:opacity-50"
              >
                <Bell className="w-3.5 h-3.5 text-[#1178B9]" />
                <span>{notifPerm === 'granted' ? 'Alerts Enabled' : 'Enable Alerts'}</span>
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Audio & Video Device Diagnostics */}
      <section className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-[#15243A] dark:text-white">Audio, Video & Device Settings</h3>
            <p className="text-xs text-[#293858]/80 dark:text-slate-400">
              Test camera preview, microphone input level, and select hardware peripherals for 7Sunday Meet.
            </p>
          </div>
          <button
            type="button"
            onClick={toggleDeviceTest}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#082B59] hover:bg-[#1178B9] text-white text-xs font-medium transition-colors"
          >
            <Camera className="w-4 h-4" />
            <span>{testingMedia ? 'Stop Hardware Test' : 'Test Camera & Microphone'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
          <div>
            <label className="flex items-center gap-1.5 font-medium text-[#293858] dark:text-slate-300 mb-1">
              <Mic className="w-3.5 h-3.5 text-[#1178B9]" /> Microphone ({mics.length})
            </label>
            <select
              value={selectedMic}
              onChange={(e) => setSelectedMic(e.target.value)}
              className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2"
            >
              <option value="">Default Microphone</option>
              {mics.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Microphone ${i + 1}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-1.5 font-medium text-[#293858] dark:text-slate-300 mb-1">
              <Camera className="w-3.5 h-3.5 text-[#1178B9]" /> Camera ({cams.length})
            </label>
            <select
              value={selectedCam}
              onChange={(e) => setSelectedCam(e.target.value)}
              className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2"
            >
              <option value="">Default Camera</option>
              {cams.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Camera ${i + 1}`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="flex items-center gap-1.5 font-medium text-[#293858] dark:text-slate-300 mb-1">
              <Volume2 className="w-3.5 h-3.5 text-[#1178B9]" /> Speakers ({speakers.length})
            </label>
            <select className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2">
              <option value="">Default Output</option>
              {speakers.map((d, i) => (
                <option key={d.deviceId || i} value={d.deviceId}>
                  {d.label || `Speaker ${i + 1}`}
                </option>
              ))}
            </select>
          </div>
        </div>

        {testingMedia && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center pt-2">
            <video ref={videoPreviewRef} autoPlay muted playsInline className="w-full max-h-56 rounded-lg bg-[#082B59] object-cover border border-slate-800" />
            <div className="space-y-2">
              <p className="text-xs font-medium">Live Microphone Input Level ({micLevel}%)</p>
              <div className="h-3 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                <div
                  className="h-full bg-[#087CEB] transition-all duration-75"
                  style={{ width: `${micLevel}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};
