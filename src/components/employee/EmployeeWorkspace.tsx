import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import {
  BarChart3,
  Bell,
  Building2,
  LayoutDashboard,
  LogOut,
  Menu,
  MessageSquare,
  Phone,
  Search,
  Settings,
  Shield,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { createNotification } from '../../lib/firestoreActions';
import { hasPermission, isAdminRole, ROLE_LABELS } from '../../lib/rbac';
import {
  AvailabilityStatus,
  CustomerFeedback,
  CustomerOrder,
  Department,
  EmployeeDirectoryEntry,
  FinancialTransaction,
  Meeting,
  NotificationItem,
  Product,
  UserAccount,
} from '../../types/domain';
import { AdminDashboard } from '../admin/AdminDashboard';
import { MessagingCenter } from '../chat/MessagingCenter';
import { MeetingsHub } from '../meetings/MeetingsHub';
import { ReportsAnalytics } from '../reports/ReportsAnalytics';
import { PWAInstallButton } from '../shared/PWAComponents';
import { SyncAndSecurityCenter } from '../shared/SyncAndSecurityCenter';

type WorkspaceTab = 'overview' | 'messages' | 'meetings' | 'directory' | 'reports' | 'admin' | 'settings';

export const EmployeeWorkspace: React.FC<{ initialJoinCode?: string | null }> = ({ initialJoinCode }) => {
  const { profile, updateAvailability, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { connected: wsConnected, onlineUsers } = useWebSocket();

  const [tab, setTab] = useState<WorkspaceTab>(initialJoinCode ? 'meetings' : 'overview');
  const [mobileMenu, setMobileMenu] = useState(false);

  const [employees, setEmployees] = useState<EmployeeDirectoryEntry[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [allUsers, setAllUsers] = useState<UserAccount[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [feedback, setFeedback] = useState<CustomerFeedback[]>([]);
  const [showDemoData, setShowDemoData] = useState(false);

  const [showNotifications, setShowNotifications] = useState(false);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [dirSearch, setDirSearch] = useState('');
  const [dirDeptFilter, setDirDeptFilter] = useState('all');

  const canAdmin = Boolean(profile && (isAdminRole(profile.role) || hasPermission(profile, 'admin', 'view')));
  const canReports = Boolean(profile && hasPermission(profile, 'reports', 'view'));
  const canSupportOrOrders = Boolean(
    profile && (canAdmin || profile.role === 'support_agent' || profile.role === 'department_manager')
  );

  useEffect(() => {
    if (!profile) return;
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        collection(db, 'employeeDirectory'),
        (snap) => setEmployees(snap.docs.map((d) => d.data() as EmployeeDirectoryEntry)),
        (err) => handleFirestoreError(err, OperationType.LIST, 'employeeDirectory')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'departments'),
        (snap) => setDepartments(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Department, 'id'>) }))),
        (err) => handleFirestoreError(err, OperationType.LIST, 'departments')
      )
    );

    unsubs.push(
      onSnapshot(
        collection(db, 'meetings'),
        (snap) =>
          setMeetings(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<Meeting, 'id'>) }))
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'meetings')
      )
    );

    unsubs.push(
      onSnapshot(
        query(collection(db, 'notifications'), where('targetUid', '==', profile.uid)),
        (snap) =>
          setNotifications(
            snap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }))
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          ),
        (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
      )
    );

    unsubs.push(
      onSnapshot(doc(db, 'publicConfig', 'appSettings'), (snap) => {
        if (snap.exists()) setShowDemoData(Boolean(snap.data().showDemoData));
      })
    );

    if (canAdmin) {
      unsubs.push(
        onSnapshot(
          collection(db, 'users'),
          (snap) => setAllUsers(snap.docs.map((d) => d.data() as UserAccount)),
          (err) => handleFirestoreError(err, OperationType.LIST, 'users')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'products'),
          (snap) => setProducts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'products')
        )
      );
    }

    if (canSupportOrOrders) {
      unsubs.push(
        onSnapshot(
          collection(db, 'orders'),
          (snap) => setOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerOrder, 'id'>) }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'financialTransactions'),
          (snap) =>
            setTransactions(
              snap.docs
                .map((d) => ({ id: d.id, ...(d.data() as Omit<FinancialTransaction, 'id'>) }))
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            ),
          (err) => handleFirestoreError(err, OperationType.LIST, 'financialTransactions')
        )
      );
      unsubs.push(
        onSnapshot(
          collection(db, 'customerFeedback'),
          (snap) => setFeedback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerFeedback, 'id'>) }))),
          (err) => handleFirestoreError(err, OperationType.LIST, 'customerFeedback')
        )
      );
    }

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [profile?.uid, canAdmin, canSupportOrOrders]);

  const onlineUidSet = useMemo(() => new Set(onlineUsers.map((u) => u.uid)), [onlineUsers]);

  const visibleMeetings = useMemo(
    () => meetings.filter((m) => showDemoData || !m.isDemo),
    [meetings, showDemoData]
  );

  const visibleDepartments = useMemo(
    () => departments.filter((d) => showDemoData || !d.isDemo),
    [departments, showDemoData]
  );

  const filteredDirectory = useMemo(() => {
    const term = dirSearch.trim().toLowerCase();
    return employees.filter((e) => {
      if (dirDeptFilter !== 'all' && e.departmentId !== dirDeptFilter) return false;
      if (term && !e.fullName.toLowerCase().includes(term) && !(e.jobTitle || '').toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [employees, dirSearch, dirDeptFilter]);

  const startDirectMessage = async (target: EmployeeDirectoryEntry) => {
    if (!profile) return;
    const now = new Date().toISOString();
    const convRef = await addDoc(collection(db, 'conversations'), {
      type: 'direct_employee',
      scope: 'internal',
      name: `${profile.fullName} & ${target.fullName}`,
      createdBy: profile.uid,
      memberUids: [profile.uid, target.uid],
      adminUids: [profile.uid],
      lastMessageText: 'Direct message started',
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
    setSelectedConvId(convRef.id);
    setTab('messages');
  };

  const launchInstantCall = async (title: string, inviteeUids: string[], scope: 'internal' | 'customer') => {
    if (!profile) return;
    const now = new Date().toISOString();
    const end = new Date(Date.now() + 3600_000).toISOString();
    const code = `7SM-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    const participants = Array.from(new Set([profile.uid, ...inviteeUids])).slice(0, 100);
    const data: Omit<Meeting, 'id'> = {
      title: title.slice(0, 160),
      meetingCode: code,
      hostUid: profile.uid,
      hostName: profile.fullName,
      type: 'instant',
      scope,
      priority: 'high',
      startTime: now,
      endTime: end,
      recurrence: 'none',
      waitingRoomEnabled: false,
      status: 'live',
      recordingConsentRequired: true,
      participantUids: participants,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    };
    const ref = await addDoc(collection(db, 'meetings'), data);
    participants
      .filter((uid) => uid !== profile.uid)
      .forEach((uid) => {
        createNotification(
          uid,
          'meeting',
          `Incoming Call: ${title}`,
          `${profile.fullName} started a call · Join code ${code}`,
          'meetings',
          ref.id
        ).catch(() => {});
      });
    setActiveMeeting({ id: ref.id, ...data });
    setTab('meetings');
  };

  const navItems: Array<{ id: WorkspaceTab; label: string; shortLabel: string; Icon: React.ElementType }> = [
    { id: 'overview', label: 'Overview', shortLabel: 'Home', Icon: LayoutDashboard },
    { id: 'messages', label: 'Messaging', shortLabel: 'Messages', Icon: MessageSquare },
    { id: 'meetings', label: 'Meetings & Calendar', shortLabel: 'Meetings', Icon: Video },
    { id: 'directory', label: 'Employee Directory', shortLabel: 'Team', Icon: Users },
    ...(canReports ? [{ id: 'reports' as const, label: 'Reports & Analytics', shortLabel: 'Reports', Icon: BarChart3 }] : []),
    ...(canAdmin ? [{ id: 'admin' as const, label: 'Administration', shortLabel: 'Admin', Icon: Shield }] : []),
    { id: 'settings', label: 'Sync & Security', shortLabel: 'Security', Icon: Settings },
  ];

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <div className="min-h-screen bg-[#F5F8FC] dark:bg-slate-950 text-[#293858] dark:text-slate-100 flex">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-white/10 bg-[#082B59] text-white flex flex-col justify-between transition-transform lg:static lg:translate-x-0 ${
          mobileMenu ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
                alt="7Sunday Meet"
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full bg-white object-contain p-0.5"
              />
              <span className="font-display font-bold text-base">7Sunday Meet</span>
            </div>
            <button type="button" onClick={() => setMobileMenu(false)} className="lg:hidden min-h-[40px] min-w-[40px] inline-flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="p-3 space-y-1">
            {navItems.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  setMobileMenu(false);
                }}
                className={`w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === id
                    ? 'bg-[#1178B9] text-white'
                    : 'text-[#EAF4FF]/85 hover:bg-white/10'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-white/10 space-y-3 text-xs bg-[#293858]">
          <div className="space-y-1">
            <p className="font-semibold truncate text-white">{profile?.fullName}</p>
            <p className="text-[#EAF4FF]/75 truncate">
              {profile ? ROLE_LABELS[profile.role] : ''}
            </p>
            <select
              value={profile?.availability || 'available'}
              onChange={(e) => updateAvailability(e.target.value as AvailabilityStatus)}
              className="w-full mt-1 min-h-[36px] rounded-lg border border-white/20 bg-[#082B59] text-white px-2.5 py-1.5 text-xs"
            >
              <option value="available">Available</option>
              <option value="busy">Busy</option>
              <option value="dnd">Do Not Disturb</option>
              <option value="away">Away</option>
            </select>
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-white/20 hover:bg-white/10 font-medium text-white"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 sm:px-6 py-3 flex items-center justify-between gap-4 pt-safe">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={() => setMobileMenu(true)} aria-label="Open menu" className="lg:hidden min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <Menu className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-[#15243A] dark:text-slate-100 truncate">
              Seven Sunday Connect / {navItems.find((i) => i.id === tab)?.label}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotifications(!showNotifications)}
                aria-label="Notifications"
                className="relative min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#1178B9] text-white text-[10px] flex items-center justify-center tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl z-50 p-4 space-y-2 max-h-96 overflow-y-auto">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Notifications</span>
                    <button type="button" onClick={() => setShowNotifications(false)}><X className="w-3.5 h-3.5" /></button>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">No notifications yet.</p>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => {
                          updateDoc(doc(db, 'notifications', n.id), { read: true });
                          if (n.linkTab === 'meetings') setTab('meetings');
                          else if (n.linkTab === 'messages') setTab('messages');
                          setShowNotifications(false);
                        }}
                        className={`p-2.5 rounded-lg border text-xs cursor-pointer ${
                          n.read ? 'border-slate-100 dark:border-slate-800 opacity-70' : 'border-[#1178B9]/30 bg-[#EAF4FF] dark:bg-[#082B59]/40'
                        }`}
                      >
                        <p className="font-semibold text-[#15243A] dark:text-slate-100">{n.title}</p>
                        <p className="text-slate-500">{n.body}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 pb-24 lg:pb-8 max-w-7xl w-full mx-auto space-y-6">
          {tab === 'overview' && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold tracking-tight text-[#15243A] dark:text-slate-100">Welcome, {profile?.fullName}</h1>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {profile?.departmentName || 'Seven Sunday Ethiopia'} · Real-Time Sync {wsConnected ? 'Connected' : 'Connecting'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => launchInstantCall(`Instant Meeting — ${profile?.fullName}`, [], 'internal')}
                    className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
                  >
                    <Video className="w-4 h-4" />
                    Start Instant Meeting
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('messages')}
                    className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-[#EAF4FF] text-xs font-medium"
                  >
                    <MessageSquare className="w-4 h-4 text-[#1178B9]" />
                    Open Messaging
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-1">
                  <p className="text-xs text-slate-500">Employees in Directory</p>
                  <p className="text-2xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">{employees.length}</p>
                  <p className="text-xs text-slate-500 tabular-nums">{onlineUsers.length} online right now</p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-1">
                  <p className="text-xs text-slate-500">Scheduled & Live Meetings</p>
                  <p className="text-2xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">
                    {visibleMeetings.filter((m) => m.status === 'live' || m.status === 'scheduled').length}
                  </p>
                  <p className="text-xs text-slate-500 tabular-nums">{visibleMeetings.length} active records</p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-1">
                  <p className="text-xs text-slate-500">Departments</p>
                  <p className="text-2xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">{visibleDepartments.length}</p>
                  <p className="text-xs text-slate-500">Organizational units</p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-1">
                  <p className="text-xs text-slate-500">Unread Notifications</p>
                  <p className="text-2xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">{unreadCount}</p>
                  <p className="text-xs text-slate-500">Real-time alerts</p>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Upcoming Meetings</h3>
                    <button type="button" onClick={() => setTab('meetings')} className="text-xs text-[#1178B9] font-medium hover:underline">
                      View Calendar
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {visibleMeetings.filter((m) => m.status === 'scheduled' || m.status === 'live').slice(0, 5).length === 0 ? (
                      <p className="py-6 text-slate-500 text-center">No upcoming meetings scheduled.</p>
                    ) : (
                      visibleMeetings
                        .filter((m) => m.status === 'scheduled' || m.status === 'live')
                        .slice(0, 5)
                        .map((m) => (
                          <div key={m.id} className="py-3 flex items-center justify-between gap-3">
                            <div>
                              <p className="font-semibold text-sm flex items-center gap-2">
                                <span>{m.title}</span>
                                {m.isDemo && (
                                  <span className="px-1.5 py-0.5 rounded bg-[#EAF4FF] text-[#082B59] text-[10px] font-semibold">DEMO</span>
                                )}
                              </p>
                              <p className="text-slate-500 tabular-nums">
                                {m.meetingCode} · {new Date(m.startTime).toLocaleString()}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveMeeting(m);
                                setTab('meetings');
                              }}
                              className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white font-medium"
                            >
                              Join
                            </button>
                          </div>
                        ))
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Online Colleagues</h3>
                    <button type="button" onClick={() => setTab('directory')} className="text-xs text-[#1178B9] font-medium hover:underline">
                      Full Directory
                    </button>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {employees.slice(0, 6).map((emp) => (
                      <div key={emp.uid} className="py-2.5 flex items-center justify-between">
                        <div>
                          <p className="font-medium text-sm">{emp.fullName}</p>
                          <p className="text-slate-500">
                            {emp.departmentName || emp.role} · {onlineUidSet.has(emp.uid) ? 'Online' : emp.availability}
                          </p>
                        </div>
                        {emp.uid !== profile?.uid && (
                          <button
                            type="button"
                            onClick={() => startDirectMessage(emp)}
                            className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
                          >
                            Message
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === 'messages' && (
            <MessagingCenter
              mode="employee"
              initialConversationId={selectedConvId}
              onStartInstantCall={(title, inviteeUids, scope) => launchInstantCall(title, inviteeUids, scope)}
            />
          )}

          {tab === 'meetings' && (
            <MeetingsHub
              employees={employees}
              departments={visibleDepartments}
              activeMeeting={activeMeeting}
              setActiveMeeting={setActiveMeeting}
              initialJoinCode={initialJoinCode}
            />
          )}

          {tab === 'directory' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={dirSearch}
                    onChange={(e) => setDirSearch(e.target.value)}
                    placeholder="Search employees by name or title..."
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2 text-xs"
                  />
                </div>
                <select
                  value={dirDeptFilter}
                  onChange={(e) => setDirDeptFilter(e.target.value)}
                  className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs"
                >
                  <option value="all">All Departments</option>
                  {visibleDepartments.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredDirectory.map((emp) => (
                  <div key={emp.uid} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">{emp.fullName}</h4>
                        <p className="text-xs text-slate-500">
                          {emp.jobTitle || ROLE_LABELS[emp.role as keyof typeof ROLE_LABELS] || emp.role}
                        </p>
                      </div>
                      <span className={`text-xs font-medium ${onlineUidSet.has(emp.uid) ? 'text-[#087CEB]' : 'text-slate-400'}`}>
                        {onlineUidSet.has(emp.uid) ? 'Online' : emp.availability}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Building2 className="w-3.5 h-3.5 text-[#1178B9]" />
                      <span>{emp.departmentName || 'General Staff'}</span>
                    </div>
                    {emp.uid !== profile?.uid && (
                      <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button
                          type="button"
                          onClick={() => startDirectMessage(emp)}
                          className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-[#1178B9]" /> Message
                        </button>
                        <button
                          type="button"
                          onClick={() => launchInstantCall(`Call with ${emp.fullName}`, [emp.uid], 'internal')}
                          className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
                        >
                          <Phone className="w-3.5 h-3.5" /> Call
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {tab === 'reports' && canReports && (
            <ReportsAnalytics
              users={allUsers.length > 0 ? allUsers : employees.map((e) => ({
                uid: e.uid,
                email: '',
                fullName: e.fullName,
                accountType: 'employee',
                role: e.role as UserAccount['role'],
                status: 'active',
                departmentId: e.departmentId,
                createdAt: e.updatedAt,
                updatedAt: e.updatedAt,
              }))}
              meetings={meetings}
              orders={orders}
              feedback={feedback}
              departments={departments}
              transactions={transactions}
              onlineCount={onlineUsers.length}
              showDemoDataDefault={showDemoData}
            />
          )}

          {tab === 'admin' && canAdmin && (
            <AdminDashboard
              users={allUsers}
              departments={departments}
              products={products}
              orders={orders}
              feedback={feedback}
              transactions={transactions}
              showDemoData={showDemoData}
            />
          )}

          {tab === 'settings' && <SyncAndSecurityCenter />}
        </main>

        <footer className="hidden lg:block bg-[#293858] text-[#EAF4FF]/80 px-6 py-3 text-xs border-t border-white/10">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <span>Seven Sunday Connect · Enterprise Collaboration Suite</span>
            <span>Real-Time Sync & WebRTC Conferencing</span>
          </div>
        </footer>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <nav
        aria-label="Mobile workspace navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 pb-safe bg-[#082B59] text-white border-t border-white/15 grid grid-cols-5"
      >
        {navItems.slice(0, 5).map(({ id, shortLabel, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
              tab === id ? 'text-white bg-[#1178B9]' : 'text-[#EAF4FF]/75'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span>{shortLabel}</span>
          </button>
        ))}
      </nav>
    </div>
  );
};
