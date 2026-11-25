import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import { useAuth } from './AuthContext';
import { useWebSocket } from './WebSocketContext';
import { db } from '../lib/firebase';
import { createCallRecord, createNotification, updateCallRecord } from '../lib/firestoreActions';
import { fetchRtcConfiguration } from '../lib/rtcConfig';
import { CallRecord, SupportAgentInfo } from '../types/domain';

export type DirectCallPhase = 'idle' | 'calling' | 'incoming' | 'active';

export interface IncomingCallPayload {
  callId: string;
  callType: 'audio' | 'video';
  callerUid: string;
  callerName: string;
  callerRole?: string;
  targetUid: string;
  targetQueue?: boolean;
  orderId?: string;
  startedAt: string;
}

export interface StartCallInput {
  targetUid: string;
  targetName: string;
  callType: 'audio' | 'video';
  orderId?: string;
  targetQueue?: boolean;
}

interface DirectCallContextValue {
  phase: DirectCallPhase;
  activeCall: CallRecord | null;
  incomingCall: IncomingCallPayload | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micMuted: boolean;
  camOff: boolean;
  speakerMuted: boolean;
  audioOnlyFallback: boolean;
  peerMediaState: { micMuted: boolean; camOff: boolean; audioOnly: boolean };
  durationSeconds: number;
  callError: string | null;
  callsHistory: CallRecord[];
  supportAgents: SupportAgentInfo[];
  startCall: (input: StartCallInput) => Promise<void>;
  acceptCall: (overrideAudioOnly?: boolean) => Promise<void>;
  rejectCall: (reason?: string) => Promise<void>;
  endCall: (reason?: string) => Promise<void>;
  toggleMic: () => void;
  toggleCamera: () => Promise<void>;
  switchToAudioOnly: () => void;
  toggleSpeaker: () => void;
  clearError: () => void;
}

const DirectCallContext = createContext<DirectCallContextValue>({
  phase: 'idle',
  activeCall: null,
  incomingCall: null,
  localStream: null,
  remoteStream: null,
  micMuted: false,
  camOff: false,
  speakerMuted: false,
  audioOnlyFallback: false,
  peerMediaState: { micMuted: false, camOff: false, audioOnly: false },
  durationSeconds: 0,
  callError: null,
  callsHistory: [],
  supportAgents: [],
  startCall: async () => {},
  acceptCall: async () => {},
  rejectCall: async () => {},
  endCall: async () => {},
  toggleMic: () => {},
  toggleCamera: async () => {},
  switchToAudioOnly: () => {},
  toggleSpeaker: () => {},
  clearError: () => {},
});

const STAFF_ROLES = new Set([
  'support_agent',
  'company_admin',
  'super_admin',
  'it_admin',
  'department_manager',
  'hr_manager',
]);

