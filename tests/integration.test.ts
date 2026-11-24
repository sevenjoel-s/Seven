import http from 'http';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import type { DecodedIdToken } from 'firebase-admin/auth';
import { attachWebSocketServer, createApp } from '../server';
import { DocumentPreviewModal } from '../src/components/shared/DocumentPreviewModal';
import { SearchFilterSortBar } from '../src/components/shared/SearchFilterSortBar';

function waitForMessage(ws: WebSocket, predicate: (msg: Record<string, unknown>) => boolean, timeoutMs = 3000) {
  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);
    const handler = (raw: WebSocket.RawData) => {
      const parsed = JSON.parse(raw.toString()) as Record<string, unknown>;
      if (predicate(parsed)) {
        clearTimeout(timer);
        ws.off('message', handler);
        resolve(parsed);
      }
    };
    ws.on('message', handler);
  });
}

describe('Integration Tests — WebSocket Signaling, Presence, Whiteboard & UI Controls', () => {
  it('connects two WebSocket clients, broadcasts presence, signaling, whiteboard strokes, and enforces auth close codes', async () => {
    const app = createApp();
    const server = http.createServer(app);
    attachWebSocketServer(
      server,
      async (token) => {
        if (token === 'token-alice') {
          return { uid: 'alice', email: 'alice@example.com', name: 'Alice' } as unknown as DecodedIdToken;
        }
        if (token === 'token-bob') {
          return { uid: 'bob', email: 'bob@example.com', name: 'Bob' } as unknown as DecodedIdToken;
        }
        throw new Error('Bad token');
      },
      200
    );

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const wsUrl = `ws://127.0.0.1:${port}/ws`;

    try {
      // Unauthenticated socket should close with 4001
      const unauthWs = new WebSocket(wsUrl);
      const unauthClose = await new Promise<number>((resolve) => {
        unauthWs.on('close', (code) => resolve(code));
      });
      expect(unauthClose).toBe(4001);

      // Invalid token should close with 4003
      const badWs = new WebSocket(wsUrl);
      await new Promise<void>((resolve) => badWs.on('open', () => resolve()));
      badWs.send(JSON.stringify({ type: 'auth', token: 'wrong-token' }));
      const badClose = await new Promise<number>((resolve) => {
        badWs.on('close', (code) => resolve(code));
      });
      expect(badClose).toBe(4003);

      // Valid peers Alice & Bob join room and collaborate
      const alice = new WebSocket(wsUrl);
      const bob = new WebSocket(wsUrl);
      await Promise.all([
        new Promise<void>((resolve) => alice.on('open', () => resolve())),
        new Promise<void>((resolve) => bob.on('open', () => resolve())),
      ]);

      const aliceOk = waitForMessage(alice, (m) => m.type === 'auth:ok');
      const bobOk = waitForMessage(bob, (m) => m.type === 'auth:ok');
      alice.send(JSON.stringify({ type: 'auth', token: 'token-alice', displayName: 'Alice' }));
      bob.send(JSON.stringify({ type: 'auth', token: 'token-bob', displayName: 'Bob' }));
      await Promise.all([aliceOk, bobOk]);

      const aliceJoined = waitForMessage(alice, (m) => m.type === 'meeting:joined');
      alice.send(JSON.stringify({ type: 'meeting:join', meetingId: 'room-1' }));
      await aliceJoined;

      const peerJoined = waitForMessage(alice, (m) => m.type === 'meeting:peer-joined');
      const bobJoined = waitForMessage(bob, (m) => m.type === 'meeting:joined');
      bob.send(JSON.stringify({ type: 'meeting:join', meetingId: 'room-1' }));
      await Promise.all([peerJoined, bobJoined]);

      const bobStroke = waitForMessage(bob, (m) => m.type === 'meeting:whiteboard-stroke');
      alice.send(JSON.stringify({ type: 'meeting:whiteboard-stroke', stroke: { x0: 1, y0: 2, x1: 10, y1: 12, color: '#082B59', width: 3 } }));
      const receivedStroke = await bobStroke;
      expect((receivedStroke.stroke as { color: string }).color).toBe('#082B59');

      alice.close();
      bob.close();
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('renders DocumentPreviewModal with Print, Download, Add, Remove, and Close actions working end-to-end', () => {
    const onPrint = vi.fn();
    const onDownload = vi.fn();
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const onClose = vi.fn();

    render(
      React.createElement(DocumentPreviewModal, {
        open: true,
        title: 'Invoice INV-1001',
        subtitle: 'Customer Test',
        onPrint,
        onDownload,
        onAdd,
        onRemove,
        onClose,
        children: React.createElement('p', null, 'Line item body'),
      })
    );

    fireEvent.click(screen.getByText('Print Document'));
    fireEvent.click(screen.getByText('Download PDF'));
    fireEvent.click(screen.getByText('Add Document'));
    fireEvent.click(screen.getByText('Remove'));
    fireEvent.click(screen.getByText('Close'));

    expect(onPrint).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('triggers Search, Filter, and Sort callbacks in SearchFilterSortBar', () => {
    const onSearchChange = vi.fn();
    const onFilterChange = vi.fn();
    const onSortByChange = vi.fn();
    const onToggleSortDir = vi.fn();

    render(
      React.createElement(SearchFilterSortBar, {
        search: '',
        onSearchChange,
        searchPlaceholder: 'Search ledger...',
        filters: [
          {
            label: 'Status filter',
            value: 'all',
            onChange: onFilterChange,
            options: [
              { label: 'All', value: 'all' },
              { label: 'Completed', value: 'completed' },
            ],
          },
        ],
        sortOptions: [
          { label: 'Date', value: 'createdAt' },
          { label: 'Amount', value: 'amount' },
        ],
        sortBy: 'createdAt',
        onSortByChange,
        sortDir: 'desc',
        onToggleSortDir,
        resultCount: 5,
      })
    );

    fireEvent.change(screen.getByPlaceholderText('Search ledger...'), { target: { value: 'INV' } });
    fireEvent.change(screen.getByLabelText('Status filter'), { target: { value: 'completed' } });
    fireEvent.change(screen.getByLabelText('Sort field'), { target: { value: 'amount' } });
    fireEvent.click(screen.getByText('Desc'));

    expect(onSearchChange).toHaveBeenCalledWith('INV');
    expect(onFilterChange).toHaveBeenCalledWith('completed');
    expect(onSortByChange).toHaveBeenCalledWith('amount');
    expect(onToggleSortDir).toHaveBeenCalledTimes(1);
    expect(screen.getByText('5 records')).toBeInTheDocument();
  });
});
