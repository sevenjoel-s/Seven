import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '../src/types/domain';

const addDocCalls: Array<{ path: string; data: Record<string, unknown> }> = [];
const setDocCalls: Array<{ path: string; data: Record<string, unknown> }> = [];
const updateDocCalls: Array<{ path: string; data: Record<string, unknown> }> = [];
const batchDeleteCalls: Array<{ path: string }> = [];
const batchSetCalls: Array<{ path: string; data: Record<string, unknown> }> = [];
const batchCommitMock = vi.fn(async () => {});
const startCallMock = vi.fn(async () => {});
const toggleThemeMock = vi.fn();
const updateAvailabilityMock = vi.fn(async () => {});
const logoutMock = vi.fn(async () => {});
const wsListeners = new Set<(ev: { type: string; payload?: Record<string, unknown> }) => void>();

const sampleProducts: Product[] = [
  {
    id: 'prod_fixed',
    name: 'Industrial Steel Pallet',
    sku: 'IND-100',
    category: 'Hardware',
    description: 'Heavy-duty galvanized steel pallet.',
    unit: 'Piece',
    specifications: [{ key: 'Load', value: '1500 kg' }],
    price: 4200,
    contactForPrice: false,
    currency: 'ETB',
    stock: 20,
    availabilityStatus: 'in_stock',
    imageUrl: '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png',
    galleryImages: [],
    active: true,
    createdBy: 'admin_1',
    isDemo: false,
    createdAt: '2026-11-24T08:00:00.000Z',
    updatedAt: '2026-11-24T08:00:00.000Z',
  },
  {
    id: 'prod_quote',
    name: 'Custom Automated Packaging Line',
    sku: 'LINE-900',
    category: 'Machinery',
    description: 'Configured to factory throughput requirements.',
    unit: 'System',
    specifications: [{ key: 'Power', value: '380V 3-Phase' }],
    price: 0,
    contactForPrice: true,
    currency: 'ETB',
    stock: 5,
    availabilityStatus: 'preorder',
    imageUrl: '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png',
    galleryImages: ['/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png'],
    active: true,
    createdBy: 'admin_1',
    isDemo: false,
    createdAt: '2026-11-24T09:00:00.000Z',
    updatedAt: '2026-11-24T09:00:00.000Z',
  },
];

const authState: {
  profile: {
    uid: string;
    email: string;
    fullName: string;
    phone: string;
    accountType: 'employee' | 'customer';
    role: 'super_admin' | 'customer';
    status: 'active';
    availability: 'available';
    mfaEnabled: boolean;
    createdAt: string;
    updatedAt: string;
  };
} = {
  profile: {
    uid: 'admin_1',
    email: 'sevenjoel326@gmail.com',
    fullName: 'Super Admin',
    phone: '+251911000001',
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
    firebaseUser: { uid: authState.profile.uid, email: authState.profile.email, emailVerified: true },
    profile: authState.profile,
    authReady: true,
    portalIntent: authState.profile.accountType === 'customer' ? 'customer' : 'employee',
    setPortalIntent: vi.fn(),
    getToken: vi.fn(async () => 'test-token'),
    signInWithGoogle: vi.fn(async () => {}),
    signInWithEmail: vi.fn(async () => {}),
    registerWithEmail: vi.fn(async () => {}),
    resendVerificationEmail: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    updateAvailability: updateAvailabilityMock,
    logout: logoutMock,
    authError: null,
    clearAuthError: vi.fn(),
  }),
}));

vi.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    theme: 'light',
    toggleTheme: toggleThemeMock,
  }),
}));

vi.mock('../src/context/WebSocketContext', () => ({
  useWebSocket: () => ({
    connected: true,
    onlineUsers: ['admin_1'],
    send: vi.fn(),
    subscribe: (fn: (ev: { type: string; payload?: Record<string, unknown> }) => void) => {
      wsListeners.add(fn);
      return () => {
        wsListeners.delete(fn);
      };
    },
  }),
}));

