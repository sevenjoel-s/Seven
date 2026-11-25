import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Headphones,
  Maximize2,
  Mic,
  MicOff,
  Minimize2,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  Radio,
  UserCheck,
  Video,
  VideoOff,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDirectCall } from '../../context/DirectCallContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { CustomerOrder, UserAccount } from '../../types/domain';

interface DirectCallPanelProps {
  mode: 'customer' | 'staff';
  defaultCallType?: 'audio' | 'video';
  orders?: CustomerOrder[];
  customers?: UserAccount[];
  onToggleAvailability?: (available: boolean) => void;
}

function formatDuration(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const DirectCallPanel: React.FC<DirectCallPanelProps> = ({
  mode,
  defaultCallType = 'audio',
  orders = [],
  customers = [],
  onToggleAvailability,
}) => {
  const { profile } = useAuth();
  const { onlineUsers } = useWebSocket();
  const {
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
    supportAgents,
    startCall,
    acceptCall,
    rejectCall,
    endCall,
    toggleMic,
    toggleCamera,
    switchToAudioOnly,
    toggleSpeaker,
    clearError,
  } = useDirectCall();

  const [selectedOrderId, setSelectedOrderId] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'audio' | 'video' | 'missed'>('all');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream, phase]);

  useEffect(() => {
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStream;
      remoteVideoRef.current.muted = speakerMuted;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.muted = speakerMuted;
    }
  }, [remoteStream, speakerMuted, phase]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!stageRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await stageRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Ignore fullscreen denial on restricted iframes
    }
  };

  const onlineUidSet = useMemo(() => new Set(onlineUsers.map((u) => u.uid)), [onlineUsers]);

  const filteredHistory = useMemo(() => {
    return callsHistory.filter((c) => {
      if (historyFilter === 'audio') return c.callType === 'audio';
      if (historyFilter === 'video') return c.callType === 'video';
      if (historyFilter === 'missed') return c.status === 'missed' || c.status === 'rejected';
      return true;
    });
  }, [callsHistory, historyFilter]);

  const missedCount = useMemo(
    () => callsHistory.filter((c) => c.status === 'missed').length,
    [callsHistory]
  );

  const isVideoMode = defaultCallType === 'video';
  const activeIsVideo = activeCall?.callType === 'video' && !audioOnlyFallback;

  return (
    <div className="space-y-6">
      {callError && (
        <div className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3 text-xs text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2">
          <span>{callError}</span>
          <button type="button" onClick={clearError} className="p-1"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      {/* Active / Calling Stage */}
      {(phase === 'calling' || phase === 'active') && activeCall && (
        <div
          ref={stageRef}
          className="rounded-2xl border border-[#1178B9]/40 bg-[#082B59] text-white p-5 space-y-4 shadow-xl"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#1178B9] flex items-center justify-center">
                {activeIsVideo ? <Video className="w-5 h-5" /> : <PhoneCall className="w-5 h-5 animate-pulse" />}
              </div>
              <div>
                <p className="text-xs text-[#EAF4FF]/80 uppercase tracking-wider font-semibold">
                  {phase === 'calling' ? 'Ringing...' : activeIsVideo ? 'Live Video Call' : 'Live Voice Call'}
                </p>
                <p className="text-sm font-bold">
                  {activeCall.callerUid === profile?.uid ? activeCall.answeredByName || activeCall.calleeName : activeCall.callerName}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1 rounded-lg bg-white/10 font-mono text-sm font-semibold tabular-nums">
                {phase === 'calling' ? 'Dialing' : formatDuration(durationSeconds)}
              </span>
              {activeCall.callType === 'video' && (
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  aria-label="Toggle fullscreen video"
                  className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-white/20 hover:bg-white/10"
                >
                  {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                </button>
              )}
            </div>
          </div>

          <audio ref={remoteAudioRef} autoPlay playsInline className="hidden" />

          {activeIsVideo ? (
            <div className="relative rounded-xl overflow-hidden bg-slate-950 aspect-video max-h-[460px] w-full flex items-center justify-center">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="w-full h-full object-cover"
              />
              {(!remoteStream || peerMediaState.camOff || peerMediaState.audioOnly) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#082B59]/90 text-center p-4 gap-2">
                  <Headphones className="w-10 h-10 text-[#EAF4FF]" />
                  <p className="text-sm font-semibold">
                    {phase === 'calling'
                      ? 'Waiting for recipient to answer...'
                      : peerMediaState.audioOnly || peerMediaState.camOff
                      ? 'Peer camera is off — Audio Active'
                      : 'Connecting video stream...'}
                  </p>
                </div>
              )}

              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className={`absolute bottom-3 right-3 w-36 sm:w-44 aspect-video rounded-lg object-cover border-2 border-white/30 bg-slate-900 ${
                  camOff ? 'hidden' : 'block'
                }`}
              />
            </div>
          ) : (
            <div className="rounded-xl bg-[#293858] p-8 flex flex-col items-center justify-center gap-3 text-center">
              <div className="w-16 h-16 rounded-full bg-[#1178B9]/30 border border-[#087CEB] flex items-center justify-center">
                <Radio className="w-7 h-7 text-[#EAF4FF] animate-pulse" />
              </div>
              <p className="text-sm font-medium">
                {phase === 'calling'
                  ? 'Calling Seven Sunday Customer Service...'
                  : audioOnlyFallback
                  ? 'Audio-Only Call Active'
                  : '1:1 Encrypted Voice Call Active'}
              </p>
              {peerMediaState.micMuted && (
                <p className="text-xs text-[#EAF4FF]/75">Remote participant has muted their microphone</p>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <button
              type="button"
              onClick={toggleMic}
              className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold ${
                micMuted ? 'bg-amber-500 text-slate-950' : 'bg-white/15 hover:bg-white/25 text-white'
              }`}
            >
              {micMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              {micMuted ? 'Unmute Mic' : 'Mute Mic'}
            </button>

            <button
              type="button"
              onClick={toggleSpeaker}
              className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold ${
                speakerMuted ? 'bg-amber-500 text-slate-950' : 'bg-white/15 hover:bg-white/25 text-white'
              }`}
            >
              {speakerMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              {speakerMuted ? 'Speaker Off' : 'Speaker On'}
            </button>

            {activeCall.callType === 'video' && !audioOnlyFallback && (
              <>
                <button
                  type="button"
                  onClick={toggleCamera}
                  className={`min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold ${
                    camOff ? 'bg-amber-500 text-slate-950' : 'bg-white/15 hover:bg-white/25 text-white'
                  }`}
                >
                  {camOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                  {camOff ? 'Turn Camera On' : 'Turn Camera Off'}
                </button>
                <button
                  type="button"
                  onClick={switchToAudioOnly}
                  className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold"
                >
                  <Phone className="w-4 h-4" />
                  Audio-Only Mode
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => endCall()}
              className="min-h-[44px] inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
            >
              <PhoneOff className="w-4 h-4" />
              End Call
            </button>
          </div>
        </div>
      )}

      {/* Incoming Call Inline Prompt inside Call Tab */}
      {phase === 'incoming' && incomingCall && (
        <div className="rounded-xl border border-[#087CEB] bg-[#EAF4FF] dark:bg-[#082B59]/50 p-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#1178B9] text-white flex items-center justify-center animate-bounce">
              {incomingCall.callType === 'video' ? <Video className="w-5 h-5" /> : <PhoneIncoming className="w-5 h-5" />}
            </div>
            <div>
              <p className="text-xs font-semibold text-[#1178B9]">
                Incoming {incomingCall.callType === 'video' ? 'Video' : 'Audio'} Call
              </p>
              <p className="text-sm font-bold text-[#082B59] dark:text-white">{incomingCall.callerName}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => acceptCall(false)}
              className="min-h-[42px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
            >
              Accept Call
            </button>
            {incomingCall.callType === 'video' && (
              <button
                type="button"
                onClick={() => acceptCall(true)}
                className="min-h-[42px] px-3 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-semibold"
              >
                Audio Only
              </button>
            )}
            <button
              type="button"
              onClick={() => rejectCall('Declined')}
              className="min-h-[42px] px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
            >
              Reject
            </button>
          </div>
        </div>
      )}

      {/* Dialer Section */}
      {mode === 'customer' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#EAF4FF] dark:bg-[#082B59] text-[#1178B9] flex items-center justify-center">
                {isVideoMode ? <Video className="w-5 h-5" /> : <Phone className="w-5 h-5" />}
              </div>
              <div>
                <h2 className="text-base font-bold text-[#15243A] dark:text-slate-100">
                  {isVideoMode ? '1:1 Customer Video Support' : '1:1 Customer Voice Support'}
                </h2>
                <p className="text-xs text-slate-500">
                  Connect directly with authorized Seven Sunday PLC staff over encrypted WebRTC.
                </p>
              </div>
            </div>

            {orders.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">
                  Optional Order Reference
                </label>
                <select
                  value={selectedOrderId}
                  onChange={(e) => setSelectedOrderId(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                >
                  <option value="">General Inquiry (No order selected)</option>
                  {orders.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.orderNumber} — {o.currency} {o.total.toFixed(2)} ({o.status.replace(/_/g, ' ')})
                    </option>
                  ))}
                </select>
              </div>
            )}

            <button
              type="button"
              disabled={phase !== 'idle'}
              onClick={() =>
                startCall({
                  targetUid: 'support_queue',
                  targetName: 'Seven Sunday Customer Service',
                  callType: defaultCallType,
                  orderId: selectedOrderId || undefined,
                  targetQueue: true,
                })
              }
              className="w-full min-h-[46px] inline-flex items-center justify-center gap-2 rounded-xl bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white text-sm font-semibold"
            >
              {isVideoMode ? <Video className="w-4 h-4" /> : <PhoneCall className="w-4 h-4" />}
              Call Customer Service ({isVideoMode ? 'Video' : 'Audio'})
            </button>

            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
              <span>Missed Calls</span>
              <span className="font-semibold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">{missedCount}</span>
            </div>
          </div>

          <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">
                Authorized Customer Service Representatives
              </h3>
              <span className="text-xs text-slate-500 tabular-nums">
                {supportAgents.filter((a) => a.availability !== 'offline').length} online
              </span>
            </div>

            {supportAgents.length === 0 ? (
              <p className="text-xs text-slate-500 py-8 text-center">
                Use "Call Customer Service" to ring the live customer care queue directly.
              </p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {supportAgents.map((agent) => {
                  const isAvailable = agent.availability !== 'offline' && agent.availability !== 'dnd';
                  return (
                    <div key={agent.uid} className="py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-[#EAF4FF] dark:bg-[#082B59] text-[#082B59] dark:text-[#EAF4FF] flex items-center justify-center font-bold">
                          {agent.fullName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-sm text-[#15243A] dark:text-slate-100">{agent.fullName}</p>
                          <p className="text-slate-500 capitalize">
                            {agent.jobTitle || agent.role.replace(/_/g, ' ')} ·{' '}
                            <span className={agent.availability === 'offline' ? 'text-slate-400' : 'text-[#087CEB] font-medium'}>
                              {agent.availability}
                            </span>
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={phase !== 'idle' || !isAvailable}
                          onClick={() =>
                            startCall({
                              targetUid: agent.uid,
                              targetName: agent.fullName,
                              callType: 'audio',
                              orderId: selectedOrderId || undefined,
                            })
                          }
                          className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 disabled:opacity-40 font-medium"
                        >
                          <Phone className="w-3.5 h-3.5 text-[#1178B9]" /> Audio
                        </button>
                        <button
                          type="button"
                          disabled={phase !== 'idle' || !isAvailable}
                          onClick={() =>
                            startCall({
                              targetUid: agent.uid,
                              targetName: agent.fullName,
                              callType: 'video',
                              orderId: selectedOrderId || undefined,
                            })
                          }
                          className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-40 text-white font-medium"
                        >
                          <Video className="w-3.5 h-3.5" /> Video
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-[#1178B9]" /> Customer Call Desk & Outbound Dialer
              </h3>
              <p className="text-xs text-slate-500">
                Receive incoming customer service audio/video calls or place direct calls to registered customers.
              </p>
            </div>
            {onToggleAvailability && (
              <button
                type="button"
                onClick={() => onToggleAvailability(profile?.availability !== 'available')}
                className={`min-h-[40px] px-3.5 py-1.5 rounded-lg text-xs font-semibold border ${
                  profile?.availability === 'available'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                }`}
              >
                Desk Status: {profile?.availability === 'available' ? 'Available for Calls' : 'Away / DND'}
              </button>
            )}
          </div>

          {customers.length > 0 && (
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-64 overflow-y-auto">
              {customers.map((c) => {
                const isOnline = onlineUidSet.has(c.uid);
                return (
                  <div key={c.uid} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <p className="font-semibold text-[#15243A] dark:text-slate-100">{c.fullName}</p>
                      <p className="text-slate-500">
                        {c.phone || c.email} ·{' '}
                        <span className={isOnline ? 'text-[#087CEB] font-medium' : 'text-slate-400'}>
                          {isOnline ? 'Online' : 'Offline'}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={phase !== 'idle'}
                        onClick={() => startCall({ targetUid: c.uid, targetName: c.fullName, callType: 'audio' })}
                        className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] disabled:opacity-50"
                      >
                        <Phone className="w-3.5 h-3.5 text-[#1178B9]" /> Audio
                      </button>
                      <button
                        type="button"
                        disabled={phase !== 'idle'}
                        onClick={() => startCall({ targetUid: c.uid, targetName: c.fullName, callType: 'video' })}
                        className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white"
                      >
                        <Video className="w-3.5 h-3.5" /> Video
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Call History */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">
            Call History & Missed Calls ({filteredHistory.length})
          </h3>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-slate-800 text-xs">
            {(['all', 'audio', 'video', 'missed'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setHistoryFilter(f)}
                className={`min-h-[32px] px-2.5 py-1 rounded-md capitalize font-medium ${
                  historyFilter === f ? 'bg-[#082B59] text-white' : 'text-[#293858] dark:text-slate-300'
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>

        {filteredHistory.length === 0 ? (
          <p className="p-8 text-center text-xs text-slate-500">No calls recorded matching this filter.</p>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {filteredHistory.map((call) => {
              const isOutbound = call.callerUid === profile?.uid;
              const otherName = isOutbound ? call.answeredByName || call.calleeName : call.callerName;
              const otherUid = isOutbound ? call.calleeUid : call.callerUid;
              const isMissed = call.status === 'missed' || call.status === 'rejected';
              return (
                <div key={call.id} className="p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-[#F5F8FC] dark:hover:bg-slate-800/40">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                        isMissed
                          ? 'bg-red-50 dark:bg-red-950/40 text-red-600'
                          : 'bg-[#EAF4FF] dark:bg-[#082B59] text-[#1178B9]'
                      }`}
                    >
                      {isMissed ? (
                        <PhoneMissed className="w-4 h-4" />
                      ) : call.callType === 'video' ? (
                        <Video className="w-4 h-4" />
                      ) : (
                        <Phone className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <p className="font-semibold text-sm text-[#15243A] dark:text-slate-100">
                        {otherName} · <span className="text-xs font-normal capitalize text-slate-500">{call.callType}</span>
                      </p>
                      <p className="text-slate-500 tabular-nums">
                        {isOutbound ? 'Outgoing' : 'Incoming'} ·{' '}
                        <span className={isMissed ? 'text-red-600 font-semibold capitalize' : 'capitalize'}>
                          {call.status}
                        </span>{' '}
                        {typeof call.durationSeconds === 'number' && call.durationSeconds > 0
                          ? `· ${formatDuration(call.durationSeconds)}`
                          : ''}
                        {' · '}
                        {new Date(call.startedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={phase !== 'idle'}
                    onClick={() =>
                      startCall({
                        targetUid: otherUid,
                        targetName: otherName,
                        callType: call.callType,
                        targetQueue: otherUid === 'support_queue',
                      })
                    }
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 disabled:opacity-40 font-medium"
                  >
                    {call.callType === 'video' ? <Video className="w-3.5 h-3.5 text-[#1178B9]" /> : <Phone className="w-3.5 h-3.5 text-[#1178B9]" />}
                    Call Back
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
