import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import {
  ArrowLeft,
  Ban,
  Bookmark,
  Check,
  CheckCheck,
  Clock,
  Edit3,
  Eye,
  FileText,
  Flag,
  Forward,
  Mic,
  Paperclip,
  Phone,
  Pin,
  Plus,
  Reply,
  Search,
  Send,
  Square,
  Trash2,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { downloadDocumentFile } from '../../lib/exportUtils';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { createNotification, uploadFileToServer } from '../../lib/firestoreActions';
import {
  BlockedUser,
  ChatMessage,
  Conversation,
  ConversationScope,
  ConversationType,
  CustomerDirectoryEntry,
  Department,
  EmployeeDirectoryEntry,
  UserBookmark,
} from '../../types/domain';
import { DocumentPreviewModal } from '../shared/DocumentPreviewModal';

interface MessagingCenterProps {
  mode: 'employee' | 'customer_support' | 'customer_community';
  onStartInstantCall?: (title: string, inviteeUids: string[], scope: 'internal' | 'customer') => void;
  initialConversationId?: string | null;
}

const REACTION_CHOICES = ['👍', '✅', '❤️', '👏'];

export const MessagingCenter: React.FC<MessagingCenterProps> = ({
  mode,
  onStartInstantCall,
  initialConversationId,
}) => {
  const { profile, getToken } = useAuth();
  const { onlineUsers, send: wsSend, subscribe: wsSubscribe } = useWebSocket();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialConversationId || null);
  const [mobileThreadOpen, setMobileThreadOpen] = useState(Boolean(initialConversationId));
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [employees, setEmployees] = useState<EmployeeDirectoryEntry[]>([]);
  const [customers, setCustomers] = useState<CustomerDirectoryEntry[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [bookmarks, setBookmarks] = useState<UserBookmark[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);

  const [draft, setDraft] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [msgSearch, setMsgSearch] = useState('');
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<ChatMessage | null>(null);
  const [forwardingMsg, setForwardingMsg] = useState<ChatMessage | null>(null);
  const [previewDocMsg, setPreviewDocMsg] = useState<ChatMessage | null>(null);
  const [scheduleTime, setScheduleTime] = useState('');
  const [showSchedule, setShowSchedule] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newConvType, setNewConvType] = useState<ConversationType>(
    mode === 'employee' ? 'direct_employee' : mode === 'customer_support' ? 'support' : 'customer_community'
  );
  const [newConvName, setNewConvName] = useState('');
  const [newConvMembers, setNewConvMembers] = useState<string[]>([]);
  const [newConvDept, setNewConvDept] = useState('');

  const [typingPeers, setTypingPeers] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(false);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (initialConversationId) {
      setSelectedId(initialConversationId);
      setMobileThreadOpen(true);
    }
  }, [initialConversationId]);

  useEffect(() => {
    if (!profile) return;
    const colRef = collection(db, 'conversations');
    const q =
      mode === 'customer_community'
        ? query(colRef, where('scope', '==', 'customer'))
        : query(colRef, where('memberUids', 'array-contains', profile.uid));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Conversation, 'id'>) }))
          .filter((c) => {
            if (mode === 'employee') return c.scope === 'internal' || c.scope === 'support';
            if (mode === 'customer_support') return c.scope === 'support';
            return c.scope === 'customer';
          })
          .sort((a, b) => (b.lastMessageAt || b.updatedAt).localeCompare(a.lastMessageAt || a.updatedAt));
        setConversations(list);
        if (!selectedId && list.length > 0) {
          setSelectedId(list[0].id);
        }
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'conversations')
    );
    return () => unsub();
  }, [profile?.uid, mode]);

  useEffect(() => {
    if (!profile) return;
    if (mode === 'employee' && profile.accountType === 'employee') {
      const unsubEmp = onSnapshot(
        collection(db, 'employeeDirectory'),
        (snap) => setEmployees(snap.docs.map((d) => d.data() as EmployeeDirectoryEntry)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'employeeDirectory')
      );
      const unsubDept = onSnapshot(
        collection(db, 'departments'),
        (snap) => setDepartments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Department, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'departments')
      );
      return () => {
        unsubEmp();
        unsubDept();
      };
    } else {
      const unsubCust = onSnapshot(
        collection(db, 'customerDirectory'),
        (snap) => setCustomers(snap.docs.map((d) => d.data() as CustomerDirectoryEntry)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'customerDirectory')
      );
      return () => unsubCust();
    }
  }, [profile?.uid, profile?.accountType, mode]);

  useEffect(() => {
    if (!profile) return;
    const unsubBm = onSnapshot(
      query(collection(db, 'userBookmarks'), where('uid', '==', profile.uid)),
      (snap) => setBookmarks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserBookmark, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'userBookmarks')
    );
    const unsubBlk = onSnapshot(
      query(collection(db, 'blockedUsers'), where('uid', '==', profile.uid)),
      (snap) => setBlockedUsers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BlockedUser, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'blockedUsers')
    );
    return () => {
      unsubBm();
      unsubBlk();
    };
  }, [profile?.uid]);

  useEffect(() => {
    if (!selectedId || !profile) {
      setMessages([]);
      return;
    }
    const q = query(
      collection(db, 'conversations', selectedId, 'messages'),
      orderBy('createdAt', 'asc'),
      limit(200)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ChatMessage, 'id'>) }));
        setMessages(list);
        list.slice(-15).forEach((m) => {
          if (m.senderUid !== profile.uid && !(m.readBy || []).includes(profile.uid)) {
            const nextReadBy = Array.from(new Set([...(m.readBy || []), profile.uid])).slice(0, 50);
            updateDoc(doc(db, 'conversations', selectedId, 'messages', m.id), {
              readBy: nextReadBy,
              updatedAt: new Date().toISOString(),
            }).catch(() => {});
          }
        });
      },
      (err) => handleFirestoreError(err, OperationType.LIST, `conversations/${selectedId}/messages`)
    );
    return () => unsub();
  }, [selectedId, profile?.uid]);

  useEffect(() => {
    return wsSubscribe((payload) => {
      if (payload.type === 'chat:typing' && payload.conversationId === selectedId) {
        const uid = String(payload.uid || '');
        const displayName = String(payload.displayName || 'Someone');
        const isTyping = Boolean(payload.isTyping);
        setTypingPeers((prev) => {
          const next = { ...prev };
          if (isTyping) next[uid] = displayName;
          else delete next[uid];
          return next;
        });
      }
    });
  }, [wsSubscribe, selectedId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedId]);

  const activeConv = useMemo(
    () => conversations.find((c) => c.id === selectedId) || null,
    [conversations, selectedId]
  );

  const blockedUidSet = useMemo(() => new Set(blockedUsers.map((b) => b.blockedUid)), [blockedUsers]);
  const onlineUidSet = useMemo(() => new Set(onlineUsers.map((u) => u.uid)), [onlineUsers]);

  const filteredConversations = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    if (!term) return conversations;
    return conversations.filter((c) => c.name.toLowerCase().includes(term));
  }, [conversations, searchQuery]);

  const visibleMessages = useMemo(() => {
    const nowIso = new Date().toISOString();
    const term = msgSearch.trim().toLowerCase();
    return messages.filter((m) => {
      if (blockedUidSet.has(m.senderUid)) return false;
      if (m.scheduledFor && m.scheduledFor > nowIso && m.senderUid !== profile?.uid) return false;
      if (term && !m.text.toLowerCase().includes(term) && !(m.attachmentName || '').toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [messages, blockedUidSet, msgSearch, profile?.uid]);

  const pinnedMessages = useMemo(() => visibleMessages.filter((m) => m.pinned && !m.deleted), [visibleMessages]);

  const sendMessage = async (
    textValue: string,
    attachment?: { url: string; name: string; mime: string; msgType: ChatMessage['type'] }
  ) => {
    if (!profile || !activeConv) return;
    const cleanText = textValue.trim();
    if (!cleanText && !attachment) return;
    setStatusError(null);
    const now = new Date().toISOString();

    try {
      if (editingMsg) {
        await updateDoc(doc(db, 'conversations', activeConv.id, 'messages', editingMsg.id), {
          text: cleanText,
          edited: true,
          updatedAt: now,
        });
        setEditingMsg(null);
        setDraft('');
        return;
      }

      const payload: Omit<ChatMessage, 'id'> = {
        senderUid: profile.uid,
        senderName: profile.fullName,
        senderAccountType: profile.accountType,
        type: attachment ? attachment.msgType : 'text',
        text: cleanText || (attachment ? attachment.name : ''),
        ...(attachment
          ? {
              attachmentUrl: attachment.url,
              attachmentName: attachment.name,
              attachmentMime: attachment.mime,
            }
          : {}),
        ...(replyTo
          ? {
              replyToId: replyTo.id,
              replyToPreview: `${replyTo.senderName}: ${replyTo.text.slice(0, 140)}`,
            }
          : {}),
        pinned: false,
        edited: false,
        deleted: false,
        reactions: {},
        readBy: [profile.uid],
        ...(showSchedule && scheduleTime ? { scheduledFor: new Date(scheduleTime).toISOString() } : {}),
        createdAt: now,
        updatedAt: now,
      };

      await addDoc(collection(db, 'conversations', activeConv.id, 'messages'), payload);
      await updateDoc(doc(db, 'conversations', activeConv.id), {
        lastMessageText: (cleanText || attachment?.name || '').slice(0, 200),
        lastMessageAt: now,
        updatedAt: now,
      });

      activeConv.memberUids
        .filter((uid) => uid !== profile.uid)
        .slice(0, 10)
        .forEach((uid) => {
          createNotification(
            uid,
            activeConv.scope === 'support' ? 'support' : 'message',
            `New message in ${activeConv.name}`,
            `${profile.fullName}: ${(cleanText || attachment?.name || '').slice(0, 120)}`,
            activeConv.scope === 'support' ? 'support' : 'messages',
            activeConv.id
          ).catch(() => {});
        });

      wsSend({ type: 'chat:typing', conversationId: activeConv.id, isTyping: false });
      setDraft('');
      setReplyTo(null);
      setShowSchedule(false);
      setScheduleTime('');
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Unable to send message.');
    }
  };

  const handleFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeConv) return;
    setUploading(true);
    setStatusError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication expired.');
      const res = await uploadFileToServer(file, token);
      let msgType: ChatMessage['type'] = 'file';
      if (res.mime.startsWith('image/')) msgType = 'image';
      else if (res.mime.startsWith('video/')) msgType = 'video';
      else if (res.mime.startsWith('audio/')) msgType = 'audio';
      await sendMessage(draft || res.name, { url: res.url, name: res.name, mime: res.mime, msgType });
    } catch (err) {
      setStatusError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const toggleVoiceRecording = async () => {
    if (recordingVoice && mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setRecordingVoice(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      audioChunksRef.current = [];
      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) audioChunksRef.current.push(ev.data);
      };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-note-${Date.now()}.webm`, { type: 'audio/webm' });
        setUploading(true);
        try {
          const token = await getToken();
          if (!token) throw new Error('Missing token');
          const res = await uploadFileToServer(file, token);
          await sendMessage('Voice note', { url: res.url, name: res.name, mime: res.mime, msgType: 'audio' });
        } catch (err) {
          setStatusError(err instanceof Error ? err.message : 'Voice note upload failed.');
        } finally {
          setUploading(false);
        }
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecordingVoice(true);
    } catch {
      setStatusError('Microphone permission is required to record voice notes.');
    }
  };

  const toggleReaction = async (msg: ChatMessage, emoji: string) => {
    if (!profile || !activeConv) return;
    const reactions = { ...(msg.reactions || {}) };
    const current = new Set(reactions[emoji] || []);
    if (current.has(profile.uid)) current.delete(profile.uid);
    else current.add(profile.uid);
    reactions[emoji] = Array.from(current);
    await updateDoc(doc(db, 'conversations', activeConv.id, 'messages', msg.id), {
      reactions,
      updatedAt: new Date().toISOString(),
    });
  };

  const togglePin = async (msg: ChatMessage) => {
    if (!activeConv) return;
    await updateDoc(doc(db, 'conversations', activeConv.id, 'messages', msg.id), {
      pinned: !msg.pinned,
      updatedAt: new Date().toISOString(),
    });
  };

  const bookmarkMessage = async (msg: ChatMessage) => {
    if (!profile || !activeConv) return;
    await setDoc(doc(db, 'userBookmarks', `${profile.uid}_${msg.id}`), {
      uid: profile.uid,
      conversationId: activeConv.id,
      messageId: msg.id,
      previewText: msg.text.slice(0, 300),
      senderName: msg.senderName,
      createdAt: new Date().toISOString(),
    });
  };

  const deleteMessage = async (msg: ChatMessage) => {
    if (!activeConv) return;
    await updateDoc(doc(db, 'conversations', activeConv.id, 'messages', msg.id), {
      text: 'This message was deleted.',
      deleted: true,
      updatedAt: new Date().toISOString(),
    });
  };

  const reportMessage = async (msg: ChatMessage) => {
    if (!profile || !activeConv) return;
    const now = new Date().toISOString();
    await addDoc(collection(db, 'moderationReports'), {
      reporterUid: profile.uid,
      targetUid: msg.senderUid,
      conversationId: activeConv.id,
      messageId: msg.id,
      reason: `Reported message: "${msg.text.slice(0, 120)}"`,
      status: 'open',
      createdAt: now,
      updatedAt: now,
    });
    setStatusError('Message reported to moderation administrators.');
  };

  const blockUser = async (targetUid: string) => {
    if (!profile || targetUid === profile.uid) return;
    await setDoc(doc(db, 'blockedUsers', `${profile.uid}_${targetUid}`), {
      uid: profile.uid,
      blockedUid: targetUid,
      reason: 'User blocked from chat',
      createdAt: new Date().toISOString(),
    });
  };

  const forwardMessageTo = async (targetConvId: string) => {
    if (!profile || !forwardingMsg) return;
    const now = new Date().toISOString();
    await addDoc(collection(db, 'conversations', targetConvId, 'messages'), {
      senderUid: profile.uid,
      senderName: profile.fullName,
      senderAccountType: profile.accountType,
      type: forwardingMsg.type,
      text: forwardingMsg.text,
      ...(forwardingMsg.attachmentUrl
        ? {
            attachmentUrl: forwardingMsg.attachmentUrl,
            attachmentName: forwardingMsg.attachmentName,
            attachmentMime: forwardingMsg.attachmentMime,
          }
        : {}),
      forwardedFrom: forwardingMsg.senderName,
      pinned: false,
      edited: false,
      deleted: false,
      reactions: {},
      readBy: [profile.uid],
      createdAt: now,
      updatedAt: now,
    });
    setForwardingMsg(null);
    setSelectedId(targetConvId);
    setMobileThreadOpen(true);
  };

  const handleCreateConversation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    const now = new Date().toISOString();
    let scope: ConversationScope = 'internal';
    if (mode === 'customer_support' || newConvType === 'support') scope = 'support';
    else if (mode === 'customer_community' || newConvType === 'customer_community' || newConvType === 'customer_direct') {
      scope = 'customer';
    }

    const memberSet = new Set([profile.uid, ...newConvMembers]);
    if (scope === 'support' && profile.accountType === 'customer') {
      try {
        const { getDoc } = await import('firebase/firestore');
        const routingSnap = await getDoc(doc(db, 'publicConfig', 'supportRouting'));
        if (routingSnap.exists()) {
          const agentUids = (routingSnap.data().agentUids || []) as string[];
          agentUids.slice(0, 10).forEach((id) => memberSet.add(id));
        }
      } catch {
        // Fallback: support agents can also access scope == 'support' directly via Firestore rules
      }
    }

    const convName =
      newConvName.trim() ||
      (newConvType === 'direct_employee'
        ? employees.find((emp) => emp.uid === newConvMembers[0])?.fullName || 'Direct Message'
        : newConvType === 'support'
        ? `Support Request — ${profile.fullName}`
        : 'Conversation');

    const convRef = await addDoc(collection(db, 'conversations'), {
      type: newConvType,
      scope,
      name: convName.slice(0, 140),
      ...(newConvDept ? { departmentId: newConvDept } : {}),
      createdBy: profile.uid,
      memberUids: Array.from(memberSet).slice(0, 50),
      adminUids: [profile.uid],
      lastMessageText: 'Conversation started',
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });

    await setDoc(doc(db, 'conversations', convRef.id, 'members', profile.uid), {
      uid: profile.uid,
      displayName: profile.fullName,
      role: 'admin',
      joinedAt: now,
    });

    setShowCreateModal(false);
    setNewConvName('');
    setNewConvMembers([]);
    setSelectedId(convRef.id);
    setMobileThreadOpen(true);
  };

  return (
    <div className="h-[calc(100vh-12rem)] min-h-[520px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden grid grid-cols-1 lg:grid-cols-12">
      {/* Left Conversation List */}
      <aside
        className={`lg:col-span-4 border-b lg:border-b-0 lg:border-r border-slate-200 dark:border-slate-800 flex-col min-h-0 ${
          mobileThreadOpen && activeConv ? 'hidden lg:flex' : 'flex'
        }`}
      >
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3 bg-[#F5F8FC] dark:bg-slate-950/50">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">
              {mode === 'customer_support'
                ? 'Customer Support Desk'
                : mode === 'customer_community'
                ? 'Customer Community'
                : 'Channels & Direct Messages'}
            </h2>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setShowBookmarks(!showBookmarks)}
                title="Bookmarked Messages"
                className={`min-h-[36px] min-w-[36px] inline-flex items-center justify-center p-1.5 rounded-lg border text-xs ${
                  showBookmarks
                    ? 'border-[#1178B9] bg-[#EAF4FF] dark:bg-[#082B59]/40 text-[#082B59] dark:text-[#EAF4FF]'
                    : 'border-slate-200 dark:border-slate-700 text-[#293858] dark:text-slate-300'
                }`}
              >
                <Bookmark className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowCreateModal(true)}
                className="min-h-[36px] inline-flex items-center gap-1 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white px-2.5 py-1.5 text-xs font-medium whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                New Chat
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search conversations..."
              className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-[#293858] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
            />
          </div>
        </div>

        {showBookmarks ? (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-semibold text-slate-500">Saved Bookmarks ({bookmarks.length})</span>
              <button type="button" onClick={() => setShowBookmarks(false)} className="text-xs text-[#1178B9] font-medium">
                Back
              </button>
            </div>
            {bookmarks.length === 0 ? (
              <p className="text-xs text-slate-500 p-3">No bookmarked messages yet.</p>
            ) : (
              bookmarks.map((bm) => (
                <div
                  key={bm.id}
                  onClick={() => {
                    setSelectedId(bm.conversationId);
                    setMobileThreadOpen(true);
                    setShowBookmarks(false);
                  }}
                  className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 hover:bg-[#EAF4FF]/60 dark:hover:bg-slate-800/50 cursor-pointer space-y-1"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium text-[#15243A] dark:text-slate-100">{bm.senderName}</span>
                    <button
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        deleteDoc(doc(db, 'userBookmarks', bm.id));
                      }}
                      className="text-slate-400 hover:text-red-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-xs text-[#293858] dark:text-slate-300 line-clamp-2">{bm.previewText}</p>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60">
            {filteredConversations.length === 0 ? (
              <div className="p-6 text-center space-y-3">
                <Users className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  No active conversations yet. Start a direct chat, group channel, or support thread.
                </p>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(true)}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
                >
                  Start Conversation
                </button>
              </div>
            ) : (
              filteredConversations.map((conv) => {
                const otherUids = conv.memberUids.filter((id) => id !== profile?.uid);
                const anyOnline = otherUids.some((id) => onlineUidSet.has(id));
                return (
                  <button
                    key={conv.id}
                    type="button"
                    onClick={() => {
                      setSelectedId(conv.id);
                      setMobileThreadOpen(true);
                    }}
                    className={`w-full text-left px-4 py-3 transition-colors flex items-start justify-between gap-2 ${
                      selectedId === conv.id
                        ? 'bg-[#EAF4FF] dark:bg-[#082B59]/40 border-l-4 border-[#1178B9]'
                        : 'hover:bg-[#F5F8FC] dark:hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-[#15243A] dark:text-slate-100 truncate">
                          {conv.name}
                        </span>
                        {anyOnline && (
                          <span className="text-[11px] font-medium text-[#087CEB]">
                            · Online
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#293858]/80 dark:text-slate-400 truncate">
                        {conv.lastMessageText || 'No messages yet'}
                      </p>
                      <p className="text-[11px] text-slate-400 tabular-nums">
                        {conv.type.replace('_', ' ')} · {conv.memberUids.length} members
                      </p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </aside>

      {/* Right Active Thread */}
      <section
        className={`lg:col-span-8 flex-col min-h-0 ${
          mobileThreadOpen && activeConv ? 'flex' : 'hidden lg:flex'
        }`}
      >
        {!activeConv ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
            <Users className="w-10 h-10 text-slate-300 dark:text-slate-700" />
            <h3 className="text-base font-semibold text-[#15243A] dark:text-slate-100">
              Select a conversation to begin
            </h3>
            <p className="text-xs text-[#293858] dark:text-slate-400 max-w-sm">
              All messages synchronize in real time with read receipts, file sharing, voice notes, and moderation controls.
            </p>
          </div>
        ) : (
          <>
            {/* Thread Header */}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-[#F5F8FC] dark:bg-slate-950/50">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => setMobileThreadOpen(false)}
                  aria-label="Back to conversations"
                  className="lg:hidden min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#293858] dark:text-slate-200"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100 truncate">
                    {activeConv.name}
                  </h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {activeConv.scope === 'internal' ? 'Internal Corporate Channel' : activeConv.scope === 'support' ? 'Customer Support Thread' : 'Customer Community'}
                    {' · '}
                    <span className="tabular-nums">{activeConv.memberUids.length}</span> participants
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={msgSearch}
                    onChange={(e) => setMsgSearch(e.target.value)}
                    placeholder="Find in thread..."
                    className="w-32 sm:w-44 min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-8 pr-2.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
                  />
                </div>
                {onStartInstantCall && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        onStartInstantCall(
                          `Audio Call — ${activeConv.name}`,
                          activeConv.memberUids,
                          activeConv.scope === 'internal' ? 'internal' : 'customer'
                        )
                      }
                      title="Start Voice Call"
                      className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-[#293858] dark:text-slate-200"
                    >
                      <Phone className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        onStartInstantCall(
                          `Video Meeting — ${activeConv.name}`,
                          activeConv.memberUids,
                          activeConv.scope === 'internal' ? 'internal' : 'customer'
                        )
                      }
                      title="Start Video Meeting"
                      className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center p-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white"
                    >
                      <Video className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Pinned Bar */}
            {pinnedMessages.length > 0 && (
              <div className="px-4 py-2 bg-[#EAF4FF] dark:bg-[#082B59]/40 border-b border-[#1178B9]/20 flex items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <Pin className="w-3.5 h-3.5 text-[#082B59] dark:text-[#087CEB] shrink-0" />
                  <span className="font-medium text-[#082B59] dark:text-[#EAF4FF] truncate">
                    Pinned: {pinnedMessages[pinnedMessages.length - 1].senderName} — {pinnedMessages[pinnedMessages.length - 1].text}
                  </span>
                </div>
                <span className="text-[11px] text-[#1178B9] tabular-nums shrink-0">
                  {pinnedMessages.length} pinned
                </span>
              </div>
            )}

            {/* Messages Feed */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {visibleMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-400">
                  No messages match your view yet. Send the first message below.
                </div>
              ) : (
                visibleMessages.map((msg) => {
                  const isMine = msg.senderUid === profile?.uid;
                  const readCount = (msg.readBy || []).length;
                  const isScheduledFuture = msg.scheduledFor && msg.scheduledFor > new Date().toISOString();
                  return (
                    <div key={msg.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                      <div
                        className={`max-w-[85%] sm:max-w-[72%] rounded-xl px-4 py-2.5 border space-y-1.5 ${
                          isMine
                            ? 'bg-[#082B59] text-white border-[#082B59]'
                            : 'bg-[#F5F8FC] dark:bg-slate-800 text-[#293858] dark:text-slate-100 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3 text-[11px] opacity-85">
                          <span className="font-semibold">{msg.senderName}</span>
                          <span className="tabular-nums">
                            {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            {msg.edited ? ' · edited' : ''}
                            {isScheduledFuture ? ` · scheduled ${new Date(msg.scheduledFor!).toLocaleString()}` : ''}
                          </span>
                        </div>

                        {msg.forwardedFrom && (
                          <div className="text-[11px] italic opacity-75">Forwarded from {msg.forwardedFrom}</div>
                        )}

                        {msg.replyToPreview && (
                          <div
                            className={`text-xs rounded px-2.5 py-1.5 border ${
                              isMine
                                ? 'bg-[#1178B9]/30 border-[#087CEB]/40 text-[#EAF4FF]'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-[#293858] dark:text-slate-300'
                            }`}
                          >
                            {msg.replyToPreview}
                          </div>
                        )}

                        <p className={`text-sm whitespace-pre-wrap break-words ${msg.deleted ? 'italic opacity-70' : ''}`}>
                          {msg.text}
                        </p>

                        {/* Attachment Preview + Document Modal Trigger */}
                        {!msg.deleted && msg.attachmentUrl && (
                          <div className="pt-1 space-y-2">
                            {msg.type === 'image' && (
                              <img
                                src={msg.attachmentUrl}
                                alt={msg.attachmentName || 'Shared image'}
                                referrerPolicy="no-referrer"
                                className="max-h-64 rounded-lg border border-black/10 object-contain"
                              />
                            )}
                            {msg.type === 'video' && (
                              <video controls src={msg.attachmentUrl} className="max-h-64 rounded-lg w-full" />
                            )}
                            {msg.type === 'audio' && (
                              <audio controls src={msg.attachmentUrl} className="w-full max-w-xs" />
                            )}
                            {msg.type === 'file' && (
                              <a
                                href={msg.attachmentUrl}
                                download={msg.attachmentName || 'document'}
                                className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium border ${
                                  isMine
                                    ? 'bg-[#1178B9] border-[#087CEB] text-white'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-[#293858] dark:text-slate-200'
                                }`}
                              >
                                <FileText className="w-4 h-4" />
                                <span>{msg.attachmentName || 'Download Document'}</span>
                              </a>
                            )}
                            <div>
                              <button
                                type="button"
                                onClick={() => setPreviewDocMsg(msg)}
                                className={`inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium ${
                                  isMine
                                    ? 'bg-white/15 hover:bg-white/25 text-white'
                                    : 'bg-[#EAF4FF] hover:bg-[#1178B9]/20 text-[#082B59]'
                                }`}
                              >
                                <Eye className="w-3 h-3" />
                                <span>Preview / Print</span>
                              </button>
                            </div>
                          </div>
                        )}

                        {/* Reactions + Read Receipts */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(msg.reactions || {}).map(([emoji, uids]) =>
                              uids.length > 0 ? (
                                <button
                                  key={emoji}
                                  type="button"
                                  onClick={() => toggleReaction(msg, emoji)}
                                  className={`px-1.5 py-0.5 rounded text-[11px] border ${
                                    isMine
                                      ? 'bg-[#1178B9]/40 border-[#087CEB]/50 text-white'
                                      : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700'
                                  }`}
                                >
                                  {emoji} <span className="tabular-nums">{uids.length}</span>
                                </button>
                              ) : null
                            )}
                          </div>
                          {isMine && (
                            <span className="inline-flex items-center gap-0.5 text-[11px] opacity-80">
                              {readCount > 1 ? <CheckCheck className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Subtle Action Row */}
                      {!msg.deleted && (
                        <div className="flex flex-wrap items-center gap-1.5 mt-1 px-1 text-slate-400">
                          {REACTION_CHOICES.map((em) => (
                            <button
                              key={em}
                              type="button"
                              onClick={() => toggleReaction(msg, em)}
                              className="text-xs hover:scale-110 transition-transform"
                            >
                              {em}
                            </button>
                          ))}
                          <button type="button" onClick={() => setReplyTo(msg)} title="Reply" className="hover:text-[#1178B9]">
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => setForwardingMsg(msg)} title="Forward" className="hover:text-[#1178B9]">
                            <Forward className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => togglePin(msg)} title="Pin" className="hover:text-amber-600">
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                          <button type="button" onClick={() => bookmarkMessage(msg)} title="Bookmark" className="hover:text-[#1178B9]">
                            <Bookmark className="w-3.5 h-3.5" />
                          </button>
                          {isMine ? (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMsg(msg);
                                  setDraft(msg.text);
                                }}
                                title="Edit"
                                className="hover:text-[#1178B9]"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => deleteMessage(msg)} title="Delete" className="hover:text-red-600">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button type="button" onClick={() => reportMessage(msg)} title="Report Abuse" className="hover:text-amber-600">
                                <Flag className="w-3.5 h-3.5" />
                              </button>
                              <button type="button" onClick={() => blockUser(msg.senderUid)} title="Block User" className="hover:text-red-600">
                                <Ban className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing Indicator */}
            {Object.keys(typingPeers).length > 0 && (
              <div className="px-4 py-1 text-xs text-[#1178B9]">
                {Object.values(typingPeers).join(', ')} typing...
              </div>
            )}

            {/* Reply / Edit / Schedule Banner */}
            {(replyTo || editingMsg || showSchedule || statusError) && (
              <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-800 bg-[#F5F8FC] dark:bg-slate-950 flex flex-wrap items-center justify-between gap-2 text-xs">
                {replyTo && (
                  <div className="flex items-center gap-2 text-[#293858] dark:text-slate-300">
                    <Reply className="w-3.5 h-3.5 text-[#1178B9]" />
                    <span>Replying to <strong>{replyTo.senderName}</strong>: {replyTo.text.slice(0, 80)}</span>
                    <button type="button" onClick={() => setReplyTo(null)}><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                {editingMsg && (
                  <div className="flex items-center gap-2 text-[#1178B9]">
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Editing message</span>
                    <button type="button" onClick={() => { setEditingMsg(null); setDraft(''); }}><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                {showSchedule && (
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-[#1178B9]" />
                    <input
                      type="datetime-local"
                      value={scheduleTime}
                      onChange={(e) => setScheduleTime(e.target.value)}
                      className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1 text-xs"
                    />
                    <button type="button" onClick={() => { setShowSchedule(false); setScheduleTime(''); }}><X className="w-3.5 h-3.5" /></button>
                  </div>
                )}
                {statusError && <span className="text-red-600 dark:text-red-400">{statusError}</span>}
              </div>
            )}

            {/* Composer */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage(draft);
              }}
              className="p-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2"
            >
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFilePick}
              />
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
                title="Attach File, Image, or Video"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-[#293858] dark:text-slate-300"
              >
                <Paperclip className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={toggleVoiceRecording}
                title={recordingVoice ? 'Stop & Send Voice Note' : 'Record Voice Note'}
                className={`min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-2 rounded-lg border ${
                  recordingVoice
                    ? 'border-red-600 bg-red-600 text-white'
                    : 'border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-[#293858] dark:text-slate-300'
                }`}
              >
                {recordingVoice ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={() => setShowSchedule(!showSchedule)}
                title="Schedule Message"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-[#293858] dark:text-slate-300"
              >
                <Clock className="w-4 h-4" />
              </button>

              <input
                type="text"
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  wsSend({
                    type: 'chat:typing',
                    conversationId: activeConv.id,
                    isTyping: e.target.value.length > 0,
                  });
                }}
                placeholder={uploading ? 'Uploading attachment...' : 'Write a message...'}
                className="flex-1 min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-sm text-[#293858] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
              />
              <button
                type="submit"
                disabled={uploading || (!draft.trim() && !editingMsg)}
                className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white px-4 py-2 text-sm font-medium"
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">{editingMsg ? 'Save' : 'Send'}</span>
              </button>
            </form>
          </>
        )}
      </section>

      {/* Attachment Document Preview / Print / Download / Add / Remove / Close Modal */}
      <DocumentPreviewModal
        open={Boolean(previewDocMsg)}
        title={previewDocMsg?.attachmentName || 'Shared Attachment'}
        subtitle={
          previewDocMsg
            ? `Shared by ${previewDocMsg.senderName} · ${new Date(previewDocMsg.createdAt).toLocaleString()}`
            : ''
        }
        badge={previewDocMsg?.type.toUpperCase()}
        onClose={() => setPreviewDocMsg(null)}
        onDownload={() => {
          if (!previewDocMsg?.attachmentUrl) return;
          const a = document.createElement('a');
          a.href = previewDocMsg.attachmentUrl;
          a.download = previewDocMsg.attachmentName || 'attachment';
          a.click();
        }}
        downloadLabel="Download File"
        onDownloadSecondary={() => {
          if (!previewDocMsg) return;
          downloadDocumentFile(
            `attachment-record-${previewDocMsg.id}.txt`,
            `Sender: ${previewDocMsg.senderName}\nTimestamp: ${previewDocMsg.createdAt}\nFile: ${previewDocMsg.attachmentName}\nType: ${previewDocMsg.attachmentMime}\nMessage: ${previewDocMsg.text}`
          );
        }}
        downloadSecondaryLabel="Download Details"
        onAdd={() => {
          setPreviewDocMsg(null);
          fileInputRef.current?.click();
        }}
        addLabel="Add Attachment"
        onRemove={
          previewDocMsg && previewDocMsg.senderUid === profile?.uid
            ? async () => {
                await deleteMessage(previewDocMsg);
                setPreviewDocMsg(null);
              }
            : undefined
        }
        removeLabel="Remove Message"
      >
        {previewDocMsg && (
          <div className="space-y-4">
            {previewDocMsg.type === 'image' && previewDocMsg.attachmentUrl && (
              <img
                src={previewDocMsg.attachmentUrl}
                alt={previewDocMsg.attachmentName || 'Attachment'}
                referrerPolicy="no-referrer"
                className="max-h-96 mx-auto rounded-lg border border-slate-200 dark:border-slate-700"
              />
            )}
            {previewDocMsg.type === 'video' && previewDocMsg.attachmentUrl && (
              <video controls src={previewDocMsg.attachmentUrl} className="w-full max-h-80 rounded-lg" />
            )}
            {previewDocMsg.type === 'audio' && previewDocMsg.attachmentUrl && (
              <audio controls src={previewDocMsg.attachmentUrl} className="w-full" />
            )}
            <div className="rounded-lg bg-[#F5F8FC] dark:bg-slate-800 p-4 border border-slate-200 dark:border-slate-700 text-xs space-y-1">
              <p><strong>File Name:</strong> {previewDocMsg.attachmentName || 'Attachment'}</p>
              <p><strong>MIME Type:</strong> {previewDocMsg.attachmentMime || previewDocMsg.type}</p>
              <p><strong>Note:</strong> {previewDocMsg.text}</p>
            </div>
          </div>
        )}
      </DocumentPreviewModal>

      {/* New Conversation Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#082B59]/60 p-4">
          <form
            onSubmit={handleCreateConversation}
            className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-[#15243A] dark:text-slate-100">Start New Conversation</h3>
              <button type="button" onClick={() => setShowCreateModal(false)}><X className="w-4 h-4" /></button>
            </div>

            {mode === 'employee' && (
              <div>
                <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Channel Type</label>
                <select
                  value={newConvType}
                  onChange={(e) => setNewConvType(e.target.value as ConversationType)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="direct_employee">1:1 Employee Direct Chat</option>
                  <option value="group_employee">Employee Group Chat</option>
                  <option value="department">Department Channel</option>
                </select>
              </div>
            )}

            {mode === 'customer_community' && (
              <div>
                <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Community Type</label>
                <select
                  value={newConvType}
                  onChange={(e) => setNewConvType(e.target.value as ConversationType)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="customer_community">Customer Community Group</option>
                  <option value="customer_direct">Customer 1:1 Chat</option>
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Title / Subject</label>
              <input
                type="text"
                value={newConvName}
                onChange={(e) => setNewConvName(e.target.value)}
                placeholder={mode === 'customer_support' ? 'Order or Service Inquiry' : 'Channel name'}
                className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
              />
            </div>

            {newConvType === 'department' && departments.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">Department</label>
                <select
                  value={newConvDept}
                  onChange={(e) => setNewConvDept(e.target.value)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm"
                >
                  <option value="">Select department...</option>
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}

            {mode !== 'customer_support' && (
              <div>
                <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">
                  Select Participants
                </label>
                <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                  {(mode === 'employee' ? employees : customers)
                    .filter((u) => u.uid !== profile?.uid)
                    .map((u) => {
                      const label = 'fullName' in u ? u.fullName : u.displayName;
                      const checked = newConvMembers.includes(u.uid);
                      return (
                        <label key={u.uid} className="flex items-center gap-2.5 px-3 py-2 text-xs cursor-pointer hover:bg-[#EAF4FF]/50 dark:hover:bg-slate-800">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(ev) => {
                              if (ev.target.checked) setNewConvMembers((p) => [...p, u.uid]);
                              else setNewConvMembers((p) => p.filter((id) => id !== u.uid));
                            }}
                          />
                          <span className="font-medium">{label}</span>
                          {'departmentName' in u && u.departmentName && (
                            <span className="text-slate-400">· {u.departmentName}</span>
                          )}
                        </label>
                      );
                    })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowCreateModal(false)} className="min-h-[40px] px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium">
                Cancel
              </button>
              <button type="submit" className="min-h-[40px] px-4 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium">
                Create Conversation
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Forward Message Modal */}
      {forwardingMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#082B59]/60 p-4">
          <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Forward Message To</h3>
              <button type="button" onClick={() => setForwardingMsg(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {conversations.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => forwardMessageTo(c.id)}
                  className="w-full text-left px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-[#082B59]/40 text-xs font-medium"
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
