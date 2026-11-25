import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logoutMock = vi.fn(async () => {});
const authState: {
  firebaseUser: { uid: string; email: string; emailVerified: boolean } | null;
  profile: {
    uid: string;
    email: string;
    fullName: string;
    accountType: 'employee' | 'customer' | 'external_guest';
    role: 'super_admin' | 'customer';
    status: 'active' | 'pending_approval' | 'suspended';
    availability: 'available';
    mfaEnabled: boolean;
    createdAt: string;
    updatedAt: string;
  } | null;
} = {
  firebaseUser: { uid: 'u1', email: 'user@7sunday.com', emailVerified: true },
  profile: {
    uid: 'u1',
    email: 'user@7sunday.com',
    fullName: 'Test User',
    accountType: 'employee',
    role: 'super_admin',
    status: 'active',
    availability: 'available',
    mfaEnabled: false,
    createdAt: '2026-11-24T00:00:00.000Z',
    updatedAt: '2026-11-24T00:00:00.000Z',
  },
};

vi.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    firebaseUser: authState.firebaseUser,
    profile: authState.profile,
    authReady: true,
    portalIntent: 'employee',
    setPortalIntent: vi.fn(),
    getToken: vi.fn(async () => 'test-token'),
    signInWithGoogle: vi.fn(async () => {}),
    signInWithEmail: vi.fn(async () => {}),
    registerWithEmail: vi.fn(async () => {}),
    resendVerificationEmail: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    updateAvailability: vi.fn(async () => {}),
    logout: logoutMock,
    authError: null,
    clearAuthError: vi.fn(),
  }),
}));

vi.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    toggleTheme: vi.fn(),
  }),
}));

vi.mock('../src/context/WebSocketContext', () => ({
  useWebSocket: () => ({
    connected: true,
    onlineUsers: [],
    send: vi.fn(),
    subscribe: () => () => {},
  }),
}));

vi.mock('../src/context/DirectCallContext', () => ({
  useDirectCall: () => ({
    phase: 'idle',
    activeCall: null,
    incomingCall: null,
    localStream: null,
    remoteStream: null,
    muted: false,
    speakerOn: true,
    camOff: false,
    durationSeconds: 0,
    error: null,
    startCall: vi.fn(async () => {}),
    acceptCall: vi.fn(async () => {}),
    rejectCall: vi.fn(async () => {}),
    endCall: vi.fn(async () => {}),
    toggleMute: vi.fn(),
    toggleSpeaker: vi.fn(),
    toggleCamera: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: (_db: unknown, name: string) => ({ path: name }),
    doc: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    query: (target: unknown) => target,
    where: () => ({}),
    setDoc: vi.fn(async () => {}),
    updateDoc: vi.fn(async () => {}),
    addDoc: vi.fn(async () => ({ id: 'new_doc' })),
    deleteDoc: vi.fn(async () => {}),
    onSnapshot: (_target: unknown, onNext: (snap: unknown) => void) => {
      onNext({
        docs: [],
        exists: () => false,
        data: () => ({}),
      });
      return () => {};
    },
  };
});

import { PortalGateway } from '../src/components/auth/PortalGateway';
import { SyncAndSecurityCenter } from '../src/components/shared/SyncAndSecurityCenter';
import { AdminDashboard } from '../src/components/admin/AdminDashboard';
import { EmployeeWorkspace } from '../src/components/employee/EmployeeWorkspace';
import { CustomerPortal } from '../src/components/customer/CustomerPortal';
import { MeetingRoom } from '../src/components/meetings/MeetingRoom';

describe('Logout Buttons Across All Parts of the Application', () => {
  beforeEach(() => {
    logoutMock.mockClear();
    authState.firebaseUser = { uid: 'u1', email: 'user@7sunday.com', emailVerified: true };
    authState.profile = {
      uid: 'u1',
      email: 'user@7sunday.com',
      fullName: 'Test User',
      accountType: 'employee',
      role: 'super_admin',
      status: 'active',
      availability: 'available',
      mfaEnabled: false,
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
    };
  });

  it('shows working Log Out button in PortalGateway when email is unverified, pending approval, or awaiting profile', async () => {
    authState.firebaseUser = { uid: 'u1', email: 'pending@7sunday.com', emailVerified: false };
    const { rerender } = render(React.createElement(PortalGateway, { onGuestJoinCode: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));
    expect(logoutMock).toHaveBeenCalledTimes(1);

    authState.firebaseUser = { uid: 'u1', email: 'pending@7sunday.com', emailVerified: true };
    authState.profile = { ...authState.profile!, status: 'pending_approval' };
    rerender(React.createElement(PortalGateway, { onGuestJoinCode: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));
    expect(logoutMock).toHaveBeenCalledTimes(2);

    authState.profile = null;
    rerender(React.createElement(PortalGateway, { onGuestJoinCode: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));
    expect(logoutMock).toHaveBeenCalledTimes(3);
  });

  it('shows working Log Out button in SyncAndSecurityCenter', () => {
    render(React.createElement(SyncAndSecurityCenter));
    const btn = screen.getByRole('button', { name: /Log Out/i });
    fireEvent.click(btn);
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('shows working Log Out button in AdminDashboard', () => {
    render(
      React.createElement(AdminDashboard, {
        users: [],
        departments: [],
        products: [],
        orders: [],
        feedback: [],
        transactions: [],
      })
    );
    const btn = screen.getByRole('button', { name: /Log Out/i });
    fireEvent.click(btn);
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('shows working Log Out buttons in EmployeeWorkspace header and sidebar', () => {
    render(React.createElement(EmployeeWorkspace));
    const btns = screen.getAllByRole('button', { name: /Log Out/i });
    expect(btns.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(btns[0]);
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });

  it('shows working Log Out buttons in CustomerPortal header, sidebar, and My Profile', () => {
    authState.profile = {
      ...authState.profile!,
      accountType: 'customer',
      role: 'customer',
    };
    render(React.createElement(CustomerPortal));
    const btns = screen.getAllByRole('button', { name: /Log Out/i });
    expect(btns.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(btns[1]);
    expect(logoutMock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /My Profile/i }));
    const profileLogoutBtns = screen.getAllByRole('button', { name: /Log Out/i });
    expect(profileLogoutBtns.length).toBeGreaterThanOrEqual(3);
  });

  it('shows working Log Out button inside MeetingRoom passcode gate and active meeting header', async () => {
    const meeting = {
      id: 'm1',
      title: 'Weekly Sync',
      meetingCode: 'MEET101',
      hostUid: 'host_other',
      hostName: 'Host',
      type: 'instant' as const,
      scope: 'internal' as const,
      startTime: '2026-11-24T10:00:00.000Z',
      endTime: '2026-11-24T11:00:00.000Z',
      passcode: '1234',
      waitingRoomEnabled: false,
      participantUids: ['u1'],
      status: 'live' as const,
      createdAt: '2026-11-24T10:00:00.000Z',
      updatedAt: '2026-11-24T10:00:00.000Z',
    };

    const { rerender } = render(
      React.createElement(MeetingRoom, { meeting, onLeave: vi.fn() })
    );
    fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));

    const openMeeting = { ...meeting, passcode: '', hostUid: 'u1' };
    rerender(React.createElement(MeetingRoom, { meeting: openMeeting, onLeave: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: /Log Out/i }));
    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(2));
  });
});