vi.mock('../src/context/DirectCallContext', () => ({
  useDirectCall: () => ({
    phase: 'idle',
    activeCall: null,
    incomingCall: null,
    localStream: null,
    remoteStream: null,
    micMuted: false,
    camOff: false,
    speakerMuted: false,
    audioOnlyFallback: false,
    peerMediaState: { micMuted: false, camOff: false, audioOnly: false },
    durationSeconds: 0,
    callError: null,
    callsHistory: [],
    supportAgents: [],
    startCall: startCallMock,
    acceptCall: vi.fn(async () => {}),
    rejectCall: vi.fn(async () => {}),
    endCall: vi.fn(async () => {}),
    toggleMic: vi.fn(),
    toggleCamera: vi.fn(async () => {}),
    switchToAudioOnly: vi.fn(),
    toggleSpeaker: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: (_db: unknown, ...segments: string[]) => ({ path: segments.join('/') }),
    doc: (dbOrCol: unknown, ...segments: string[]) => {
      if (segments.length === 0 && dbOrCol && typeof dbOrCol === 'object' && 'path' in dbOrCol) {
        const colPath = String((dbOrCol as { path: string }).path);
        return { id: 'auto_doc', path: `${colPath}/auto_doc` };
      }
      return { id: segments[segments.length - 1] || 'doc_1', path: segments.join('/') };
    },
    query: (target: unknown) => target,
    where: () => ({}),
    addDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
      addDocCalls.push({ path: ref.path, data });
      return { id: `created_${addDocCalls.length}` };
    }),
    setDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
      setDocCalls.push({ path: ref.path, data });
    }),
    updateDoc: vi.fn(async (ref: { path: string }, data: Record<string, unknown>) => {
      updateDocCalls.push({ path: ref.path, data });
    }),
    deleteDoc: vi.fn(async () => {}),
    getDocs: vi.fn(async (target: { path?: string }) => {
      if (target?.path === 'users') {
        return {
          docs: [
            { id: 'admin_1', ref: { path: 'users/admin_1' }, data: () => ({ uid: 'admin_1', role: 'super_admin' }) },
            { id: 'cust_1', ref: { path: 'users/cust_1' }, data: () => ({ uid: 'cust_1', role: 'customer' }) },
            { id: 'emp_2', ref: { path: 'users/emp_2' }, data: () => ({ uid: 'emp_2', role: 'employee' }) },
          ],
        };
      }
      if (target?.path === 'employeeDirectory') {
        return {
          docs: [
            { id: 'admin_1', ref: { path: 'employeeDirectory/admin_1' }, data: () => ({ uid: 'admin_1' }) },
            { id: 'emp_2', ref: { path: 'employeeDirectory/emp_2' }, data: () => ({ uid: 'emp_2' }) },
          ],
        };
      }
      if (target?.path === 'customerDirectory') {
        return {
          docs: [
            { id: 'cust_1', ref: { path: 'customerDirectory/cust_1' }, data: () => ({ uid: 'cust_1' }) },
          ],
        };
      }
      if (target?.path === 'employeeInvites') {
        return {
          docs: [
            { id: 'inv_1', ref: { path: 'employeeInvites/inv_1' }, data: () => ({ email: 'pending@7sunday.et' }) },
          ],
        };
      }
      return { docs: [] };
    }),
    writeBatch: () => ({
      set: vi.fn((ref: { path: string }, data: Record<string, unknown>) => {
        batchSetCalls.push({ path: ref.path, data });
      }),
      update: vi.fn(),
      delete: vi.fn((ref: { path: string }) => {
        batchDeleteCalls.push({ path: ref.path });
      }),
      commit: batchCommitMock,
    }),
    onSnapshot: (target: { path?: string }, onNext: (snap: unknown) => void) => {
      if (target?.path === 'products') {
        onNext({
          docs: sampleProducts.map((p) => ({
            id: p.id,
            data: () => p,
          })),
        });
      } else if (target?.path === 'productCategories') {
        onNext({
          docs: [
            {
              id: 'cat_1',
              data: () => ({
                name: 'Machinery',
                slug: 'machinery',
                active: true,
                createdBy: 'admin_1',
                createdAt: '2026-11-24T00:00:00.000Z',
                updatedAt: '2026-11-24T00:00:00.000Z',
              }),
            },
          ],
        });
      } else if (target?.path === 'employeeDirectory') {
        onNext({
          docs: [
            {
              id: 'emp_2',
              data: () => ({
                uid: 'emp_2',
                fullName: 'Dawit Bekele',
                role: 'support_agent',
                departmentName: 'Customer Care',
                availability: 'available',
                updatedAt: '2026-11-24T00:00:00.000Z',
              }),
            },
          ],
        });
      } else {
        onNext({
          docs: [],
          exists: () => false,
          data: () => ({}),
        });
      }
      return () => {};
    },
  };
});