export const DirectCallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { profile, getToken } = useAuth();
  const { onlineUsers, send: wsSend, subscribe: wsSubscribe } = useWebSocket();

  const [phase, setPhase] = useState<DirectCallPhase>('idle');
  const [activeCall, setActiveCall] = useState<CallRecord | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCallPayload | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const [audioOnlyFallback, setAudioOnlyFallback] = useState(false);
  const [peerMediaState, setPeerMediaState] = useState({ micMuted: false, camOff: false, audioOnly: false });
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [callError, setCallError] = useState<string | null>(null);

  const [callsHistory, setCallsHistory] = useState<CallRecord[]>([]);
  const [supportAgents, setSupportAgents] = useState<SupportAgentInfo[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remotePeerUidRef = useRef<string | null>(null);
  const activeCallRef = useRef<CallRecord | null>(null);
  const incomingCallRef = useRef<IncomingCallPayload | null>(null);
  const phaseRef = useRef<DirectCallPhase>('idle');
  const iceQueueRef = useRef<RTCIceCandidateInit[]>([]);
  const missedTimerRef = useRef<number | null>(null);
  const durationTimerRef = useRef<number | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const ringtoneTimerRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  const stopRingtone = useCallback(() => {
    if (ringtoneTimerRef.current) {
      window.clearInterval(ringtoneTimerRef.current);
      ringtoneTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  const startRingtone = useCallback(() => {
    stopRingtone();
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const playBeep = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(523.25, ctx.currentTime);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.45);
      };
      playBeep();
      ringtoneTimerRef.current = window.setInterval(playBeep, 2400);
    } catch {
      // Browser autoplay policy may block oscillator before gesture
    }
  }, [stopRingtone]);

  const cleanupMediaAndPeer = useCallback(() => {
    stopRingtone();
    if (missedTimerRef.current) {
      window.clearTimeout(missedTimerRef.current);
      missedTimerRef.current = null;
    }
    if (durationTimerRef.current) {
      window.clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    iceQueueRef.current = [];
    remotePeerUidRef.current = null;
    connectedAtRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setMicMuted(false);
    setCamOff(false);
    setSpeakerMuted(false);
    setAudioOnlyFallback(false);
    setPeerMediaState({ micMuted: false, camOff: false, audioOnly: false });
    setDurationSeconds(0);
    setActiveCall(null);
    setIncomingCall(null);
    setPhase('idle');
  }, [stopRingtone]);

  // Subscribe to support directory for customer call routing & availability visibility
  useEffect(() => {
    if (!profile) return;
    const unsub = onSnapshot(doc(db, 'publicConfig', 'supportRouting'), (snap) => {
      if (snap.exists()) {
        const list = (snap.data().supportAgents || []) as SupportAgentInfo[];
        setSupportAgents(list);
      }
    });
    return () => unsub();
  }, [profile?.uid]);

  // Subscribe to call history in Firestore (staff sees all, customers see caller/callee records merged)
  useEffect(() => {
    if (!profile) {
      setCallsHistory([]);
      return;
    }
    const isStaff = profile.accountType === 'employee' && STAFF_ROLES.has(profile.role);
    if (isStaff) {
      return onSnapshot(
        collection(db, 'calls'),
        (snap) => {
          setCallsHistory(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<CallRecord, 'id'>) }))
              .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
          );
        },
        () => {}
      );
    }

    const byCaller = new Map<string, CallRecord>();
    const byCallee = new Map<string, CallRecord>();
    const mergeAndSet = () => {
      const merged = new Map<string, CallRecord>([...byCaller, ...byCallee]);
      setCallsHistory(Array.from(merged.values()).sort((a, b) => b.startedAt.localeCompare(a.startedAt)));
    };

    const u1 = onSnapshot(
      query(collection(db, 'calls'), where('callerUid', '==', profile.uid)),
      (snap) => {
        byCaller.clear();
        snap.docs.forEach((d) => byCaller.set(d.id, { id: d.id, ...(d.data() as Omit<CallRecord, 'id'>) }));
        mergeAndSet();
      },
      () => {}
    );
    const u2 = onSnapshot(
      query(collection(db, 'calls'), where('calleeUid', '==', profile.uid)),
      (snap) => {
        byCallee.clear();
        snap.docs.forEach((d) => byCallee.set(d.id, { id: d.id, ...(d.data() as Omit<CallRecord, 'id'>) }));
        mergeAndSet();
      },
      () => {}
    );

    return () => {
      u1();
      u2();
    };
  }, [profile?.uid, profile?.accountType, profile?.role]);

  const acquireUserMedia = useCallback(async (wantVideo: boolean): Promise<{ stream: MediaStream; fallbackAudioOnly: boolean }> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: wantVideo });
      return { stream, fallbackAudioOnly: !wantVideo };
    } catch (err) {
      if (wantVideo) {
        try {
          const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
          setCallError('Camera was unavailable. Connected using Audio-Only fallback.');
          return { stream: audioStream, fallbackAudioOnly: true };
        } catch {
          throw err;
        }
      }
      throw err;
    }
  }, []);

  const createConfiguredPeerConnection = useCallback(
    async (callId: string, targetUid: string, stream: MediaStream) => {
      const rtcConfig = await fetchRtcConfiguration(getToken);
      const pc = new RTCPeerConnection(rtcConfig);
      pcRef.current = pc;

      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const inbound = new MediaStream();
      setRemoteStream(inbound);

      pc.ontrack = (ev) => {
        ev.streams[0]?.getTracks().forEach((t) => inbound.addTrack(t));
        setRemoteStream(new MediaStream(inbound.getTracks()));
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          wsSend({
            type: 'call:webrtc-ice',
            callId,
            targetUid,
            candidate: ev.candidate.toJSON(),
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'connected' && !connectedAtRef.current) {
          connectedAtRef.current = Date.now();
        }
      };

      return pc;
    },
    [getToken, wsSend]
  );

  const startDurationTimer = useCallback(() => {
    connectedAtRef.current = Date.now();
    if (durationTimerRef.current) window.clearInterval(durationTimerRef.current);
    durationTimerRef.current = window.setInterval(() => {
      if (connectedAtRef.current) {
        setDurationSeconds(Math.floor((Date.now() - connectedAtRef.current) / 1000));
      }
    }, 1000);
  }, []);

  const startCall = useCallback(
    async ({ targetUid, targetName, callType, orderId, targetQueue }: StartCallInput) => {
      if (!profile) return;
      if (phaseRef.current !== 'idle') {
        setCallError('Please finish or close the current call before starting a new one.');
        return;
      }
      setCallError(null);
      try {
        const { stream, fallbackAudioOnly } = await acquireUserMedia(callType === 'video');
        localStreamRef.current = stream;
        setLocalStream(stream);
        setAudioOnlyFallback(fallbackAudioOnly);
        setCamOff(fallbackAudioOnly || callType === 'audio');

        const now = new Date().toISOString();
        const callData: Omit<CallRecord, 'id' | 'createdAt' | 'updatedAt'> = {
          callerUid: profile.uid,
          callerName: profile.fullName,
          callerRole: profile.role,
          calleeUid: targetUid,
          calleeName: targetName,
          callType,
          status: 'ringing',
          ...(orderId ? { orderId } : {}),
          startedAt: now,
        };
        const callId = await createCallRecord(callData);
        const fullCall: CallRecord = { id: callId, ...callData, createdAt: now, updatedAt: now };
        setActiveCall(fullCall);
        setPhase('calling');
        remotePeerUidRef.current = targetUid;
        startRingtone();

        wsSend({
          type: 'call:invite',
          callId,
          callType,
          targetUid,
          targetQueue: Boolean(targetQueue) || targetUid === 'support_queue',
          ...(orderId ? { orderId } : {}),
        });

        // Persistent push notifications to target agent(s)
        const notifyRecipients =
          targetUid === 'support_queue' || targetQueue
            ? supportAgents.filter((a) => a.availability !== 'dnd').map((a) => a.uid).slice(0, 6)
            : [targetUid];

        notifyRecipients.forEach((uid) => {
          createNotification(
            uid,
            'call',
            `Incoming ${callType === 'video' ? 'Video' : 'Audio'} Call`,
            `${profile.fullName} is calling${orderId ? ' regarding an order' : ''}.`,
            'calls',
            callId
          ).catch(() => {});
        });

        // Mark missed if unanswered after 35 seconds
        missedTimerRef.current = window.setTimeout(async () => {
          if (phaseRef.current === 'calling' && activeCallRef.current?.id === callId) {
            const endedAt = new Date().toISOString();
            await updateCallRecord(callId, {
              status: 'missed',
              endedAt,
              durationSeconds: 0,
              endReason: 'No answer',
            }).catch(() => {});
            notifyRecipients.forEach((uid) => {
              createNotification(
                uid,
                'call',
                `Missed ${callType === 'video' ? 'Video' : 'Audio'} Call`,
                `Missed call from ${profile.fullName}.`,
                'calls',
                callId
              ).catch(() => {});
            });
            wsSend({ type: 'call:end', callId, targetUid, reason: 'missed' });
            setCallError('No answer. The call was logged as missed.');
            cleanupMediaAndPeer();
          }
        }, 35_000);
      } catch (err) {
        cleanupMediaAndPeer();
        setCallError(
          err instanceof Error
            ? `Microphone/Camera permission required: ${err.message}`
            : 'Unable to access microphone or camera.'
        );
      }
    },
    [profile, acquireUserMedia, supportAgents, wsSend, startRingtone, cleanupMediaAndPeer]
  );

  const acceptCall = useCallback(
    async (overrideAudioOnly = false) => {
      const inc = incomingCallRef.current;
      if (!profile || !inc) return;
      stopRingtone();
      setCallError(null);
      try {
        const wantVideo = inc.callType === 'video' && !overrideAudioOnly;
        const { stream, fallbackAudioOnly } = await acquireUserMedia(wantVideo);
        localStreamRef.current = stream;
        setLocalStream(stream);
        setAudioOnlyFallback(fallbackAudioOnly);
        setCamOff(fallbackAudioOnly || inc.callType === 'audio');

        remotePeerUidRef.current = inc.callerUid;
        await createConfiguredPeerConnection(inc.callId, inc.callerUid, stream);

        const now = new Date().toISOString();
        await updateCallRecord(inc.callId, {
          status: 'active',
          answeredByUid: profile.uid,
          answeredByName: profile.fullName,
          answeredAt: now,
        });

        setActiveCall({
          id: inc.callId,
          callerUid: inc.callerUid,
          callerName: inc.callerName,
          callerRole: inc.callerRole,
          calleeUid: inc.targetUid,
          calleeName: profile.fullName,
          answeredByUid: profile.uid,
          answeredByName: profile.fullName,
          callType: inc.callType,
          status: 'active',
          orderId: inc.orderId,
          startedAt: inc.startedAt,
          answeredAt: now,
          createdAt: inc.startedAt,
          updatedAt: now,
        });
        setIncomingCall(null);
        setPhase('active');
        startDurationTimer();

        wsSend({
          type: 'call:accept',
          callId: inc.callId,
          targetUid: inc.callerUid,
        });
      } catch (err) {
        setCallError(err instanceof Error ? err.message : 'Unable to answer call.');
      }
    },
    [profile, stopRingtone, acquireUserMedia, createConfiguredPeerConnection, startDurationTimer, wsSend]
  );

  const rejectCall = useCallback(
    async (reason = 'Declined') => {
      const inc = incomingCallRef.current;
      if (!inc) return;
      stopRingtone();
      wsSend({
        type: 'call:reject',
        callId: inc.callId,
        targetUid: inc.callerUid,
        reason,
      });
      await updateCallRecord(inc.callId, {
        status: 'rejected',
        endedAt: new Date().toISOString(),
        endReason: reason,
      }).catch(() => {});
      setIncomingCall(null);
      setPhase('idle');
    },
    [stopRingtone, wsSend]
  );

  const endCall = useCallback(
    async (reason = 'Ended by participant') => {
      const current = activeCallRef.current;
      const peerUid = remotePeerUidRef.current || current?.calleeUid;
      const elapsed = connectedAtRef.current ? Math.floor((Date.now() - connectedAtRef.current) / 1000) : 0;
      const wasRinging = phaseRef.current === 'calling';

      if (current) {
        wsSend({
          type: 'call:end',
          callId: current.id,
          targetUid: peerUid || 'support_queue',
          reason: wasRinging ? 'cancelled' : reason,
        });
        await updateCallRecord(current.id, {
          status: wasRinging ? 'cancelled' : 'ended',
          endedAt: new Date().toISOString(),
          durationSeconds: elapsed,
          endReason: wasRinging ? 'Caller cancelled before answer' : reason,
        }).catch(() => {});
      }
      cleanupMediaAndPeer();
    },
    [wsSend, cleanupMediaAndPeer]
  );

  const toggleMic = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const nextMuted = !micMuted;
    stream.getAudioTracks().forEach((t) => {
      t.enabled = !nextMuted;
    });
    setMicMuted(nextMuted);
    if (activeCallRef.current && remotePeerUidRef.current) {
      wsSend({
        type: 'call:media-state',
        callId: activeCallRef.current.id,
        targetUid: remotePeerUidRef.current,
        micMuted: nextMuted,
        camOff,
        audioOnly: audioOnlyFallback,
      });
    }
  }, [micMuted, camOff, audioOnlyFallback, wsSend]);

  const toggleCamera = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTracks = stream.getVideoTracks();
    if (videoTracks.length === 0) {
      setCallError('No camera video track active (audio-only mode).');
      return;
    }
    const nextOff = !camOff;
    videoTracks.forEach((t) => {
      t.enabled = !nextOff;
    });
    setCamOff(nextOff);
    if (activeCallRef.current && remotePeerUidRef.current) {
      wsSend({
        type: 'call:media-state',
        callId: activeCallRef.current.id,
        targetUid: remotePeerUidRef.current,
        micMuted,
        camOff: nextOff,
        audioOnly: audioOnlyFallback,
      });
    }
  }, [camOff, micMuted, audioOnlyFallback, wsSend]);

  const switchToAudioOnly = useCallback(() => {
    const stream = localStreamRef.current;
    if (stream) {
      stream.getVideoTracks().forEach((t) => {
        t.enabled = false;
      });
    }
    setCamOff(true);
    setAudioOnlyFallback(true);
    if (activeCallRef.current && remotePeerUidRef.current) {
      wsSend({
        type: 'call:media-state',
        callId: activeCallRef.current.id,
        targetUid: remotePeerUidRef.current,
        micMuted,
        camOff: true,
        audioOnly: true,
      });
    }
  }, [micMuted, wsSend]);

  const toggleSpeaker = useCallback(() => {
    setSpeakerMuted((prev) => !prev);
  }, []);

  // WebSocket 1:1 call signaling listener
  useEffect(() => {
    if (!profile) return;
    return wsSubscribe(async (msg) => {
      const type = String(msg.type || '');
      if (type === 'call:incoming') {
        const payload = msg as unknown as IncomingCallPayload;
        if (payload.callerUid === profile.uid) return;
        if (phaseRef.current !== 'idle') {
          wsSend({ type: 'call:busy', callId: payload.callId, targetUid: payload.callerUid, reason: 'Busy on another call' });
          return;
        }
        setIncomingCall(payload);
        setPhase('incoming');
        startRingtone();
      } else if (type === 'call:claimed') {
        const callId = String(msg.callId || '');
        if (incomingCallRef.current?.callId === callId) {
          stopRingtone();
          setIncomingCall(null);
          setPhase('idle');
        }
      } else if (type === 'call:accepted') {
        const callId = String(msg.callId || '');
        const fromUid = String(msg.fromUid || '');
        const fromName = String(msg.fromName || 'Staff');
        if (activeCallRef.current?.id !== callId || !localStreamRef.current) return;

        stopRingtone();
        if (missedTimerRef.current) {
          window.clearTimeout(missedTimerRef.current);
          missedTimerRef.current = null;
        }
        remotePeerUidRef.current = fromUid;
        setActiveCall((prev) => (prev ? { ...prev, status: 'active', answeredByUid: fromUid, answeredByName: fromName } : prev));
        setPhase('active');
        startDurationTimer();

        const pc = await createConfiguredPeerConnection(callId, fromUid, localStreamRef.current);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        wsSend({
          type: 'call:webrtc-offer',
          callId,
          targetUid: fromUid,
          sdp: offer,
        });
      } else if (type === 'call:rejected' || type === 'call:busy') {
        const callId = String(msg.callId || '');
        if (activeCallRef.current?.id === callId) {
          setCallError(type === 'call:busy' ? 'Recipient is busy on another call.' : 'Call was declined by the recipient.');
          cleanupMediaAndPeer();
        }
      } else if (type === 'call:ended') {
        const callId = String(msg.callId || '');
        if (activeCallRef.current?.id === callId || incomingCallRef.current?.callId === callId) {
          cleanupMediaAndPeer();
        }
      } else if (type === 'call:webrtc-offer') {
        const callId = String(msg.callId || '');
        const fromUid = String(msg.fromUid || '');
        const pc = pcRef.current;
        if (!pc || activeCallRef.current?.id !== callId || !msg.sdp) return;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
        for (const cand of iceQueueRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        iceQueueRef.current = [];
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        wsSend({
          type: 'call:webrtc-answer',
          callId,
          targetUid: fromUid,
          sdp: answer,
        });
      } else if (type === 'call:webrtc-answer') {
        const callId = String(msg.callId || '');
        const pc = pcRef.current;
        if (!pc || activeCallRef.current?.id !== callId || !msg.sdp) return;
        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
        for (const cand of iceQueueRef.current) {
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        }
        iceQueueRef.current = [];
      } else if (type === 'call:webrtc-ice') {
        const callId = String(msg.callId || '');
        const pc = pcRef.current;
        if (!pc || activeCallRef.current?.id !== callId || !msg.candidate) return;
        const cand = msg.candidate as RTCIceCandidateInit;
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
        } else {
          iceQueueRef.current.push(cand);
        }
      } else if (type === 'call:media-state') {
        const callId = String(msg.callId || '');
        if (activeCallRef.current?.id !== callId) return;
        setPeerMediaState({
          micMuted: Boolean(msg.micMuted),
          camOff: Boolean(msg.camOff),
          audioOnly: Boolean(msg.audioOnly),
        });
      }
    });
  }, [profile?.uid, wsSubscribe, wsSend, startRingtone, stopRingtone, startDurationTimer, createConfiguredPeerConnection, cleanupMediaAndPeer]);

  // Enhance supportAgents with live WS online indicator
  const mergedSupportAgents = useMemo(() => {
    const onlineSet = new Set(onlineUsers.map((u) => u.uid));
    return supportAgents.map((a) => ({
      ...a,
      availability: onlineSet.has(a.uid) ? a.availability || 'available' : 'offline',
    }));
  }, [supportAgents, onlineUsers]);

  return (
    <DirectCallContext.Provider
      value={{
        phase,
        activeCall,
        incomingCall,
        localStream,
        remoteStream,
        micMuted,
        camOff,
        speakerMuted,
        audioOnlyFallback,
        peerMediaState,
        durationSeconds,
        callError,
        callsHistory,
        supportAgents: mergedSupportAgents,
        startCall,
        acceptCall,
        rejectCall,
        endCall,
        toggleMic,
        toggleCamera,
        switchToAudioOnly,
        toggleSpeaker,
        clearError: () => setCallError(null),
      }}
    >
      {children}
    </DirectCallContext.Provider>
  );
};

export function useDirectCall() {
  return useContext(DirectCallContext);
}
