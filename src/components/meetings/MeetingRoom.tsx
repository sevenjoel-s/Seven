import React, { useEffect, useRef, useState } from 'react';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import {
  Check,
  CircleDot,
  Download,
  FileText,
  Hand,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  PenTool,
  PhoneOff,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  Video,
  VideoOff,
  Wifi,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { downloadDocumentFile } from '../../lib/exportUtils';
import { db } from '../../lib/firebase';
import { uploadFileToServer } from '../../lib/firestoreActions';
import { Meeting, MeetingParticipant } from '../../types/domain';
import { DocumentPreviewModal } from '../shared/DocumentPreviewModal';

interface MeetingRoomProps {
  meeting: Meeting;
  onLeave: () => void;
}

interface RemotePeerState {
  uid: string;
  displayName: string;
  micMuted: boolean;
  camOff: boolean;
  handRaised: boolean;
  screenSharing: boolean;
  stream?: MediaStream;
}

interface WhiteboardStroke {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  color: string;
  width: number;
}

const ICE_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

export const MeetingRoom: React.FC<MeetingRoomProps> = ({ meeting, onLeave }) => {
  const { profile, getToken } = useAuth();
  const { send: wsSend, subscribe: wsSubscribe, connected: wsConnected } = useWebSocket();

  const isHost = profile?.uid === meeting.hostUid;
  const [passcodeInput, setPasscodeInput] = useState('');
  const [passcodeVerified, setPasscodeVerified] = useState(!meeting.passcode || isHost);
  const [participantDocs, setParticipantDocs] = useState<MeetingParticipant[]>([]);
  const [admitted, setAdmitted] = useState(!meeting.waitingRoomEnabled || isHost);

  const [audioOnly, setAudioOnly] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [handRaised, setHandRaised] = useState(false);
  const [screenSharing, setScreenSharing] = useState(false);
  const [networkQuality, setNetworkQuality] = useState<'good' | 'fair' | 'local'>('local');

  const [sidePanel, setSidePanel] = useState<'none' | 'chat' | 'participants' | 'whiteboard'>('none');
  const [roomChat, setRoomChat] = useState<Array<{ id: string; senderName: string; text: string; createdAt: string }>>([]);
  const [chatInput, setChatInput] = useState('');
  const [mediaNotice, setMediaNotice] = useState<string | null>(null);

  // Documents modal inside room
  const [showDocsModal, setShowDocsModal] = useState(false);
  const [docUrls, setDocUrls] = useState<string[]>(meeting.documentUrls || []);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);

  // Recording with consent
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlobUrl, setRecordedBlobUrl] = useState<string | null>(null);

  // Whiteboard
  const [wbColor, setWbColor] = useState('#082B59');
  const [wbWidth, setWbWidth] = useState(3);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 });
  const strokesRef = useRef<WhiteboardStroke[]>([]);

  const [remotePeers, setRemotePeers] = useState<Record<string, RemotePeerState>>({});
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordChunksRef = useRef<Blob[]>([]);
  const joinTimestampRef = useRef<number>(Date.now());

  // Sync live meeting document URLs from Firestore
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'meetings', meeting.id), (snap) => {
      if (snap.exists()) {
        const data = snap.data() as Partial<Meeting>;
        if (Array.isArray(data.documentUrls)) {
          setDocUrls(data.documentUrls);
        }
      }
    });
    return () => unsub();
  }, [meeting.id]);

  // Listen to Firestore participants for waiting room & host controls
  useEffect(() => {
    if (!profile) return;
    const unsub = onSnapshot(
      collection(db, 'meetings', meeting.id, 'participants'),
      (snap) => {
        const list = snap.docs.map((d) => d.data() as MeetingParticipant);
        setParticipantDocs(list);
        const me = list.find((p) => p.uid === profile.uid);
        if (me) {
          if (me.status === 'admitted') setAdmitted(true);
          else if (me.status === 'rejected') {
            setMediaNotice('The host has declined admission to this meeting.');
          }
        }
      }
    );
    return () => unsub();
  }, [meeting.id, profile?.uid]);

  // Register self in participants subcollection once passcode verified
  useEffect(() => {
    if (!profile || !passcodeVerified) return;
    const now = new Date().toISOString();
    const initialStatus: MeetingParticipant['status'] =
      isHost || !meeting.waitingRoomEnabled ? 'admitted' : 'waiting';

    setDoc(
      doc(db, 'meetings', meeting.id, 'participants', profile.uid),
      {
        uid: profile.uid,
        displayName: profile.fullName,
        role: isHost ? 'host' : profile.accountType === 'external_guest' ? 'guest' : 'participant',
        status: initialStatus,
        handRaised: false,
        micMuted: false,
        camOff: false,
        recordingConsented: false,
        joinedAt: now,
        updatedAt: now,
      },
      { merge: true }
    ).catch(() => {});
  }, [meeting.id, profile?.uid, passcodeVerified, isHost, meeting.waitingRoomEnabled]);

  // Acquire local media & join WebSocket meeting room once admitted
  useEffect(() => {
    if (!admitted || !passcodeVerified || !profile) return;
    let mounted = true;
    joinTimestampRef.current = Date.now();

    const initMedia = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: !audioOnly,
        });
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        localStreamRef.current = stream;
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch {
        setMediaNotice('Camera or microphone unavailable in this browser. Connected in listen/collaboration mode.');
      }

      if (wsConnected) {
        wsSend({
          type: 'meeting:join',
          meetingId: meeting.id,
          micMuted,
          camOff: camOff || audioOnly,
        });
      }
    };

    initMedia();

    return () => {
      mounted = false;
      wsSend({ type: 'meeting:leave' });
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      peersRef.current.forEach((pc) => pc.close());
      peersRef.current.clear();
    };
  }, [admitted, passcodeVerified, wsConnected, meeting.id]);

  // Create RTCPeerConnection helper
  const createPeerConnection = (targetUid: string, displayName: string, shouldOffer: boolean) => {
    if (peersRef.current.has(targetUid)) return peersRef.current.get(targetUid)!;

    const pc = new RTCPeerConnection(ICE_CONFIG);
    peersRef.current.set(targetUid, pc);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        wsSend({ type: 'webrtc:ice', targetUid, candidate: ev.candidate });
      }
    };

    pc.ontrack = (ev) => {
      const [stream] = ev.streams;
      if (stream) {
        setRemotePeers((prev) => ({
          ...prev,
          [targetUid]: {
            ...(prev[targetUid] || {
              uid: targetUid,
              displayName,
              micMuted: false,
              camOff: false,
              handRaised: false,
              screenSharing: false,
            }),
            stream,
          },
        }));
      }
    };

    if (shouldOffer) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer).then(() => offer))
        .then((offer) => {
          wsSend({ type: 'webrtc:offer', targetUid, sdp: offer });
        })
        .catch(() => {});
    }

    return pc;
  };

  // WebSocket signaling & whiteboard listener
  useEffect(() => {
    if (!admitted || !profile) return;

    return wsSubscribe(async (msg) => {
      switch (msg.type) {
        case 'meeting:joined': {
          const peers = (msg.peers as RemotePeerState[]) || [];
          const nextMap: Record<string, RemotePeerState> = {};
          peers
            .filter((p) => p.uid !== profile.uid)
            .forEach((p) => {
              nextMap[p.uid] = p;
              createPeerConnection(p.uid, p.displayName, true);
            });
          setRemotePeers(nextMap);
          const strokes = (msg.whiteboard as WhiteboardStroke[]) || [];
          strokesRef.current = strokes;
          redrawCanvas();
          break;
        }

        case 'meeting:peer-joined': {
          const peer = msg.peer as RemotePeerState;
          if (!peer || peer.uid === profile.uid) return;
          setRemotePeers((prev) => ({ ...prev, [peer.uid]: peer }));
          break;
        }

        case 'meeting:peer-left': {
          const uid = String(msg.uid || '');
          peersRef.current.get(uid)?.close();
          peersRef.current.delete(uid);
          setRemotePeers((prev) => {
            const copy = { ...prev };
            delete copy[uid];
            return copy;
          });
          break;
        }

        case 'webrtc:offer': {
          const fromUid = String(msg.fromUid || '');
          const fromName = String(msg.fromName || 'Participant');
          const pc = createPeerConnection(fromUid, fromName, false);
          await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          wsSend({ type: 'webrtc:answer', targetUid: fromUid, sdp: answer });
          break;
        }

        case 'webrtc:answer': {
          const fromUid = String(msg.fromUid || '');
          const pc = peersRef.current.get(fromUid);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp as RTCSessionDescriptionInit));
          }
          break;
        }

        case 'webrtc:ice': {
          const fromUid = String(msg.fromUid || '');
          const pc = peersRef.current.get(fromUid);
          if (pc && msg.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(msg.candidate as RTCIceCandidateInit)).catch(() => {});
          }
          break;
        }

        case 'meeting:media-state': {
          const uid = String(msg.uid || '');
          setRemotePeers((prev) => {
            const existing = prev[uid];
            if (!existing) return prev;
            return {
              ...prev,
              [uid]: {
                ...existing,
                micMuted: Boolean(msg.micMuted),
                camOff: Boolean(msg.camOff),
                handRaised: Boolean(msg.handRaised),
                screenSharing: Boolean(msg.screenSharing),
              },
            };
          });
          break;
        }

        case 'meeting:host-action': {
          if (msg.targetUid === profile.uid) {
            if (msg.action === 'mute') {
              localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = false));
              setMicMuted(true);
              wsSend({ type: 'meeting:media-state', micMuted: true, camOff, handRaised, screenSharing });
            } else if (msg.action === 'remove') {
              handleExitMeeting();
            }
          }
          break;
        }

        case 'meeting:chat': {
          setRoomChat((prev) => [
            ...prev,
            {
              id: String(msg.id || Math.random()),
              senderName: String(msg.senderName || 'User'),
              text: String(msg.text || ''),
              createdAt: String(msg.createdAt || new Date().toISOString()),
            },
          ]);
          break;
        }

        case 'meeting:whiteboard-stroke': {
          const stroke = msg.stroke as WhiteboardStroke;
          if (stroke) {
            strokesRef.current.push(stroke);
            drawStrokeOnCanvas(stroke);
          }
          break;
        }

        case 'meeting:whiteboard-clear': {
          strokesRef.current = [];
          redrawCanvas();
          break;
        }
      }
    });
  }, [admitted, profile?.uid, wsSubscribe]);

  // Network quality telemetry via RTCPeerConnection.getStats()
  useEffect(() => {
    const timer = window.setInterval(async () => {
      const firstPc = Array.from(peersRef.current.values())[0];
      if (!firstPc) {
        setNetworkQuality('local');
        return;
      }
      try {
        const stats = await firstPc.getStats();
        let rtt = 0;
        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.state === 'succeeded' && report.currentRoundTripTime) {
            rtt = report.currentRoundTripTime * 1000;
          }
        });
        setNetworkQuality(rtt > 250 ? 'fair' : 'good');
      } catch {
        setNetworkQuality('good');
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const drawStrokeOnCanvas = (s: WhiteboardStroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x0, s.y0);
    ctx.lineTo(s.x1, s.y1);
    ctx.stroke();
  };

  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach(drawStrokeOnCanvas);
  };

  useEffect(() => {
    if (sidePanel === 'whiteboard') {
      window.setTimeout(redrawCanvas, 50);
    }
  }, [sidePanel]);

  const toggleMic = () => {
    const next = !micMuted;
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMicMuted(next);
    wsSend({ type: 'meeting:media-state', micMuted: next, camOff, handRaised, screenSharing });
  };

  const toggleCam = () => {
    const next = !camOff;
    localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = !next));
    setCamOff(next);
    wsSend({ type: 'meeting:media-state', micMuted, camOff: next, handRaised, screenSharing });
  };

  const toggleAudioOnly = () => {
    const next = !audioOnly;
    setAudioOnly(next);
    if (next) {
      localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = false));
      setCamOff(true);
    } else {
      localStreamRef.current?.getVideoTracks().forEach((t) => (t.enabled = true));
      setCamOff(false);
    }
    wsSend({ type: 'meeting:media-state', micMuted, camOff: next, handRaised, screenSharing });
  };

  const toggleHand = () => {
    const next = !handRaised;
    setHandRaised(next);
    wsSend({ type: 'meeting:media-state', micMuted, camOff, handRaised: next, screenSharing });
  };

  const toggleScreenShare = async () => {
    if (screenSharing && screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      const camTrack = localStreamRef.current?.getVideoTracks()[0];
      if (camTrack) {
        peersRef.current.forEach((pc) => {
          const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (sender) sender.replaceTrack(camTrack);
        });
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      }
      setScreenSharing(false);
      wsSend({ type: 'meeting:media-state', micMuted, camOff, handRaised, screenSharing: false });
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const screenTrack = displayStream.getVideoTracks()[0];
      screenStreamRef.current = displayStream;
      peersRef.current.forEach((pc) => {
        const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(screenTrack);
      });
      if (localVideoRef.current) localVideoRef.current.srcObject = displayStream;
      setScreenSharing(true);
      wsSend({ type: 'meeting:media-state', micMuted, camOff, handRaised, screenSharing: true });
      screenTrack.onended = () => {
        setScreenSharing(false);
        if (localVideoRef.current) localVideoRef.current.srcObject = localStreamRef.current;
      };
    } catch {
      setMediaNotice('Screen sharing cancelled or unavailable.');
    }
  };

  const startRecordingWithConsent = async () => {
    setShowConsentModal(false);
    if (!profile) return;
    await updateDoc(doc(db, 'meetings', meeting.id, 'participants', profile.uid), {
      recordingConsented: true,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});

    const streamToRecord = screenStreamRef.current || localStreamRef.current;
    if (!streamToRecord) {
      setMediaNotice('No active audio or video stream available to record.');
      return;
    }
    try {
      const rec = new MediaRecorder(streamToRecord);
      recordChunksRef.current = [];
      rec.ondataavailable = (ev) => {
        if (ev.data.size > 0) recordChunksRef.current.push(ev.data);
      };
      rec.onstop = () => {
        const blob = new Blob(recordChunksRef.current, { type: 'video/webm' });
        setRecordedBlobUrl(URL.createObjectURL(blob));
        setIsRecording(false);
      };
      rec.start();
      recorderRef.current = rec;
      setIsRecording(true);
    } catch {
      setMediaNotice('Browser recording is unsupported for the current stream.');
    }
  };

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const handleExitMeeting = async () => {
    if (profile) {
      const durationSeconds = Math.max(1, Math.round((Date.now() - joinTimestampRef.current) / 1000));
      await updateDoc(doc(db, 'meetings', meeting.id, 'participants', profile.uid), {
        status: 'left',
        durationSeconds,
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
    onLeave();
  };

  const handleAdmit = async (uid: string, allow: boolean) => {
    await updateDoc(doc(db, 'meetings', meeting.id, 'participants', uid), {
      status: allow ? 'admitted' : 'rejected',
      updatedAt: new Date().toISOString(),
    });
  };

  const handleUploadMeetingDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !isHost) return;
    setUploadingDoc(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Session expired');
      const res = await uploadFileToServer(file, token);
      await updateDoc(doc(db, 'meetings', meeting.id), {
        documentUrls: arrayUnion(res.url),
        updatedAt: new Date().toISOString(),
      });
      setMediaNotice(`Attached document "${res.name}" to meeting room.`);
    } catch (err) {
      setMediaNotice(err instanceof Error ? err.message : 'Document upload failed.');
    } finally {
      setUploadingDoc(false);
      if (docFileInputRef.current) docFileInputRef.current.value = '';
    }
  };

  const handleRemoveDoc = async (url: string) => {
    if (!isHost) return;
    await updateDoc(doc(db, 'meetings', meeting.id), {
      documentUrls: arrayRemove(url),
      updatedAt: new Date().toISOString(),
    });
  };

  if (!passcodeVerified) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 max-w-md mx-auto my-10 space-y-4">
        <div className="flex items-center gap-2 text-[#1178B9]">
          <ShieldCheck className="w-5 h-5" />
          <h3 className="text-lg font-semibold text-[#15243A] dark:text-slate-100">Meeting Passcode Required</h3>
        </div>
        <p className="text-xs text-[#293858] dark:text-slate-400">
          Enter the passcode provided by {meeting.hostName} to join <strong>{meeting.title}</strong>.
        </p>
        <input
          type="password"
          value={passcodeInput}
          onChange={(e) => setPasscodeInput(e.target.value)}
          placeholder="Enter meeting passcode"
          className="w-full min-h-[44px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-sm text-[#293858] dark:text-slate-100"
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onLeave} className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (passcodeInput.trim() === meeting.passcode) setPasscodeVerified(true);
              else setMediaNotice('Incorrect meeting passcode.');
            }}
            className="min-h-[44px] px-4 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
          >
            Verify & Join
          </button>
        </div>
        {mediaNotice && <p className="text-xs text-red-600">{mediaNotice}</p>}
      </div>
    );
  }

  if (!admitted) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 max-w-lg mx-auto my-10 text-center space-y-4">
        <Users className="w-10 h-10 text-[#1178B9] mx-auto" />
        <h3 className="text-xl font-semibold text-[#15243A] dark:text-slate-100">Waiting Room</h3>
        <p className="text-sm text-[#293858] dark:text-slate-300">
          You are in the waiting room for <strong>{meeting.title}</strong>. The host ({meeting.hostName}) will admit you shortly.
        </p>
        {mediaNotice && <p className="text-xs text-red-600">{mediaNotice}</p>}
        <button type="button" onClick={onLeave} className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium">
          Leave Waiting Room
        </button>
      </div>
    );
  }

  const waitingParticipants = participantDocs.filter((p) => p.status === 'waiting');
  const remoteList = Object.values(remotePeers);

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#082B59] text-white overflow-hidden flex flex-col h-[calc(100vh-11rem)] min-h-[540px]">
      {/* Room Header */}
      <div className="px-4 py-3 bg-[#082B59] border-b border-white/10 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <img
            src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
            alt="7Sunday Meet"
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-full bg-white object-contain p-0.5 shrink-0"
          />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold truncate">{meeting.title}</h3>
              <span className="font-mono text-xs text-[#087CEB] bg-white/10 px-2 py-0.5 rounded">{meeting.meetingCode}</span>
              {isRecording && <span className="text-xs text-red-300 font-medium">· Recording</span>}
            </div>
            <p className="text-xs text-[#EAF4FF]/75 truncate">
              Host: {meeting.hostName} · {remoteList.length + 1} active in room
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-[#EAF4FF]">
            <Wifi className={`w-3.5 h-3.5 ${networkQuality === 'good' ? 'text-[#087CEB]' : networkQuality === 'fair' ? 'text-amber-300' : 'text-[#EAF4FF]/70'}`} />
            {networkQuality === 'good' ? 'HD Connection' : networkQuality === 'fair' ? 'Fair Network' : 'Room Ready'}
          </span>
          {recordedBlobUrl && (
            <a
              href={recordedBlobUrl}
              download={`7SundayMeet-${meeting.meetingCode}.webm`}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white font-medium"
            >
              <Download className="w-3.5 h-3.5" />
              Save Recording
            </a>
          )}
        </div>
      </div>

      {mediaNotice && (
        <div className="px-4 py-2 bg-[#1178B9]/30 border-b border-white/10 text-xs text-[#EAF4FF] flex items-center justify-between">
          <span>{mediaNotice}</span>
          <button type="button" onClick={() => setMediaNotice(null)} aria-label="Dismiss notice">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main Stage + Optional Side Panel */}
      <div className="flex-1 flex min-h-0 relative bg-[#0B2243]">
        <div className="flex-1 p-3 sm:p-4 overflow-y-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4 auto-rows-fr">
          {/* Local Video Tile */}
          <div className="relative rounded-xl border border-white/10 bg-[#082B59] overflow-hidden flex items-center justify-center min-h-[200px]">
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              className={`w-full h-full object-cover ${camOff || audioOnly ? 'hidden' : ''}`}
            />
            {(camOff || audioOnly) && (
              <div className="flex flex-col items-center gap-2 text-[#EAF4FF]">
                <div className="w-16 h-16 rounded-full bg-[#1178B9] flex items-center justify-center text-xl font-bold">
                  {profile?.fullName?.slice(0, 2).toUpperCase()}
                </div>
                <span className="text-xs text-[#EAF4FF]/75">{audioOnly ? 'Audio-Only Mode' : 'Camera Off'}</span>
              </div>
            )}
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs bg-[#082B59]/85 px-2.5 py-1.5 rounded-lg border border-white/10">
              <span className="truncate font-medium">
                {profile?.fullName} (You){screenSharing ? ' · Sharing Screen' : ''}
              </span>
              <div className="flex items-center gap-1.5">
                {handRaised && <Hand className="w-3.5 h-3.5 text-amber-300" />}
                {micMuted ? <MicOff className="w-3.5 h-3.5 text-red-400" /> : <Mic className="w-3.5 h-3.5 text-[#087CEB]" />}
              </div>
            </div>
          </div>

          {/* Remote Peer Tiles */}
          {remoteList.map((peer) => (
            <RemoteVideoTile key={peer.uid} peer={peer} />
          ))}
        </div>

        {/* Side Drawer: Chat / Participants / Whiteboard */}
        {sidePanel !== 'none' && (
          <aside className="fixed inset-y-0 right-0 z-30 lg:static w-full sm:w-80 lg:w-96 border-l border-white/10 bg-[#15243A] flex flex-col min-h-0">
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[#EAF4FF]">
                {sidePanel === 'chat' ? 'Meeting Chat' : sidePanel === 'participants' ? 'Participants & Host Controls' : 'Collaborative Whiteboard'}
              </span>
              <button type="button" onClick={() => setSidePanel('none')} className="p-1 text-[#EAF4FF]/70 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            {sidePanel === 'chat' && (
              <>
                <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                  {roomChat.length === 0 ? (
                    <p className="text-xs text-[#EAF4FF]/60 text-center pt-6">No in-meeting messages yet.</p>
                  ) : (
                    roomChat.map((m) => (
                      <div key={m.id} className="rounded-lg bg-[#082B59] border border-white/10 p-2.5 space-y-1">
                        <div className="flex justify-between text-[11px] text-[#EAF4FF]/70">
                          <span className="font-medium text-[#087CEB]">{m.senderName}</span>
                          <span className="tabular-nums">{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <p className="text-xs text-white">{m.text}</p>
                      </div>
                    ))
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!chatInput.trim()) return;
                    wsSend({ type: 'meeting:chat', text: chatInput.trim() });
                    setChatInput('');
                  }}
                  className="p-3 border-t border-white/10 flex gap-2"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Send message to room..."
                    className="flex-1 min-h-[40px] rounded-lg bg-[#082B59] border border-white/15 px-3 py-1.5 text-xs text-white"
                  />
                  <button type="submit" className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </>
            )}

            {sidePanel === 'participants' && (
              <div className="flex-1 overflow-y-auto p-3 space-y-4">
                {isHost && waitingParticipants.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-amber-300">Waiting Room ({waitingParticipants.length})</p>
                    {waitingParticipants.map((wp) => (
                      <div key={wp.uid} className="flex items-center justify-between gap-2 rounded-lg bg-[#082B59] border border-white/10 p-2.5 text-xs">
                        <span className="truncate">{wp.displayName}</span>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={() => handleAdmit(wp.uid, true)} className="px-2 py-1 rounded bg-[#1178B9] text-white">
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => handleAdmit(wp.uid, false)} className="px-2 py-1 rounded bg-red-600 text-white">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[#EAF4FF]/70">Connected ({remoteList.length + 1})</p>
                  <div className="rounded-lg bg-[#082B59] border border-white/10 p-2.5 text-xs flex items-center justify-between">
                    <span>{profile?.fullName} (You)</span>
                    <span className="text-[#087CEB] font-medium">{isHost ? 'Host' : 'Participant'}</span>
                  </div>
                  {remoteList.map((rp) => (
                    <div key={rp.uid} className="rounded-lg bg-[#082B59] border border-white/10 p-2.5 text-xs flex items-center justify-between gap-2">
                      <span className="truncate">{rp.displayName} {rp.handRaised ? '✋' : ''}</span>
                      {isHost && (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => wsSend({ type: 'meeting:host-action', targetUid: rp.uid, action: 'mute' })}
                            className="px-2 py-1 rounded bg-[#1178B9] hover:bg-[#0D6096] text-[11px]"
                          >
                            Mute
                          </button>
                          <button
                            type="button"
                            onClick={() => wsSend({ type: 'meeting:host-action', targetUid: rp.uid, action: 'remove' })}
                            className="px-2 py-1 rounded bg-red-600 hover:bg-red-700 text-[11px]"
                          >
                            Remove
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {sidePanel === 'whiteboard' && (
              <div className="flex-1 flex flex-col p-3 gap-2 min-h-0">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {['#082B59', '#087CEB', '#dc2626', '#f59e0b', '#0f172a'].map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setWbColor(c)}
                        style={{ backgroundColor: c }}
                        className={`w-6 h-6 rounded-full border-2 ${wbColor === c ? 'border-white scale-110' : 'border-transparent'}`}
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={wbWidth}
                      onChange={(e) => setWbWidth(Number(e.target.value))}
                      className="rounded bg-[#082B59] border border-white/15 text-xs px-2 py-1"
                    >
                      <option value={2}>Thin</option>
                      <option value={4}>Medium</option>
                      <option value={8}>Bold</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        strokesRef.current = [];
                        redrawCanvas();
                        wsSend({ type: 'meeting:whiteboard-clear' });
                      }}
                      className="p-1.5 rounded bg-[#082B59] hover:bg-red-900 text-[#EAF4FF]"
                      title="Clear Whiteboard"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <canvas
                  ref={canvasRef}
                  width={340}
                  height={420}
                  onPointerDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    drawingRef.current = { active: true, x: e.clientX - rect.left, y: e.clientY - rect.top };
                  }}
                  onPointerMove={(e) => {
                    if (!drawingRef.current.active) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const nx = e.clientX - rect.left;
                    const ny = e.clientY - rect.top;
                    const stroke: WhiteboardStroke = {
                      x0: drawingRef.current.x,
                      y0: drawingRef.current.y,
                      x1: nx,
                      y1: ny,
                      color: wbColor,
                      width: wbWidth,
                    };
                    drawingRef.current.x = nx;
                    drawingRef.current.y = ny;
                    strokesRef.current.push(stroke);
                    drawStrokeOnCanvas(stroke);
                    wsSend({ type: 'meeting:whiteboard-stroke', stroke });
                  }}
                  onPointerUp={() => {
                    drawingRef.current.active = false;
                  }}
                  onPointerLeave={() => {
                    drawingRef.current.active = false;
                  }}
                  className="w-full flex-1 bg-white rounded-lg cursor-crosshair touch-none"
                />
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Responsive Controls Dock for Phones, Tablets, & Desktops */}
      <div className="px-3 py-2.5 bg-[#082B59] border-t border-white/10 pb-safe flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={toggleMic}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${
            micMuted ? 'bg-red-600 text-white' : 'bg-[#15243A] hover:bg-[#1178B9] text-white'
          }`}
        >
          {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          <span>{micMuted ? 'Unmute' : 'Mute'}</span>
        </button>

        <button
          type="button"
          onClick={toggleCam}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${
            camOff ? 'bg-red-600 text-white' : 'bg-[#15243A] hover:bg-[#1178B9] text-white'
          }`}
        >
          {camOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
          <span>{camOff ? 'Start Video' : 'Stop Video'}</span>
        </button>

        <button
          type="button"
          onClick={toggleAudioOnly}
          className={`min-h-[40px] px-3 py-2 rounded-lg text-xs font-medium ${
            audioOnly ? 'bg-[#1178B9] text-white' : 'bg-[#15243A] hover:bg-[#1178B9] text-white'
          }`}
        >
          Audio Only
        </button>

        <button
          type="button"
          onClick={toggleScreenShare}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${
            screenSharing ? 'bg-[#087CEB] text-white' : 'bg-[#15243A] hover:bg-[#1178B9] text-white'
          }`}
        >
          <MonitorUp className="w-4 h-4" />
          <span className="hidden sm:inline">{screenSharing ? 'Stop Share' : 'Share Screen'}</span>
        </button>

        <button
          type="button"
          onClick={toggleHand}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${
            handRaised ? 'bg-amber-600 text-white' : 'bg-[#15243A] hover:bg-[#1178B9] text-white'
          }`}
        >
          <Hand className="w-4 h-4" />
          <span className="hidden sm:inline">{handRaised ? 'Lower Hand' : 'Raise Hand'}</span>
        </button>

        <button
          type="button"
          onClick={() => (isRecording ? stopRecording() : setShowConsentModal(true))}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${
            isRecording ? 'bg-red-700 text-white' : 'bg-[#15243A] hover:bg-[#1178B9] text-white'
          }`}
        >
          <CircleDot className="w-4 h-4" />
          <span className="hidden sm:inline">{isRecording ? 'Stop Rec' : 'Record'}</span>
        </button>

        <button
          type="button"
          onClick={() => setSidePanel(sidePanel === 'whiteboard' ? 'none' : 'whiteboard')}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${
            sidePanel === 'whiteboard' ? 'bg-[#1178B9] text-white' : 'bg-[#15243A] hover:bg-[#1178B9] text-white'
          }`}
        >
          <PenTool className="w-4 h-4" />
          <span className="hidden md:inline">Whiteboard</span>
        </button>

        <button
          type="button"
          onClick={() => setShowDocsModal(true)}
          className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#15243A] hover:bg-[#1178B9] text-white text-xs font-medium"
        >
          <FileText className="w-4 h-4" />
          <span className="hidden md:inline">Docs ({docUrls.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setSidePanel(sidePanel === 'chat' ? 'none' : 'chat')}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${
            sidePanel === 'chat' ? 'bg-[#1178B9] text-white' : 'bg-[#15243A] hover:bg-[#1178B9] text-white'
          }`}
        >
          <MessageSquare className="w-4 h-4" />
          <span className="hidden md:inline">Chat</span>
        </button>

        <button
          type="button"
          onClick={() => setSidePanel(sidePanel === 'participants' ? 'none' : 'participants')}
          className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium ${
            sidePanel === 'participants' ? 'bg-[#1178B9] text-white' : 'bg-[#15243A] hover:bg-[#1178B9] text-white'
          }`}
        >
          <Users className="w-4 h-4" />
          <span>People ({remoteList.length + 1})</span>
        </button>

        <button
          type="button"
          onClick={handleExitMeeting}
          className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-medium"
        >
          <PhoneOff className="w-4 h-4" />
          <span>Leave</span>
        </button>
      </div>

      {/* Hidden File Input for In-Room Document Upload */}
      <input
        ref={docFileInputRef}
        type="file"
        className="hidden"
        onChange={handleUploadMeetingDoc}
      />

      {/* In-Room Printable & Downloadable Documents Modal */}
      <DocumentPreviewModal
        open={showDocsModal}
        title={`${meeting.title} — Brief & Documents`}
        subtitle={`Code: ${meeting.meetingCode} · Host: ${meeting.hostName}`}
        badge="MEETING DOC"
        onClose={() => setShowDocsModal(false)}
        onDownload={() =>
          downloadDocumentFile(
            `7SundayMeet-${meeting.meetingCode}-Brief.txt`,
            `7Sunday Meet — Meeting Brief\nTitle: ${meeting.title}\nCode: ${meeting.meetingCode}\nHost: ${meeting.hostName}\nStart: ${new Date(meeting.startTime).toLocaleString()}\n\nAgenda:\n${meeting.agenda || 'No agenda provided.'}\n\nDocuments:\n${docUrls.join('\n')}`
          )
        }
        downloadLabel="Download Brief"
        onAdd={isHost ? () => docFileInputRef.current?.click() : undefined}
        addLabel={uploadingDoc ? 'Uploading...' : 'Add File'}
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-[#F5F8FC] dark:bg-slate-800 p-4 border border-slate-200 dark:border-slate-700 space-y-1">
            <p className="text-xs font-semibold text-[#082B59] dark:text-[#EAF4FF]">Agenda</p>
            <p className="text-xs whitespace-pre-wrap">{meeting.agenda || 'No structured agenda listed.'}</p>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#082B59] dark:text-[#EAF4FF]">Attached Documents ({docUrls.length})</p>
            {docUrls.length === 0 ? (
              <p className="text-xs text-slate-500">No files attached to this meeting room yet.</p>
            ) : (
              docUrls.map((url, idx) => (
                <div key={url} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs">
                  <a href={url} download className="text-[#1178B9] hover:underline truncate flex-1">
                    Document #{idx + 1} — {url.split('/').pop()}
                  </a>
                  {isHost && (
                    <button
                      type="button"
                      onClick={() => handleRemoveDoc(url)}
                      className="text-red-600 hover:text-red-700 px-2 py-1 rounded border border-red-200 dark:border-red-900"
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </DocumentPreviewModal>

      {/* Recording Consent Modal */}
      {showConsentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="max-w-sm w-full rounded-xl bg-[#15243A] border border-white/15 p-6 space-y-4">
            <h4 className="text-base font-semibold">Participant Recording Consent</h4>
            <p className="text-xs text-[#EAF4FF]/80 leading-relaxed">
              Recording captures audio/video from your active session. By proceeding, you confirm participant consent is granted and your consent timestamp is recorded in meeting attendance.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowConsentModal(false)} className="min-h-[40px] px-3 py-1.5 rounded-lg border border-white/20 text-xs">
                Cancel
              </button>
              <button type="button" onClick={startRecordingWithConsent} className="min-h-[40px] px-4 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium">
                I Consent & Start Recording
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const RemoteVideoTile: React.FC<{ peer: RemotePeerState }> = ({ peer }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div className="relative rounded-xl border border-white/10 bg-[#082B59] overflow-hidden flex items-center justify-center min-h-[200px]">
      {peer.stream && !peer.camOff ? (
        <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      ) : (
        <div className="flex flex-col items-center gap-2 text-[#EAF4FF]">
          <div className="w-16 h-16 rounded-full bg-[#293858] flex items-center justify-center text-xl font-bold">
            {peer.displayName.slice(0, 2).toUpperCase()}
          </div>
          <span className="text-xs text-[#EAF4FF]/70">{peer.camOff ? 'Camera Off' : 'Connecting Audio/Video...'}</span>
        </div>
      )}
      <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-xs bg-[#082B59]/85 px-2.5 py-1.5 rounded-lg border border-white/10">
        <span className="truncate font-medium">
          {peer.displayName}{peer.screenSharing ? ' · Presenting' : ''}
        </span>
        <div className="flex items-center gap-1.5">
          {peer.handRaised && <Hand className="w-3.5 h-3.5 text-amber-300" />}
          {peer.micMuted ? <MicOff className="w-3.5 h-3.5 text-red-400" /> : <Mic className="w-3.5 h-3.5 text-[#087CEB]" />}
        </div>
      </div>
    </div>
  );
};
