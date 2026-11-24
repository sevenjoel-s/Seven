import React, { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { WebSocketProvider } from './context/WebSocketContext';
import { ErrorBoundary } from './components/shared/ErrorBoundary';
import { OfflineIndicator } from './components/shared/PWAComponents';
import { PortalGateway } from './components/auth/PortalGateway';
import { EmployeeWorkspace } from './components/employee/EmployeeWorkspace';
import { CustomerPortal } from './components/customer/CustomerPortal';
import { MeetingsHub } from './components/meetings/MeetingsHub';
import { Meeting } from './types/domain';

const AppRouter: React.FC = () => {
  const { firebaseUser, profile, authReady, logout } = useAuth();
  const [guestJoinCode, setGuestJoinCode] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('meeting');
  });
  const [guestMeeting, setGuestMeeting] = useState<Meeting | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('meeting');
    if (code) setGuestJoinCode(code);
  }, []);

  if (!authReady) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-[#F5F8FC] dark:bg-slate-950 text-[#293858] dark:text-slate-300 text-sm">
        <img
          src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
          alt="7Sunday Meet"
          referrerPolicy="no-referrer"
          className="w-12 h-12 rounded-full object-contain animate-pulse"
        />
        <span className="font-medium">Initializing 7Sunday Meet workspace...</span>
      </div>
    );
  }

  if (!firebaseUser || !profile || !firebaseUser.emailVerified || profile.status !== 'active') {
    return (
      <PortalGateway
        onGuestJoinCode={(code) => {
          setGuestJoinCode(code);
        }}
      />
    );
  }

  // Strictly separated Customer Portal
  if (profile.accountType === 'customer') {
    return <CustomerPortal />;
  }

  // External Guest Meeting Room only
  if (profile.accountType === 'external_guest') {
    return (
      <div className="min-h-screen bg-[#F5F8FC] dark:bg-slate-950 text-[#293858] dark:text-slate-100 p-4 sm:p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-4">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
                alt="7Sunday Meet"
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-contain"
              />
              <span className="font-display font-bold text-lg text-[#082B59] dark:text-white">
                7Sunday Meet · External Guest Session
              </span>
            </div>
            <button
              type="button"
              onClick={logout}
              className="min-h-[44px] px-4 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
            >
              Exit Guest Session
            </button>
          </div>
          <MeetingsHub
            employees={[]}
            departments={[]}
            activeMeeting={guestMeeting}
            setActiveMeeting={setGuestMeeting}
            initialJoinCode={guestJoinCode}
          />
        </div>
      </div>
    );
  }

  // Internal Employee & Admin Workspace
  return <EmployeeWorkspace initialJoinCode={guestJoinCode} />;
};

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <WebSocketProvider>
            <AppRouter />
            <OfflineIndicator />
          </WebSocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
