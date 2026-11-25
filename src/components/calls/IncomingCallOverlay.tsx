import React from 'react';
import { Phone, PhoneIncoming, PhoneOff, Video, X } from 'lucide-react';
import { useDirectCall } from '../../context/DirectCallContext';

export const IncomingCallOverlay: React.FC = () => {
  const { incomingCall, acceptCall, rejectCall } = useDirectCall();

  if (!incomingCall) return null;

  const isVideo = incomingCall.callType === 'video';

  return (
    <div
      role="dialog"
      aria-label="Incoming call notification"
      className="fixed bottom-4 right-4 sm:top-4 sm:bottom-auto z-[70] w-[calc(100%-2rem)] sm:w-96 rounded-2xl border border-[#087CEB]/40 bg-[#082B59] text-white shadow-2xl p-4 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-[#1178B9] flex items-center justify-center shrink-0 animate-pulse">
            {isVideo ? <Video className="w-5 h-5 text-white" /> : <PhoneIncoming className="w-5 h-5 text-white" />}
          </div>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-[#EAF4FF]/80 font-semibold">
              Incoming {isVideo ? 'Video Call' : 'Audio Call'}
            </p>
            <p className="text-sm font-bold truncate">{incomingCall.callerName}</p>
            <p className="text-xs text-[#EAF4FF]/75 truncate">
              {incomingCall.targetQueue ? 'Customer Support Line' : 'Direct 1:1 Call'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => rejectCall('Dismissed')}
          aria-label="Dismiss incoming call"
          className="text-white/70 hover:text-white p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => rejectCall('Declined')}
          className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold"
        >
          <PhoneOff className="w-4 h-4" />
          Decline
        </button>
        <button
          type="button"
          onClick={() => acceptCall(false)}
          className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
        >
          {isVideo ? <Video className="w-4 h-4" /> : <Phone className="w-4 h-4" />}
          Accept
        </button>
      </div>

      {isVideo && (
        <button
          type="button"
          onClick={() => acceptCall(true)}
          className="w-full min-h-[38px] rounded-lg border border-white/25 hover:bg-white/10 text-xs font-medium text-[#EAF4FF]"
        >
          Answer with Audio Only
        </button>
      )}
    </div>
  );
};
