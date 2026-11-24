import React, { useMemo, useState } from 'react';
import { addDoc, collection, doc, updateDoc } from 'firebase/firestore';
import {
  AlertTriangle,
  Calendar,
  Copy,
  Download,
  Mail,
  MessageCircle,
  Send,
  Share2,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { db } from '../../lib/firebase';
import { downloadMeetingICS } from '../../lib/exportUtils';
import { createNotification } from '../../lib/firestoreActions';
import { Department, EmployeeDirectoryEntry, Meeting } from '../../types/domain';

interface MeetingSchedulerProps {
  meetings: Meeting[];
  employees: EmployeeDirectoryEntry[];
  departments: Department[];
  onJoinMeeting: (meeting: Meeting) => void;
}

export const MeetingScheduler: React.FC<MeetingSchedulerProps> = ({
  meetings,
  employees,
  departments,
  onJoinMeeting,
}) => {
  const { profile, getToken } = useAuth();
  const [calendarView, setCalendarView] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [calendarFilter, setCalendarFilter] = useState<'all' | 'personal' | 'department'>('all');
  const [selectedDept, setSelectedDept] = useState('');

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [agenda, setAgenda] = useState('');
  const [type, setType] = useState<Meeting['type']>('scheduled');
  const [scope, setScope] = useState<Meeting['scope']>('internal');
  const [priority, setPriority] = useState<NonNullable<Meeting['priority']>>('normal');
  const [recurrence, setRecurrence] = useState<NonNullable<Meeting['recurrence']>>('none');
  const [departmentId, setDepartmentId] = useState('');
  const [startTime, setStartTime] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [endTime, setEndTime] = useState(() => {
    const d = new Date(Date.now() + 7200_000);
    d.setMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  });
  const [waitingRoom, setWaitingRoom] = useState(true);
  const [passcode, setPasscode] = useState('');
  const [invitees, setInvitees] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Invitation dispatch modal state
  const [inviteModalMeeting, setInviteModalMeeting] = useState<Meeting | null>(null);
  const [dispatchChannel, setDispatchChannel] = useState<'whatsapp' | 'telegram' | 'email' | 'sms'>('whatsapp');
  const [dispatchRecipient, setDispatchRecipient] = useState('');
  const [dispatchResult, setDispatchResult] = useState<string | null>(null);
  const [dispatchFallbackUrl, setDispatchFallbackUrl] = useState<string | null>(null);

  // Conflict detection
  const overlappingMeetings = useMemo(() => {
    if (!startTime || !endTime) return [];
    const s = new Date(startTime).getTime();
    const e = new Date(endTime).getTime();
    if (isNaN(s) || isNaN(e) || e <= s) return [];
    return meetings.filter((m) => {
      if (m.status === 'cancelled' || m.status === 'ended') return false;
      const ms = new Date(m.startTime).getTime();
      const me = new Date(m.endTime).getTime();
      return s < me && e > ms;
    });
  }, [meetings, startTime, endTime]);

  const filteredMeetings = useMemo(() => {
    const now = Date.now();
    const windowMs =
      calendarView === 'daily'
        ? 24 * 3600_000
        : calendarView === 'weekly'
        ? 7 * 24 * 3600_000
        : 31 * 24 * 3600_000;

    return meetings
      .filter((m) => {
        const t = new Date(m.startTime).getTime();
        if (t < now - 24 * 3600_000 || t > now + windowMs) return false;
        if (calendarFilter === 'personal') {
          return m.hostUid === profile?.uid || m.participantUids.includes(profile?.uid || '');
        }
        if (calendarFilter === 'department' && selectedDept) {
          return m.departmentId === selectedDept;
        }
        return true;
      })
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [meetings, calendarView, calendarFilter, selectedDept, profile?.uid]);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!profile || !title.trim()) return;
    if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
      setFormError('End time must be after start time.');
      return;
    }
    setSubmitting(true);
    try {
      const now = new Date().toISOString();
      const code = `7SM-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
      const participants = Array.from(new Set([profile.uid, ...invitees])).slice(0, 100);
      const docData: Omit<Meeting, 'id'> = {
        title: title.trim().slice(0, 160),
        ...(description ? { description: description.slice(0, 1000) } : {}),
        ...(agenda ? { agenda: agenda.slice(0, 2000) } : {}),
        meetingCode: code,
        hostUid: profile.uid,
        hostName: profile.fullName,
        type,
        scope,
        ...(departmentId ? { departmentId } : {}),
        priority,
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        recurrence,
        waitingRoomEnabled: waitingRoom,
        ...(passcode.trim() ? { passcode: passcode.trim() } : {}),
        status: 'scheduled',
        recordingConsentRequired: true,
        participantUids: participants,
        documentUrls: [],
        createdAt: now,
        updatedAt: now,
      };
      const ref = await addDoc(collection(db, 'meetings'), docData);
      participants
        .filter((uid) => uid !== profile.uid)
        .forEach((uid) => {
          createNotification(
            uid,
            'meeting',
            `Meeting Scheduled: ${title.trim()}`,
            `Hosted by ${profile.fullName} · ${new Date(startTime).toLocaleString()} · Code ${code}`,
            'meetings',
            ref.id
          ).catch(() => {});
        });
      setTitle('');
      setDescription('');
      setAgenda('');
      setInvitees([]);
      setInviteModalMeeting({ id: ref.id, ...docData });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDispatchInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteModalMeeting || !dispatchRecipient.trim()) return;
    setDispatchResult(null);
    setDispatchFallbackUrl(null);
    const token = await getToken();
    const joinUrl = `${window.location.origin}/?meeting=${inviteModalMeeting.meetingCode}`;
    const resp = await fetch('/api/invitations/dispatch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        channel: dispatchChannel,
        recipient: dispatchRecipient.trim(),
        title: inviteModalMeeting.title,
        meetingUrl: joinUrl,
        startTime: new Date(inviteModalMeeting.startTime).toLocaleString(),
        agenda: inviteModalMeeting.agenda || '',
      }),
    });
    const data = await resp.json();
    if (data.delivered) {
      setDispatchResult(`Invitation sent directly via ${dispatchChannel}.`);
    } else if (
      typeof data.fallbackUrl === 'string' &&
      /^(https:\/\/|mailto:|sms:)/i.test(data.fallbackUrl)
    ) {
      setDispatchResult(
        `Server API key not configured for ${dispatchChannel}. Use the direct launch link below to send immediately.`
      );
      setDispatchFallbackUrl(data.fallbackUrl);
    } else {
      setDispatchResult(data.error || 'Unable to dispatch invitation.');
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
      {/* Left: Schedule & Conflict Check Form */}
      <form
        onSubmit={handleSchedule}
        className="xl:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[#15243A] dark:text-white">Schedule Meeting & Agenda</h3>
          <Calendar className="w-4 h-4 text-[#1178B9]" />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Meeting Title</label>
          <input
            type="text"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Weekly Operations Review"
            className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Start Time</label>
            <input
              type="datetime-local"
              required
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-2 text-xs"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">End Time</label>
            <input
              type="datetime-local"
              required
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-2 text-xs"
            />
          </div>
        </div>

        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-700">{formError}</div>
        )}

        {overlappingMeetings.length > 0 && (
          <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <strong>Scheduling Conflict Detected:</strong> Overlaps with{' '}
              {overlappingMeetings.map((m) => m.title).join(', ')}.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Scope</label>
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as Meeting['scope'])}
              className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-2 text-xs"
            >
              <option value="internal">Internal Team</option>
              <option value="customer">Customer Session</option>
              <option value="public_invite">External Guest Link</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as NonNullable<Meeting['priority']>)}
              className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-2 text-xs"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Recurrence</label>
            <select
              value={recurrence}
              onChange={(e) => setRecurrence(e.target.value as NonNullable<Meeting['recurrence']>)}
              className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-2 text-xs"
            >
              <option value="none">One-time</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Meeting Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as Meeting['type'])}
              className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-2 text-xs"
            >
              <option value="scheduled">Scheduled Meeting</option>
              <option value="department">Department Meeting</option>
              <option value="customer">Customer Meeting</option>
              <option value="external">External Guest Meeting</option>
              <option value="recurring">Recurring Series</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Department</label>
            <select
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value)}
              className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-2 text-xs"
            >
              <option value="">All / General</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Meeting Agenda</label>
          <textarea
            rows={3}
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            placeholder="1. Key updates&#10;2. Action items & decisions"
            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 items-center">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={waitingRoom} onChange={(e) => setWaitingRoom(e.target.checked)} />
            <span>Enable Waiting Room</span>
          </label>
          <input
            type="text"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Optional Passcode"
            className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-1.5 text-xs"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Invite Colleagues</label>
          <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
            {employees
              .filter((e) => e.uid !== profile?.uid)
              .map((emp) => (
                <label key={emp.uid} className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={invitees.includes(emp.uid)}
                    onChange={(ev) => {
                      if (ev.target.checked) setInvitees((p) => [...p, emp.uid]);
                      else setInvitees((p) => p.filter((id) => id !== emp.uid));
                    }}
                  />
                  <span>{emp.fullName}</span>
                  {emp.departmentName && <span className="text-slate-400">· {emp.departmentName}</span>}
                </label>
              ))}
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full min-h-[44px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white py-2.5 text-sm font-medium"
        >
          {submitting ? 'Scheduling...' : 'Create Schedule & Generate Invite'}
        </button>
      </form>

      {/* Right: Calendar View & Invitation Actions */}
      <div className="xl:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-slate-800">
            {(['daily', 'weekly', 'monthly'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setCalendarView(v)}
                className={`min-h-[36px] px-3 py-1 rounded-md text-xs font-medium capitalize ${
                  calendarView === v ? 'bg-[#082B59] text-white shadow-sm' : 'text-[#293858] dark:text-slate-300'
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={calendarFilter}
              onChange={(e) => setCalendarFilter(e.target.value as 'all' | 'personal' | 'department')}
              className="min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-1.5 text-xs"
            >
              <option value="all">All Meetings</option>
              <option value="personal">Personal Calendar</option>
              <option value="department">Department Calendar</option>
            </select>
            {calendarFilter === 'department' && (
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-1.5 text-xs"
              >
                <option value="">Choose Dept</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {filteredMeetings.length === 0 ? (
            <p className="py-12 text-center text-xs text-slate-500">No meetings scheduled for this calendar window.</p>
          ) : (
            filteredMeetings.map((m) => {
              const joinUrl = `${window.location.origin}/?meeting=${m.meetingCode}`;
              return (
                <div key={m.id} className="py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 tabular-nums">
                      <span className="font-mono font-semibold text-[#1178B9] dark:text-[#087CEB]">{m.meetingCode}</span>
                      <span>·</span>
                      <span>{new Date(m.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                      <span>·</span>
                      <span className="capitalize">{m.status}</span>
                      {m.priority && m.priority !== 'normal' && (
                        <>
                          <span>·</span>
                          <span className="text-amber-600 font-medium capitalize">{m.priority}</span>
                        </>
                      )}
                    </div>
                    <h4 className="text-sm font-semibold text-[#15243A] dark:text-slate-100 truncate">{m.title}</h4>
                    {m.agenda && <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">{m.agenda}</p>}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setInviteModalMeeting(m)}
                      className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
                    >
                      <Share2 className="w-3.5 h-3.5 text-[#1178B9]" />
                      Invite
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadMeetingICS(m, joinUrl)}
                      className="min-h-[38px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
                    >
                      <Download className="w-3.5 h-3.5 text-[#1178B9]" />
                      .ICS
                    </button>
                    {m.hostUid === profile?.uid && m.status === 'scheduled' && (
                      <button
                        type="button"
                        onClick={() =>
                          updateDoc(doc(db, 'meetings', m.id), {
                            status: 'cancelled',
                            updatedAt: new Date().toISOString(),
                          })
                        }
                        className="min-h-[38px] px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-xs text-red-600"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onJoinMeeting(m)}
                      className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
                    >
                      Join Room
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Multi-Channel Invitation Modal */}
      {inviteModalMeeting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#082B59]/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#15243A] dark:text-white">Share Meeting Invitation</h3>
              <button type="button" onClick={() => setInviteModalMeeting(null)}><X className="w-4 h-4" /></button>
            </div>

            <div className="rounded-lg bg-[#F5F8FC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-1">
              <p className="font-semibold">{inviteModalMeeting.title}</p>
              <p className="text-slate-500">Code: <span className="font-mono text-[#1178B9]">{inviteModalMeeting.meetingCode}</span></p>
              <p className="text-slate-500">Time: {new Date(inviteModalMeeting.startTime).toLocaleString()}</p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  const url = `${window.location.origin}/?meeting=${inviteModalMeeting.meetingCode}`;
                  navigator.clipboard.writeText(
                    `7Sunday Meet: ${inviteModalMeeting.title}\nCode: ${inviteModalMeeting.meetingCode}\nLink: ${url}`
                  );
                  setDispatchResult('Invitation copied to clipboard.');
                }}
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                <Copy className="w-3.5 h-3.5 text-[#1178B9]" />
                Copy Invite
              </button>
              <button
                type="button"
                onClick={() =>
                  downloadMeetingICS(
                    inviteModalMeeting,
                    `${window.location.origin}/?meeting=${inviteModalMeeting.meetingCode}`
                  )
                }
                className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
              >
                <Download className="w-3.5 h-3.5 text-[#1178B9]" />
                Download .ICS
              </button>
            </div>

            <form onSubmit={handleDispatchInvite} className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="grid grid-cols-4 gap-1.5">
                {(
                  [
                    { id: 'whatsapp', label: 'WhatsApp', Icon: MessageCircle },
                    { id: 'telegram', label: 'Telegram', Icon: Send },
                    { id: 'email', label: 'Email', Icon: Mail },
                    { id: 'sms', label: 'SMS', Icon: Share2 },
                  ] as const
                ).map(({ id, label, Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setDispatchChannel(id)}
                    className={`min-h-[38px] flex items-center justify-center gap-1 py-1.5 rounded-lg border text-xs ${
                      dispatchChannel === id
                        ? 'border-[#1178B9] bg-[#EAF4FF] dark:bg-[#082B59]/40 text-[#082B59] dark:text-[#EAF4FF]'
                        : 'border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </button>
                ))}
              </div>
              <input
                type="text"
                required
                value={dispatchRecipient}
                onChange={(e) => setDispatchRecipient(e.target.value)}
                placeholder={
                  dispatchChannel === 'email'
                    ? 'recipient@example.com'
                    : dispatchChannel === 'telegram'
                    ? '@username or chat_id'
                    : '+251911000000'
                }
                className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              />
              <button type="submit" className="w-full min-h-[42px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white py-2 text-xs font-medium">
                Send Invitation via {dispatchChannel}
              </button>
              {dispatchResult && <p className="text-xs text-[#1178B9] dark:text-[#087CEB]">{dispatchResult}</p>}
              {dispatchFallbackUrl && (
                <a
                  href={dispatchFallbackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex w-full min-h-[40px] items-center justify-center rounded-lg border border-[#1178B9] text-[#1178B9] dark:text-[#087CEB] py-2 text-xs font-medium hover:bg-[#EAF4FF] dark:hover:bg-[#082B59]/40"
                >
                  Open {dispatchChannel} Dispatch Link
                </a>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
