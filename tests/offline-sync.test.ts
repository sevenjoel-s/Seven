import fs from 'fs';
import path from 'path';
import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OfflineIndicator } from '../src/components/shared/PWAComponents';
import { getOrCreateDeviceId } from '../src/lib/firestoreActions';

describe('Offline & Synchronization Tests', () => {
  it('shows OfflineIndicator when browser loses connectivity and hides on reconnect', () => {
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    const { rerender } = render(React.createElement(OfflineIndicator));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: false });
      window.dispatchEvent(new Event('offline'));
    });
    rerender(React.createElement(OfflineIndicator));
    expect(screen.getByRole('status')).toHaveTextContent(/Offline Mode/i);

    act(() => {
      Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
      window.dispatchEvent(new Event('online'));
    });
    rerender(React.createElement(OfflineIndicator));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('persists and validates a stable device synchronization identifier', () => {
    window.localStorage.clear();
    const first = getOrCreateDeviceId();
    const second = getOrCreateDeviceId();
    expect(first).toMatch(/^dev_[a-z0-9]+$/);
    expect(second).toBe(first);
  });

  it('configures offline persistence and PWA precache manifest with uploaded brand assets', () => {
    const firebaseSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/lib/firebase.ts'), 'utf8');
    const viteConfigSrc = fs.readFileSync(path.resolve(process.cwd(), 'vite.config.ts'), 'utf8');

    expect(firebaseSrc).toContain('persistentLocalCache');
    expect(firebaseSrc).toContain('persistentMultipleTabManager');
    expect(viteConfigSrc).toContain('VitePWA');
    expect(viteConfigSrc).toContain('seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png');
    expect(viteConfigSrc).toContain('workbox');
  });
});
