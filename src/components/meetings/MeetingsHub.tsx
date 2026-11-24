import React, { useEffect, useRef, useState } from 'react';
import { addDoc, collection, doc, getDocs, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import { FileText, Plus, Trash2, Video } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { downloadDocumentFile, exportDataToExcel, exportReportToPDF } from '../../lib/exportUtils';
import { uploadFileToServer } from '../../lib/firestoreActions';
import { Department, EmployeeDirectoryEntry, Meeting, MeetingParticipant } from '../../types/domain';
import { DocumentPreviewModal } from '../shared/DocumentPreviewModal';
import { MeetingRoom } from './MeetingRoom';
import { MeetingScheduler } from './MeetingScheduler';

interface MeetingsHubProps {
  employees: EmployeeDirectoryEntry[];
  departments: Department[];
  activeMeeting: Meeting | null;
  setActiveMeeting: (m: Meeting | null) => void;
  initialJoinCode?: string | null;
}

export const MeetingsHub: React.FC<MeetingsHubProps> = ({
  employees,
  departments,
  activeMeeting,
  setActiveMeeting,
  initialJoinCode,
}) => {
  const { profile, getToken } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [subTab, setSubTab] = useState<'rooms' | 'schedule' | 'history'>('rooms');
  const [joinCode, setJoinCode] = useState(initialJoinCode || '');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [attendanceModal, setAttendanceModal] = useState<{ meeting: Meeting; list: MeetingParticipant[] } | null>(null);
  const [docModalMeeting, setDocModalMeeting] = useState<Meeting | null>(null);
  const [uploadingDoc, setUploadingDoc] = useState(false);
  const docFileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!profile) return;
    const q =
      profile.accountType === 'employee'
        ? query(collection(db, 'meetings'))
        : query(collection(db, 'meetings'), where('participantUids', 'array-contains', profile.uid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Meeting, 'id'>) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setMeetings(list);
        if (docModalMeeting) {
          const updated = list.find((m) => m.id === docModalMeeting.id);
          if (updated) setDocModalMeeting(updated);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'meetings')
    );
    return () => unsub();
  }, [profile?.uid, profile?.accountType]);

  const startInstantMeeting = async () => {
    if (!profile) return;
    const now = new Date().toISOString();
    const end = new Date(Date.now() + 3600_000).toISOString();
    const code = `7SM-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const docData: Omit<Meeting, 'id'> = {
      title: `Instant Meeting — ${profile.fullName}`,
      meetingCode: code,
      hostUid: profile.uid,
      hostName: profile.fullName,
      type: 'instant',
      scope: profile.accountType === 'employee' ? 'internal' : 'customer',
      priority: 'normal',
      startTime: now,
      endTime: end,
      recurrence: 'none',
      waitingRoomEnabled: false,
      status: 'live',
      recordingConsentRequired: true,
      participantUids: [profile.uid],
      documentUrls: [],
      createdAt: now,
      updatedAt: now,
    };
    const ref = await addDoc(collection(db, 'meetings'), docData);
    setActiveMeeting({ id: ref.id, ...docData });
  };

  const handleJoinByCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    const match = meetings.find((m) => m.meetingCode.toUpperCase() === code);
    if (match) {
      setActiveMeeting(match);
      return;
    }
    const snap = await getDocs(query(collection(db, 'meetings'), where('meetingCode', '==', code)));
    if (snap.empty) {
      setJoinError('No active meeting found with that code.');
      return;
    }
    const d = snap.docs[0];
    setActiveMeeting({ id: d.id, ...(d.data() as Omit<Meeting, 'id'>) });
  };

  const openAttendanceReport = async (m: Meeting) => {
    const snap = await getDocs(collection(db, 'meetings', m.id, 'participants'));
    const list = snap.docs.map((d) => d.data() as MeetingParticipant);
    setAttendanceModal({ meeting: m, list });
  };

  const handleUploadMeetingDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !docModalMeeting) return;
    setUploadingDoc(true);
    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication expired.');
      const res = await uploadFileToServer(file, token);
      const nextDocs = [...(docModalMeeting.documentUrls || []), res.url].slice(0, 10);
      await updateDoc(doc(db, 'meetings', docModalMeeting.id), {
        documentUrls: nextDocs,
        updatedAt: new Date().toISOString(),
      });
    } finally {
      setUploadingDoc(false);
      if (docFileInputRef.current) docFileInputRef.current.value = '';
    }
  };

  const handleRemoveMeetingDoc = async (meeting: Meeting, urlToRemove: string) => {
    const nextDocs = (meeting.documentUrls || []).filter((u) => u !== urlToRemove);
    await updateDoc(doc(db, 'meetings', meeting.id), {
      documentUrls: nextDocs,
      updatedAt: new Date().toISOString(),
    });
  };

  if (activeMeeting) {
    return (
      <MeetingRoom
        meeting={activeMeeting}
        onLeave={async () => {
          if (activeMeeting.hostUid === profile?.uid && activeMeeting.type === 'instant') {
            await updateDoc(doc(db, 'meetings', activeMeeting.id), {
              status: 'ended',
              updatedAt: new Date().toISOString(),
            }).catch(() => {});
          }
          setActiveMeeting(null);
        }}
      />
    );
  }

  const liveOrScheduled = meetings.filter((m) => m.status === 'live' || m.status === 'scheduled');
  const pastMeetings = meetings.filter((m) => m.status === 'ended' || m.status === 'cancelled');

  return (
    <div className="space-y-6">
      <input ref={docFileInputRef} type="file" className="hidden" onChange={handleUploadMeetingDoc} />

      {/* Top Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-slate-800">
          {(
            [
              { id: 'rooms', label: 'Active & Upcoming' },
              ...(profile?.accountType === 'employee' ? [{ id: 'schedule', label: 'Calendar & Schedule' }] : []),
              { id: 'history', label: 'History & Attendance' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id as 'rooms' | 'schedule' | 'history')}
              className={`min-h-[40px] px-3 py-1.5 rounded-md text-xs font-medium ${
                subTab === t.id ? 'bg-[#082B59] text-white shadow-sm' : 'text-[#293858] dark:text-slate-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <form onSubmit={handleJoinByCode} className="flex items-center gap-2">
            <input
              type="text"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
              placeholder="Enter code (7SM-...)"
              className="w-36 min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
            />
            <button
              type="submit"
              className="min-h-[40px] px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
            >
              Join
            </button>
          </form>
          {profile?.accountType === 'employee' && (
            <button
              type="button"
              onClick={startInstantMeeting}
              className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              Instant Meeting
            </button>
          )}
        </div>
      </div>

      {joinError && <p className="text-xs text-red-600">{joinError}</p>}

      {subTab === 'schedule' && profile?.accountType === 'employee' ? (
        <MeetingScheduler
          meetings={meetings}
          employees={employees}
          departments={departments}
          onJoinMeeting={(m) => setActiveMeeting(m)}
        />
      ) : subTab === 'history' ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[#15243A] dark:text-white">Completed & Cancelled Meetings</h3>
            <span className="text-xs text-slate-500 tabular-nums">{pastMeetings.length} records</span>
          </div>
          <div className="divide-y divide-slate-200 dark:divide-slate-800">
            {pastMeetings.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-500">No completed meeting history yet.</p>
            ) : (
              pastMeetings.map((m) => (
                <div key={m.id} className="px-6 py-4 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-xs text-slate-500 tabular-nums">
                      <span className="font-mono text-[#1178B9]">{m.meetingCode}</span> · {new Date(m.startTime).toLocaleString()} · {m.status}
                    </div>
                    <h4 className="text-sm font-semibold text-[#15243A] dark:text-white">{m.title}</h4>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setDocModalMeeting(m)}
                      className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
                    >
                      Documents ({(m.documentUrls || []).length})
                    </button>
                    <button
                      type="button"
                      onClick={() => openAttendanceReport(m)}
                      className="min-h-[40px] px-3 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
                    >
                      Attendance Report
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {liveOrScheduled.length === 0 ? (
            <div className="md:col-span-2 lg:col-span-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center space-y-3">
              <Video className="w-10 h-10 text-[#1178B9]/60 mx-auto" />
              <h3 className="text-base font-semibold text-[#15243A] dark:text-white">No Active or Scheduled Meetings</h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Start an instant video meeting or schedule an agenda-backed session with automatic invitations.
              </p>
            </div>
          ) : (
            liveOrScheduled.map((m) => (
              <div key={m.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-col justify-between gap-4">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-slate-500 tabular-nums">
                    <span className="font-mono font-semibold text-[#1178B9] dark:text-[#087CEB]">
                      {m.meetingCode} {m.isDemo ? '· [DEMO]' : ''}
                    </span>
                    <span className={`capitalize font-medium ${m.status === 'live' ? 'text-[#087CEB]' : ''}`}>
                      {m.status === 'live' ? 'Live Now' : 'Scheduled'}
                    </span>
                  </div>
                  <h4 className="text-base font-semibold text-[#15243A] dark:text-slate-100">{m.title}</h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Host: {m.hostName} · {new Date(m.startTime).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}
                  </p>
                  {m.agenda && <p className="text-xs text-[#293858]/80 dark:text-slate-300 line-clamp-2 pt-1">{m.agenda}</p>}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => openAttendanceReport(m)}
                      className="text-xs text-[#293858] hover:text-[#1178B9] dark:text-slate-300 font-medium"
                    >
                      Attendance
                    </button>
                    <button
                      type="button"
                      onClick={() => setDocModalMeeting(m)}
                      className="text-xs text-[#293858] hover:text-[#1178B9] dark:text-slate-300 font-medium"
                    >
                      Docs ({(m.documentUrls || []).length})
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveMeeting(m)}
                    className="min-h-[40px] px-4 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
                  >
                    Enter Room
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Printable & Downloadable Attendance Report Modal */}
      {attendanceModal && (
        <DocumentPreviewModal
          open={Boolean(attendanceModal)}
          title={`Attendance Report — ${attendanceModal.meeting.title}`}
          subtitle={`Meeting Code: ${attendanceModal.meeting.meetingCode} · Host: ${attendanceModal.meeting.hostName}`}
          badge={attendanceModal.meeting.isDemo ? 'DEMO' : undefined}
          onClose={() => setAttendanceModal(null)}
          onDownload={() =>
            exportReportToPDF(
              `Attendance: ${attendanceModal.meeting.title}`,
              `Code ${attendanceModal.meeting.meetingCode}`,
              ['Name', 'Role', 'Status', 'Joined', 'Duration (s)'],
              attendanceModal.list.map((p) => [p.displayName, p.role, p.status, p.joinedAt || '-', p.durationSeconds || 0]),
              `attendance-${attendanceModal.meeting.meetingCode}.pdf`
            )
          }
          onDownloadSecondary={() =>
            exportDataToExcel(
              'Attendance',
              attendanceModal.list.map((p) => ({
                Name: p.displayName,
                Role: p.role,
                Status: p.status,
                JoinedAt: p.joinedAt || '',
                DurationSeconds: p.durationSeconds || 0,
                RecordingConsented: p.recordingConsented ? 'Yes' : 'No',
              })),
              `attendance-${attendanceModal.meeting.meetingCode}.xlsx`
            )
          }
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-[#F5F8FC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 text-xs grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div><span className="text-slate-500 block">Meeting Code</span><strong className="font-mono">{attendanceModal.meeting.meetingCode}</strong></div>
              <div><span className="text-slate-500 block">Host</span><strong>{attendanceModal.meeting.hostName}</strong></div>
              <div><span className="text-slate-500 block">Start Time</span><strong>{new Date(attendanceModal.meeting.startTime).toLocaleString()}</strong></div>
              <div><span className="text-slate-500 block">Attendees</span><strong>{attendanceModal.list.length}</strong></div>
            </div>
            {attendanceModal.list.length === 0 ? (
              <p className="py-8 text-center text-xs text-slate-500">No attendance records recorded yet.</p>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 bg-[#EAF4FF] dark:bg-slate-800 text-[#082B59] dark:text-white">
                    <th className="p-2.5">Participant</th>
                    <th className="p-2.5">Role</th>
                    <th className="p-2.5">Status</th>
                    <th className="p-2.5">Consent</th>
                    <th className="p-2.5 text-right">Duration</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {attendanceModal.list.map((p) => (
                    <tr key={p.uid}>
                      <td className="p-2.5 font-medium">{p.displayName}</td>
                      <td className="p-2.5 capitalize">{p.role}</td>
                      <td className="p-2.5 capitalize">{p.status}</td>
                      <td className="p-2.5">{p.recordingConsented ? 'Granted' : 'No'}</td>
                      <td className="p-2.5 text-right tabular-nums">{p.durationSeconds ? `${p.durationSeconds}s` : 'Active'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </DocumentPreviewModal>
      )}

      {/* Printable & Downloadable Meeting Agenda & Documents Modal (Add / Remove / Print / Download / Close) */}
      {docModalMeeting && (
        <DocumentPreviewModal
          open={Boolean(docModalMeeting)}
          title={`Meeting Brief & Documents — ${docModalMeeting.title}`}
          subtitle={`Code: ${docModalMeeting.meetingCode} · Scheduled ${new Date(docModalMeeting.startTime).toLocaleString()}`}
          badge={docModalMeeting.isDemo ? 'DEMO' : undefined}
          onClose={() => setDocModalMeeting(null)}
          onDownload={() =>
            downloadDocumentFile(
              `Meeting-Brief-${docModalMeeting.meetingCode}.txt`,
              `7Sunday Meet — Meeting Document\nTitle: ${docModalMeeting.title}\nCode: ${docModalMeeting.meetingCode}\nHost: ${docModalMeeting.hostName}\nStart: ${docModalMeeting.startTime}\nEnd: ${docModalMeeting.endTime}\n\nAgenda:\n${docModalMeeting.agenda || 'None'}\n\nDocuments:\n${(docModalMeeting.documentUrls || []).join('\n')}`
            )
          }
          downloadLabel="Download Brief"
          onAdd={
            docModalMeeting.hostUid === profile?.uid || profile?.role === 'super_admin' || profile?.role === 'company_admin'
              ? () => docFileInputRef.current?.click()
              : undefined
          }
          addLabel={uploadingDoc ? 'Uploading...' : 'Add File'}
        >
          <div className="space-y-4">
            <div className="rounded-lg bg-[#F5F8FC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 p-4 space-y-2 text-xs">
              <p className="font-semibold text-[#082B59] dark:text-white">Meeting Agenda</p>
              <p className="whitespace-pre-wrap text-[#293858] dark:text-slate-300">
                {docModalMeeting.agenda || 'No written agenda attached to this session.'}
              </p>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#082B59] dark:text-white">
                Attached Documents ({(docModalMeeting.documentUrls || []).length})
              </p>
              {(docModalMeeting.documentUrls || []).length === 0 ? (
                <p className="text-xs text-slate-500 py-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-center">
                  No files attached yet. Hosts and administrators can upload documents via "Add File".
                </p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg">
                  {(docModalMeeting.documentUrls || []).map((url, idx) => (
                    <div key={`${url}-${idx}`} className="p-3 flex items-center justify-between gap-3 text-xs">
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 font-medium text-[#1178B9] hover:underline truncate"
                      >
                        <FileText className="w-4 h-4 shrink-0" />
                        <span className="truncate">{url.split('/').pop() || `Document ${idx + 1}`}</span>
                      </a>
                      <div className="flex items-center gap-2 shrink-0">
                        <a
                          href={url}
                          download
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 font-medium"
                        >
                          Download
                        </a>
                        {(docModalMeeting.hostUid === profile?.uid || profile?.role === 'super_admin') && (
                          <button
                            type="button"
                            onClick={() => handleRemoveMeetingDoc(docModalMeeting, url)}
                            className="p-1.5 rounded text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                            title="Remove document"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DocumentPreviewModal>
      )}
    </div>
  );
};
