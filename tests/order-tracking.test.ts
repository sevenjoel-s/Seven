import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const mockOrders = [
  {
    id: 'ord_doc_1',
    orderNumber: 'ORD-700101',
    invoiceNumber: 'INV-700101',
    customerUid: 'cust_123',
    customerName: 'Abebe Bikila',
    customerEmail: 'abebe@example.com',
    customerPhone: '+251911223344',
    items: [
      {
        productId: 'prod_1',
        name: 'Industrial Packaging Film',
        sku: 'PKG-400',
        unit: 'Roll',
        quantity: 3,
        unitPrice: 1200,
      },
    ],
    total: 3600,
    currency: 'ETB',
    status: 'ready_for_delivery',
    statusHistory: [
      { status: 'pending', timestamp: '2026-11-24T08:00:00.000Z', actorUid: 'cust_123', note: 'Submitted online' },
      { status: 'confirmed', timestamp: '2026-11-24T09:15:00.000Z', actorUid: 'staff_1', note: 'Stock verified' },
      { status: 'processing', timestamp: '2026-11-24T11:30:00.000Z', actorUid: 'staff_1', note: 'Packed on floor 2' },
      { status: 'ready_for_delivery', timestamp: '2026-11-24T14:00:00.000Z', actorUid: 'staff_1', note: 'Staged at Bole dispatch' },
    ],
    shippingAddress: 'Bole Road, House 42',
    deliveryCity: 'Addis Ababa',
    isDemo: false,
    createdAt: '2026-11-24T08:00:00.000Z',
    updatedAt: '2026-11-24T14:00:00.000Z',
  },
];

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return {
    ...actual,
    collection: (_db: unknown, name: string) => ({ path: name }),
    doc: (_db: unknown, col: string, id: string) => ({ path: `${col}/${id}` }),
    query: (target: { path: string }) => target,
    where: () => ({}),
    onSnapshot: (target: { path?: string }, onNext: (snap: unknown) => void) => {
      if (target?.path === 'orders') {
        onNext({
          docs: mockOrders.map((o) => ({
            id: o.id,
            data: () => o,
          })),
        });
      } else {
        onNext({
          exists: () => true,
          data: () => ({ showDemoData: false }),
        });
      }
      return () => {};
    },
  };
});

import { OrderTracking } from '../src/components/customer/OrderTracking';

describe('OrderTracking Component — Firestore Timeline View', () => {
  it('fetches customer orders from Firestore and displays all stages from Pending to Delivered', () => {
    const onViewInvoice = vi.fn();
    const onMessageSupport = vi.fn();
    const onCallSupport = vi.fn();
    const onVideoCallSupport = vi.fn();

    render(
      React.createElement(OrderTracking, {
        customerUid: 'cust_123',
        onViewInvoice,
        onMessageSupport,
        onCallSupport,
        onVideoCallSupport,
      })
    );

    expect(screen.getByText('ORD-700101')).toBeInTheDocument();
    expect(screen.getByText('Order ORD-700101')).toBeInTheDocument();
    expect(screen.getByText('Stage 4 of 6 (67%)')).toBeInTheDocument();

    const timeline = screen.getByRole('list', { name: /Order fulfillment timeline/i });
    expect(timeline).toHaveTextContent('Pending');
    expect(timeline).toHaveTextContent('Confirmed');
    expect(timeline).toHaveTextContent('Processing');
    expect(timeline).toHaveTextContent('Ready for Delivery');
    expect(timeline).toHaveTextContent('Shipped');
    expect(timeline).toHaveTextContent('Delivered');
    expect(timeline).toHaveTextContent('Current Stage');
    expect(timeline).toHaveTextContent('Staged at Bole dispatch');

    fireEvent.click(screen.getByText('Invoice & Print'));
    fireEvent.click(screen.getByText('Message Care'));
    fireEvent.click(screen.getByText('Voice Call'));
    fireEvent.click(screen.getByText('Video Call'));

    expect(onViewInvoice).toHaveBeenCalledTimes(1);
    expect(onMessageSupport).toHaveBeenCalledTimes(1);
    expect(onCallSupport).toHaveBeenCalledTimes(1);
    expect(onVideoCallSupport).toHaveBeenCalledTimes(1);
  });
});