import { AdminDashboard } from '../src/components/admin/AdminDashboard';
import { CustomerPortal } from '../src/components/customer/CustomerPortal';
import { EmployeeWorkspace } from '../src/components/employee/EmployeeWorkspace';
import { MeetingRoom } from '../src/components/meetings/MeetingRoom';

describe('Comprehensive End-to-End Functional Tests — Admin, Customer, Employee & Meetings', () => {
  beforeEach(() => {
    addDocCalls.length = 0;
    setDocCalls.length = 0;
    updateDocCalls.length = 0;
    batchDeleteCalls.length = 0;
    batchSetCalls.length = 0;
    batchCommitMock.mockClear();
    startCallMock.mockClear();
    toggleThemeMock.mockClear();
    updateAvailabilityMock.mockClear();
    logoutMock.mockClear();
    wsListeners.clear();
    authState.profile = {
      uid: 'admin_1',
      email: 'sevenjoel326@gmail.com',
      fullName: 'Super Admin',
      phone: '+251911000001',
      accountType: 'employee',
      role: 'super_admin',
      status: 'active',
      availability: 'available',
      mfaEnabled: false,
      createdAt: '2026-11-24T00:00:00.000Z',
      updatedAt: '2026-11-24T00:00:00.000Z',
    };
  });

  it('allows Admin to upload a product without a price using Contact for Price and navigates all Admin tabs', async () => {
    render(
      React.createElement(AdminDashboard, {
        users: [],
        departments: [],
        products: sampleProducts,
        orders: [],
        feedback: [],
        transactions: [],
      })
    );

    // Navigate across admin tabs
    fireEvent.click(screen.getByRole('button', { name: /Departments/i }));
    expect(screen.getByText(/Create Department/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /RBAC Roles/i }));
    expect(screen.getByText(/Super Administrator/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Catalog & Categories/i }));
    expect(screen.getByText(/Add Customer Product \/ Service/i)).toBeInTheDocument();
    expect(screen.getByText('Contact for Price', { selector: 'span' })).toBeInTheDocument();

    // Switch Pricing Option to "Contact for Price" (no price needed)
    fireEvent.click(screen.getByRole('button', { name: /^Contact for Price$/i }));

    fireEvent.change(screen.getByPlaceholderText(/Product Name \*/i), {
      target: { value: 'Turnkey Bottling Plant' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Product Code \/ SKU \*/i), {
      target: { value: 'BOTTLE-700' },
    });
    fireEvent.change(screen.getByPlaceholderText(/Stock \*/i), {
      target: { value: '2' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Publish Product/i }));

    await waitFor(() => {
      const created = addDocCalls.find((c) => c.path === 'products');
      expect(created).toBeDefined();
      expect(created?.data.name).toBe('Turnkey Bottling Plant');
      expect(created?.data.sku).toBe('BOTTLE-700');
      expect(created?.data.contactForPrice).toBe(true);
      expect(created?.data.price).toBe(0);
    });
  });

  it('displays Contact for Price products in CustomerPortal, opens Contact for Price modal, submits real quote inquiry, and triggers live call/cart flows', async () => {
    authState.profile = {
      ...authState.profile,
      uid: 'cust_1',
      email: 'buyer@client.et',
      fullName: 'Selamawit Tadesse',
      accountType: 'customer',
      role: 'customer',
    };

    render(React.createElement(CustomerPortal));

    // Switch to All Products via exact sidebar label
    fireEvent.click(screen.getByRole('button', { name: /^All Products$/i }));

    expect(screen.getByText('Industrial Steel Pallet')).toBeInTheDocument();
    expect(screen.getByText('Custom Automated Packaging Line')).toBeInTheDocument();
    expect(screen.getAllByText('Contact for Price').length).toBeGreaterThanOrEqual(2);

    // Click Contact for Price button on the quote-only product card
    const contactButtons = screen.getAllByRole('button', { name: /Contact for Price/i });
    fireEvent.click(contactButtons[0]);

    const dialog = screen.getByRole('dialog', { name: /Contact for Price: Custom Automated Packaging Line/i });
    expect(dialog).toBeInTheDocument();

    // Submit a real price quote request
    fireEvent.click(screen.getByRole('button', { name: /Send Price Quote Request/i }));
    await waitFor(() => {
      const fb = addDocCalls.find((c) => c.path === 'customerFeedback');
      expect(fb).toBeDefined();
      expect(fb?.data.type).toBe('inquiry');
      expect(String(fb?.data.subject)).toContain('LINE-900');
    });

    // Open Product Detail Modal on the Contact for Price product and trigger Contact for Price from inside it
    fireEvent.click(screen.getAllByRole('button', { name: /Custom Automated Packaging Line/i })[0]);
    const detailDialog = screen.getByRole('dialog', { name: /Product details for Custom Automated Packaging Line/i });
    expect(detailDialog).toBeInTheDocument();
    const modalContactBtn = screen.getAllByRole('button', { name: /Contact for Price/i }).pop()!;
    fireEvent.click(modalContactBtn);
    expect(screen.getByRole('dialog', { name: /Contact for Price: Custom Automated Packaging Line/i })).toBeInTheDocument();

    // Test Voice Call button inside Contact for Price modal
    fireEvent.click(screen.getByRole('button', { name: /Voice Call/i }));
    expect(startCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ callType: 'audio', targetQueue: true })
    );

    // Test Add to Cart on fixed-price product
    fireEvent.click(screen.getByRole('button', { name: /^All Products$/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add to Cart/i }));
    await waitFor(() => {
      const cartWrite = setDocCalls.find((c) => c.path === 'shoppingCarts/cust_1');
      expect(cartWrite).toBeDefined();
    });

    // Verify all Customer Portal tabs navigate without errors
    const tabLabels = [
      'Product Categories',
      'Shopping Cart',
      'My Orders',
      'Order Tracking',
      'Audio Call',
      'Video Call',
      'Messages',
      'Notifications',
      'My Profile',
      'Help and Support',
      'Customer Community',
      'Invited Meetings',
      'Sync & Security',
    ];
    for (const label of tabLabels) {
      fireEvent.click(screen.getAllByRole('button', { name: new RegExp(label, 'i') })[0]);
    }
    expect(screen.getByText(/Multi-Device Readiness & Platform Diagnostics/i)).toBeInTheDocument();
  });

  it('switches all EmployeeWorkspace tabs, toggles theme, and updates availability', () => {
    render(React.createElement(EmployeeWorkspace));

    // Theme toggle & availability update
    fireEvent.click(screen.getByRole('button', { name: /^Dark$/i }));
    expect(toggleThemeMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByDisplayValue('Available'), { target: { value: 'busy' } });
    expect(updateAvailabilityMock).toHaveBeenCalledWith('busy');

    // Navigate all employee workspace tabs
    const employeeTabs = [
      'Messaging',
      'Call Desk',
      'Meetings & Calendar',
      'Employee Directory',
      'Reports & Analytics',
      'Administration',
      'Sync & Security',
      'Overview',
    ];
    for (const label of employeeTabs) {
      fireEvent.click(screen.getAllByRole('button', { name: new RegExp(`^${label}$`, 'i') })[0]);
    }
    expect(screen.getByText(/Welcome, Super Admin/i)).toBeInTheDocument();
  });

  it('exercises MeetingRoom interactive controls (Mic, Video, Hand, Whiteboard, Chat, People, Leave)', async () => {
    const onLeave = vi.fn();
    const meeting = {
      id: 'm_live',
      title: 'Executive Review',
      meetingCode: 'EXEC77',
      hostUid: 'admin_1',
      hostName: 'Super Admin',
      type: 'instant' as const,
      scope: 'internal' as const,
      startTime: '2026-11-24T10:00:00.000Z',
      endTime: '2026-11-24T11:00:00.000Z',
      waitingRoomEnabled: false,
      participantUids: ['admin_1'],
      status: 'live' as const,
      createdAt: '2026-11-24T10:00:00.000Z',
      updatedAt: '2026-11-24T10:00:00.000Z',
    };

    render(React.createElement(MeetingRoom, { meeting, onLeave }));

    fireEvent.click(screen.getByRole('button', { name: /^(Mute|Unmute)$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^(Stop Video|Start Video)$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^(Raise Hand|Lower Hand)$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Whiteboard$/i }));
    expect(screen.getByText(/Collaborative Whiteboard/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Chat$/i }));
    expect(screen.getByPlaceholderText(/Send message to room/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /People \(1\)/i }));
    expect(screen.getByText(/Participants & Host Controls/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Leave$/i }));
    await waitFor(() => expect(onLeave).toHaveBeenCalledTimes(1));
  });

  it('notifies all registered users across Email, SMS, WhatsApp, Telegram, and In-App when Admin publishes or broadcasts a product', async () => {
    const fetchMock = vi.fn(async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          totalRecipients: 2,
          emailsCount: 2,
          phonesCount: 2,
          channels: {
            websocket: { requested: true, configured: true, attempted: 1, delivered: 2, failed: 0 },
            email: { requested: true, configured: false, attempted: 2, delivered: 0, failed: 0, fallbackUrl: 'mailto:?bcc=buyer%40client.et' },
            sms: { requested: true, configured: false, attempted: 2, delivered: 0, failed: 0, fallbackUrl: 'sms:+251911223344?body=New' },
            whatsapp: { requested: true, configured: false, attempted: 2, delivered: 0, failed: 0, fallbackUrl: 'https://api.whatsapp.com/send?text=New' },
            telegram: { requested: true, configured: false, attempted: 0, delivered: 0, failed: 0, fallbackUrl: 'https://t.me/share/url' },
          },
        }),
      }) as unknown as globalThis.Response
    );
    const prevFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const sampleUsers = [
        {
          uid: 'admin_1',
          email: 'sevenjoel326@gmail.com',
          fullName: 'Super Admin',
          phone: '+251911000001',
          accountType: 'employee' as const,
          role: 'super_admin' as const,
          status: 'active' as const,
          availability: 'available' as const,
          createdAt: '2026-11-24T00:00:00.000Z',
          updatedAt: '2026-11-24T00:00:00.000Z',
        },
        {
          uid: 'cust_1',
          email: 'buyer@client.et',
          fullName: 'Selamawit',
          phone: '+251911223344',
          accountType: 'customer' as const,
          role: 'customer' as const,
          status: 'active' as const,
          availability: 'available' as const,
          createdAt: '2026-11-24T00:00:00.000Z',
          updatedAt: '2026-11-24T00:00:00.000Z',
        },
      ];

      render(
        React.createElement(AdminDashboard, {
          users: sampleUsers,
          departments: [],
          products: sampleProducts,
          orders: [],
          feedback: [],
          transactions: [],
        })
      );

      fireEvent.click(screen.getByRole('button', { name: /Catalog & Categories/i }));
      const notifyBtns = screen.getAllByRole('button', { name: /Notify Users/i });
      expect(notifyBtns.length).toBeGreaterThanOrEqual(1);
      fireEvent.click(notifyBtns[0]);

      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalledWith(
          '/api/notifications/broadcast-product',
          expect.objectContaining({ method: 'POST' })
        );
        const notifWrites = batchSetCalls.filter((c) => c.path.startsWith('notifications') && c.data.type === 'product');
        expect(notifWrites.length).toBeGreaterThanOrEqual(2);
      });

      expect(screen.getByText(/Notification Broadcast Summary/i)).toBeInTheDocument();
    } finally {
      globalThis.fetch = prevFetch;
    }
  });

  it('allows Super Admin to Remove All Registered Users via two-step inline confirmation without deleting admin', async () => {
    const sampleUsers = [
      {
        uid: 'admin_1',
        email: 'sevenjoel326@gmail.com',
        fullName: 'Super Admin',
        accountType: 'employee' as const,
        role: 'super_admin' as const,
        status: 'active' as const,
        availability: 'available' as const,
        createdAt: '2026-11-24T00:00:00.000Z',
        updatedAt: '2026-11-24T00:00:00.000Z',
      },
      {
        uid: 'cust_1',
        email: 'buyer@client.et',
        fullName: 'Selamawit',
        accountType: 'customer' as const,
        role: 'customer' as const,
        status: 'active' as const,
        availability: 'available' as const,
        createdAt: '2026-11-24T00:00:00.000Z',
        updatedAt: '2026-11-24T00:00:00.000Z',
      },
    ];

    render(
      React.createElement(AdminDashboard, {
        users: sampleUsers,
        departments: [],
        products: sampleProducts,
        orders: [],
        feedback: [],
        transactions: [],
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /Remove All Registered Users/i }));
    fireEvent.click(screen.getByRole('button', { name: /Confirm Remove All/i }));

    await waitFor(() => {
      expect(batchCommitMock).toHaveBeenCalled();
      expect(batchDeleteCalls.some((d) => d.path === 'users/cust_1')).toBe(true);
      expect(batchDeleteCalls.some((d) => d.path === 'users/emp_2')).toBe(true);
      expect(batchDeleteCalls.some((d) => d.path === 'users/admin_1')).toBe(false);
    });
  });

  it('provides working Voice Call, Video Call, and Real-Time Chat across Admin Orders, Employee Directory, and CustomerPortal live product alerts', async () => {
    const onOpenDirectChat = vi.fn();
    const sampleOrders = [
      {
        id: 'ord_1',
        orderNumber: 'ORD-2026-001',
        invoiceNumber: 'INV-2026-001',
        customerUid: 'cust_1',
        customerName: 'Selamawit',
        items: [{ productId: 'prod_fixed', name: 'Steel Pallet', sku: 'IND-100', quantity: 1, unitPrice: 4200 }],
        total: 4200,
        currency: 'ETB',
        status: 'confirmed' as const,
        isDemo: false,
        createdAt: '2026-11-25T10:00:00.000Z',
        updatedAt: '2026-11-25T10:00:00.000Z',
      },
    ];

    const { unmount } = render(
      React.createElement(AdminDashboard, {
        users: [],
        departments: [],
        products: sampleProducts,
        orders: sampleOrders,
        feedback: [],
        transactions: [],
        onOpenDirectChat,
      })
    );

    fireEvent.click(screen.getByRole('button', { name: /Orders & Support/i }));
    fireEvent.click(screen.getByTitle(/Voice call Selamawit/i));
    expect(startCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetUid: 'cust_1', callType: 'audio', orderId: 'ord_1' })
    );
    unmount();

    // Employee Directory 1:1 Voice / Video / Chat
    const { unmount: unmountEmp } = render(React.createElement(EmployeeWorkspace));
    fireEvent.click(screen.getAllByRole('button', { name: /^Employee Directory$/i })[0]);
    expect(screen.getByText('Dawit Bekele')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Video$/i }));
    expect(startCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ targetUid: 'emp_2', callType: 'video' })
    );
    unmountEmp();

    // CustomerPortal receives real-time WebSocket product:published notification & supports Voice/Video/Chat on Home + mobile nav
    authState.profile = {
      ...authState.profile,
      uid: 'cust_1',
      email: 'buyer@client.et',
      fullName: 'Selamawit',
      accountType: 'customer',
      role: 'customer',
    };
    render(React.createElement(CustomerPortal));
    expect(screen.getByRole('navigation', { name: /Mobile customer navigation/i })).toBeInTheDocument();

    wsListeners.forEach((fn) =>
      fn({
        type: 'product:published',
        payload: {
          productId: 'prod_fixed',
          name: 'Industrial Steel Pallet',
          sku: 'IND-100',
          priceLabel: 'ETB 4200.00 / Piece',
        },
      })
    );

    await waitFor(() => {
      expect(screen.getByText(/New Product Posted: Industrial Steel Pallet/i)).toBeInTheDocument();
    });

    const videoButtons = screen.getAllByRole('button', { name: /^Video Call$/i });
    fireEvent.click(videoButtons[videoButtons.length - 1]);
    expect(startCallMock).toHaveBeenCalledWith(
      expect.objectContaining({ callType: 'video', targetQueue: true })
    );
  });
});
