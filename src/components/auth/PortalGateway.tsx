import React, { useState } from 'react';
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  KeyRound,
  Lock,
  Mail,
  RefreshCw,
  Shield,
  ShoppingBag,
  Smartphone,
  UserCheck,
  Users,
  Video,
} from 'lucide-react';
import { PortalIntent, useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { PWAInstallButton } from '../shared/PWAComponents';

interface PortalGatewayProps {
  onGuestJoinCode: (code: string, passcode: string) => void;
}

export const PortalGateway: React.FC<PortalGatewayProps> = ({ onGuestJoinCode }) => {
  const {
    firebaseUser,
    profile,
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    resendVerificationEmail,
    requestPasswordReset,
    logout,
    authError,
    clearAuthError,
  } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const [activePortal, setActivePortal] = useState<PortalIntent>('employee');
  const [authMode, setAuthMode] = useState<'signin' | 'register' | 'reset'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [meetingCode, setMeetingCode] = useState('');
  const [meetingPasscode, setMeetingPasscode] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const handlePortalSwitch = (intent: PortalIntent) => {
    setActivePortal(intent);
    setAuthMode('signin');
    setNotice(null);
    clearAuthError();
  };

  const handleGoogle = async () => {
    setBusy(true);
    setNotice(null);
    try {
      await signInWithGoogle(activePortal);
    } catch {
      // handled by context
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      if (authMode === 'reset') {
        await requestPasswordReset(email);
        setNotice('Password reset email dispatched. Check your inbox.');
      } else if (authMode === 'register') {
        await registerWithEmail({
          intent: activePortal,
          fullName,
          email,
          password,
          phone: activePortal === 'customer' ? phone : undefined,
        });
        setNotice('Account created. Please check your inbox and verify your email before signing in.');
      } else {
        await signInWithEmail(email, password, activePortal);
      }
    } catch {
      // handled by context
    } finally {
      setBusy(false);
    }
  };

  const handleGuestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!meetingCode.trim()) return;
    setBusy(true);
    try {
      if (!firebaseUser) {
        await signInWithGoogle('guest');
      }
      onGuestJoinCode(meetingCode.trim().toUpperCase(), meetingPasscode.trim());
    } catch {
      // handled by context
    } finally {
      setBusy(false);
    }
  };

  if (firebaseUser && profile) {
    if (!firebaseUser.emailVerified) {
      return (
        <div className="min-h-screen bg-[#F5F8FC] dark:bg-slate-950 flex items-center justify-center p-4 sm:p-6">
          <div className="max-w-md w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-5 shadow-sm">
            <div className="flex items-center gap-3 text-[#082B59] dark:text-[#EAF4FF]">
              <Mail className="w-6 h-6 text-[#1178B9]" />
              <h2 className="text-xl font-semibold text-[#15243A] dark:text-slate-100">Verify Your Email Address</h2>
            </div>
            <p className="text-sm text-[#293858] dark:text-slate-300 leading-relaxed">
              We sent a verification link to <strong className="text-[#082B59] dark:text-white">{firebaseUser.email}</strong>.
              Please confirm your email to unlock your 7Sunday Meet workspace.
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={async () => {
                  await resendVerificationEmail();
                  setNotice('Verification link resent.');
                }}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-sm font-medium"
              >
                Resend Verification Email
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium text-[#293858] dark:text-slate-200 hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
              >
                <RefreshCw className="w-4 h-4" />
                I Have Verified
              </button>
              <button
                type="button"
                onClick={logout}
                className="min-h-[44px] px-4 py-2 text-sm text-slate-500 hover:text-[#15243A] dark:hover:text-slate-200"
              >
                Sign Out
              </button>
            </div>
            {notice && <p className="text-xs text-[#1178B9] dark:text-[#087CEB]">{notice}</p>}
          </div>
        </div>
      );
    }

    if (profile.status !== 'active') {
      return (
        <div className="min-h-screen bg-[#F5F8FC] dark:bg-slate-950 flex items-center justify-center p-4 sm:p-6">
          <div className="max-w-lg w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 sm:p-8 space-y-5 shadow-sm">
            <div className="flex items-center gap-3 text-[#15243A] dark:text-slate-100">
              <Shield className="w-6 h-6 text-[#1178B9]" />
              <h2 className="text-xl font-semibold">
                {profile.status === 'pending_approval'
                  ? 'Employee Verification Pending'
                  : `Account ${profile.status.replace('_', ' ')}`}
              </h2>
            </div>
            <p className="text-sm text-[#293858] dark:text-slate-300 leading-relaxed">
              {profile.status === 'pending_approval'
                ? `Your corporate profile (${profile.email}) is queued for administrator approval. A Super Administrator or HR Manager must approve and assign your department before internal tools open.`
                : 'Your access to Seven Sunday Connect is currently restricted by an administrator. Contact IT Administration for assistance.'}
            </p>
            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 border-t border-slate-200 dark:border-slate-800 pt-4">
              <div>Account ID: <span className="font-mono">{profile.uid}</span></div>
              <div>Email: {profile.email}</div>
              <div>Status: {profile.status}</div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="min-h-[44px] px-4 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-sm font-medium"
              >
                Check Approval Status
              </button>
              <button
                type="button"
                onClick={logout}
                className="min-h-[44px] px-4 py-2 rounded-lg border border-slate-200 dark:border-slate-700 text-sm font-medium text-[#293858] dark:text-slate-200"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  return (
    <div id="top" className="min-h-screen bg-[#FFFFFF] dark:bg-slate-950 text-[#293858] dark:text-slate-100 flex flex-col">
      {/* Official Brand Header */}
      <header className="border-b border-slate-200 dark:border-slate-800 bg-[#FFFFFF] dark:bg-slate-900">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex items-center justify-between gap-4">
          <a href="#top" className="flex items-center gap-3 whitespace-nowrap shrink-0">
            <img
              src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
              alt="7Sunday Meet Logo"
              referrerPolicy="no-referrer"
              className="w-9 h-9 rounded-full object-contain"
            />
            <div>
              <span className="text-lg font-bold tracking-tight font-display text-[#082B59] dark:text-white block leading-none">
                7Sunday Meet
              </span>
              <span className="text-[11px] font-medium text-[#1178B9] dark:text-[#087CEB]">
                Seven Sunday Connect
              </span>
            </div>
          </a>

          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#293858] dark:text-slate-300">
            <a href="#portals" onClick={() => handlePortalSwitch('employee')} className="hover:text-[#087CEB] transition-colors whitespace-nowrap shrink-0">
              Employee Hub
            </a>
            <a href="#portals" onClick={() => handlePortalSwitch('customer')} className="hover:text-[#087CEB] transition-colors whitespace-nowrap shrink-0">
              Customer Portal
            </a>
            <a href="#portals" onClick={() => handlePortalSwitch('admin')} className="hover:text-[#087CEB] transition-colors whitespace-nowrap shrink-0">
              Administration
            </a>
            <a href="#capabilities" className="hover:text-[#087CEB] transition-colors whitespace-nowrap shrink-0">
              Capabilities
            </a>
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <PWAInstallButton compact />
            <button
              type="button"
              onClick={toggleTheme}
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-800 text-xs font-medium text-[#293858] dark:text-slate-200 hover:bg-[#EAF4FF] dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Split Architectural Hero + Portal Auth Panel */}
      <main id="portals" className="flex-1 bg-[#F5F8FC] dark:bg-slate-950">
        <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 lg:py-12 grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-stretch">
          {/* Left Column: Editorial Context & Visual */}
          <div className="lg:col-span-7 flex flex-col justify-between gap-7">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 rounded-lg bg-[#EAF4FF] dark:bg-[#082B59]/50 px-3 py-1.5 text-xs font-semibold text-[#082B59] dark:text-[#EAF4FF]">
                <img
                  src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
                  alt=""
                  referrerPolicy="no-referrer"
                  className="w-4 h-4 rounded-full object-contain"
                />
                <span>Seven Sunday Ethiopia · Unified Collaboration Platform</span>
              </div>
              <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight text-balance leading-tight text-[#15243A] dark:text-white">
                Enterprise meetings, real-time messaging, and isolated customer portals.
              </h1>
              <p className="text-base text-[#293858] dark:text-slate-300 max-w-2xl leading-relaxed">
                Built for high-trust corporate teams and verified customers across Android phones, iPhones, Tablets, and Desktop browsers. Collaborate via WebRTC video, interactive whiteboards, financial order ledgers, and printable enterprise reports.
              </p>
            </div>

            <div className="relative rounded-xl overflow-hidden border border-[#1178B9]/20 dark:border-slate-800 aspect-[16/9] bg-[#082B59]">
              <img
                src="/src/assets/images/workspace_conference_hero_1795502287672.jpg"
                alt="Seven Sunday executive conference room"
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#082B59]/90 via-[#082B59]/30 to-transparent flex items-end p-5 sm:p-6">
                <div className="text-white space-y-1">
                  <p className="text-sm font-semibold">Encrypted Real-Time Architecture</p>
                  <p className="text-xs text-[#EAF4FF]">
                    WebRTC Video Conferencing · 12-Role RBAC & Financial Ledger · Android, iOS, Tablet & Desktop PWA
                  </p>
                </div>
              </div>
            </div>

            <div id="capabilities" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2 border-t border-slate-200 dark:border-slate-800">
              <div className="space-y-1.5 rounded-xl bg-white dark:bg-slate-900 p-4 border border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#082B59] dark:text-white">
                  <Video className="w-4 h-4 text-[#087CEB]" />
                  <span>HD Video & Board</span>
                </div>
                <p className="text-xs text-[#293858]/80 dark:text-slate-400 leading-relaxed">
                  WebRTC video, screen share, waiting rooms, consent recording & attendance.
                </p>
              </div>
              <div className="space-y-1.5 rounded-xl bg-white dark:bg-slate-900 p-4 border border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#082B59] dark:text-white">
                  <Users className="w-4 h-4 text-[#1178B9]" />
                  <span>Isolated Portals</span>
                </div>
                <p className="text-xs text-[#293858]/80 dark:text-slate-400 leading-relaxed">
                  Strict separation for Employees, Customers, Guests, and Administrators.
                </p>
              </div>
              <div className="space-y-1.5 rounded-xl bg-white dark:bg-slate-900 p-4 border border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#082B59] dark:text-white">
                  <Lock className="w-4 h-4 text-[#087CEB]" />
                  <span>RBAC & Ledger</span>
                </div>
                <p className="text-xs text-[#293858]/80 dark:text-slate-400 leading-relaxed">
                  Permission-gated approvals, immutable audit logs & printable financial receipts.
                </p>
              </div>
              <div className="space-y-1.5 rounded-xl bg-white dark:bg-slate-900 p-4 border border-slate-200/80 dark:border-slate-800">
                <div className="flex items-center gap-2 text-xs font-semibold text-[#082B59] dark:text-white">
                  <Smartphone className="w-4 h-4 text-[#1178B9]" />
                  <span>All Devices</span>
                </div>
                <p className="text-xs text-[#293858]/80 dark:text-slate-400 leading-relaxed">
                  Adaptive PWA optimized for Android phones, iPhones, Tablets & Desktops.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Portal Sign-In & Registration Card */}
          <div className="lg:col-span-5 flex flex-col justify-center">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[#FFFFFF] dark:bg-slate-900 p-6 sm:p-8 space-y-6 shadow-sm">
              {/* Portal Selector */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-[#082B59] dark:text-slate-300 uppercase tracking-wider">
                  Select Portal Environment
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 rounded-lg bg-[#F3F5F8] dark:bg-slate-800">
                  {(
                    [
                      { id: 'employee', label: 'Employee', Icon: Building2 },
                      { id: 'customer', label: 'Customer', Icon: ShoppingBag },
                      { id: 'admin', label: 'Admin', Icon: Shield },
                      { id: 'guest', label: 'Join Meet', Icon: Video },
                    ] as const
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handlePortalSwitch(id)}
                      className={`min-h-[42px] flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                        activePortal === id
                          ? 'bg-[#082B59] text-white shadow-sm'
                          : 'text-[#293858] dark:text-slate-300 hover:bg-[#EAF4FF] dark:hover:bg-slate-700'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {activePortal === 'guest' ? (
                <form onSubmit={handleGuestSubmit} className="space-y-4">
                  <div>
                    <h2 className="text-xl font-bold text-[#15243A] dark:text-white">Join an Online Meeting</h2>
                    <p className="text-xs text-[#293858]/80 dark:text-slate-400 mt-1">
                      Enter your meeting code to join as an external guest via waiting room verification.
                    </p>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">
                        Meeting Code
                      </label>
                      <input
                        type="text"
                        required
                        value={meetingCode}
                        onChange={(e) => setMeetingCode(e.target.value)}
                        placeholder="e.g. 7SM-4829"
                        className="w-full min-h-[44px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2.5 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">
                        Meeting Passcode (if required)
                      </label>
                      <input
                        type="password"
                        value={meetingPasscode}
                        onChange={(e) => setMeetingPasscode(e.target.value)}
                        placeholder="Optional passcode"
                        className="w-full min-h-[44px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white py-2.5 px-4 text-sm font-semibold transition-colors"
                  >
                    <Video className="w-4 h-4" />
                    <span>{busy ? 'Connecting...' : 'Verify Identity & Enter Waiting Room'}</span>
                  </button>
                </form>
              ) : (
                <>
                  <div className="space-y-1">
                    <h2 className="text-xl font-bold text-[#15243A] dark:text-white">
                      {activePortal === 'employee' && 'Corporate Employee Sign-In'}
                      {activePortal === 'customer' && (authMode === 'register' ? 'Create Customer Account' : 'Customer Portal Sign-In')}
                      {activePortal === 'admin' && 'Enterprise Administration Login'}
                    </h2>
                    <p className="text-xs text-[#293858]/80 dark:text-slate-400">
                      {activePortal === 'employee' && 'Sign in with your verified corporate Google account or @sevensundayethiopia.com email.'}
                      {activePortal === 'customer' && 'Access product catalog, order tracking, invoices, financial receipts, support & community.'}
                      {activePortal === 'admin' && 'Restricted access for authorized Super Administrators, IT Admins, and HR Managers.'}
                    </p>
                  </div>

                  {/* Primary Google Sign-In */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={handleGoogle}
                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-2.5 rounded-lg border border-[#1178B9]/40 bg-[#EAF4FF]/60 dark:bg-slate-950 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 py-2.5 px-4 text-sm font-semibold text-[#082B59] dark:text-slate-100 transition-colors"
                  >
                    <UserCheck className="w-4 h-4 text-[#1178B9] dark:text-[#087CEB]" />
                    <span>
                      {activePortal === 'employee' && 'Continue with Corporate Google Account'}
                      {activePortal === 'customer' && 'Continue with Google'}
                      {activePortal === 'admin' && 'Sign In with Administrator Google Account'}
                    </span>
                  </button>

                  <div className="relative flex items-center py-1">
                    <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                    <span className="shrink mx-3 text-xs text-slate-400">or email credentials</span>
                    <div className="flex-grow border-t border-slate-200 dark:border-slate-800" />
                  </div>

                  {/* Email / Password Form */}
                  <form onSubmit={handleEmailSubmit} className="space-y-3.5">
                    {authMode === 'register' && (
                      <div>
                        <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">
                          Full Name
                        </label>
                        <input
                          type="text"
                          required
                          value={fullName}
                          onChange={(e) => setFullName(e.target.value)}
                          placeholder="Abebe Bikila"
                          className="w-full min-h-[44px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">
                        {activePortal === 'employee' ? 'Corporate Email' : 'Email Address'}
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={activePortal === 'employee' ? 'user@sevensundayethiopia.com' : 'name@example.com'}
                        className="w-full min-h-[44px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
                      />
                    </div>

                    {authMode === 'register' && activePortal === 'customer' && (
                      <div>
                        <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">
                          Phone Number
                        </label>
                        <input
                          type="tel"
                          required
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          placeholder="+251 911 000 000"
                          className="w-full min-h-[44px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
                        />
                      </div>
                    )}

                    {authMode !== 'reset' && (
                      <div>
                        <label className="block text-xs font-medium text-[#293858] dark:text-slate-300 mb-1">
                          Password
                        </label>
                        <input
                          type="password"
                          required
                          minLength={8}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="Minimum 8 characters"
                          className="w-full min-h-[44px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
                        />
                      </div>
                    )}

                    {authError && (
                      <div className="rounded-lg border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/40 p-3 text-xs text-red-700 dark:text-red-300">
                        {authError}
                      </div>
                    )}
                    {notice && (
                      <div className="rounded-lg border border-[#1178B9]/30 bg-[#EAF4FF] dark:bg-[#082B59]/40 p-3 text-xs text-[#082B59] dark:text-[#EAF4FF] flex items-start gap-2">
                        <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#1178B9]" />
                        <span>{notice}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={busy}
                      className="w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white py-2.5 px-4 text-sm font-semibold transition-colors"
                    >
                      <KeyRound className="w-4 h-4" />
                      <span>
                        {busy
                          ? 'Processing...'
                          : authMode === 'register'
                          ? 'Create Verified Account'
                          : authMode === 'reset'
                          ? 'Send Password Reset Link'
                          : 'Sign In'}
                      </span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>

                  {/* Mode switches */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[#293858]/80 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-800">
                    {activePortal !== 'admin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode(authMode === 'register' ? 'signin' : 'register');
                          clearAuthError();
                          setNotice(null);
                        }}
                        className="hover:text-[#1178B9] dark:hover:text-[#087CEB] font-medium"
                      >
                        {authMode === 'register' ? 'Already have an account? Sign In' : 'New here? Register Account'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setAuthMode(authMode === 'reset' ? 'signin' : 'reset');
                        clearAuthError();
                        setNotice(null);
                      }}
                      className="hover:text-[#082B59] dark:hover:text-slate-200"
                    >
                      {authMode === 'reset' ? 'Back to Sign In' : 'Forgot Password?'}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* Official Brand Footer (#293858) */}
      <footer className="bg-[#293858] text-white border-t border-[#082B59]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-5 flex flex-wrap items-center justify-between gap-4 text-xs text-[#EAF4FF]/90">
          <div className="flex items-center gap-2.5">
            <img
              src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
              alt="7Sunday Meet"
              referrerPolicy="no-referrer"
              className="w-6 h-6 rounded-full bg-white p-0.5 object-contain"
            />
            <span>© {new Date().getFullYear()} Seven Sunday Ethiopia · 7Sunday Meet</span>
          </div>
          <span>Encrypted Workspace · RBAC & Audit Trail · Android, iOS, Tablet & Desktop PWA</span>
        </div>
      </footer>
    </div>
  );
};
