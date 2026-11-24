import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

describe('Responsive, Multi-Device & Brand Compliance Tests', () => {
  it('configures mobile safe areas, viewport-fit=cover, and brand navy theme color in index.html & index.css', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    const css = fs.readFileSync(path.resolve(process.cwd(), 'src/index.css'), 'utf8');

    expect(html).toContain('viewport-fit=cover');
    expect(html).toContain('content="#082B59"');
    expect(html).toContain('seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png');

    expect(css).toContain('--brand-navy: #082B59');
    expect(css).toContain('--brand-royal: #087CEB');
    expect(css).toContain('--brand-secondary: #1178B9');
    expect(css).toContain('--brand-btn-hover: #0D6096');
    expect(css).toContain('--brand-primary: #293858');
    expect(css).toContain('@media print');
    expect(css).toContain('.pb-safe');
  });

  it('includes the uploaded logo asset and all required PWA icons for Android, iPhone, Tablet & Desktop', () => {
    const publicFiles = [
      'public/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png',
      'public/apple-touch-icon.png',
      'public/pwa-192x192.png',
      'public/pwa-512x512.png',
      'public/pwa-maskable-512x512.png',
    ];
    publicFiles.forEach((rel) => {
      const full = path.resolve(process.cwd(), rel);
      expect(fs.existsSync(full)).toBe(true);
      expect(fs.statSync(full).size).toBeGreaterThan(100);
    });
  });

  it('provides mobile thumb-zone navigation bars in EmployeeWorkspace and CustomerPortal', () => {
    const emp = fs.readFileSync(path.resolve(process.cwd(), 'src/components/employee/EmployeeWorkspace.tsx'), 'utf8');
    const cust = fs.readFileSync(path.resolve(process.cwd(), 'src/components/customer/CustomerPortal.tsx'), 'utf8');

    expect(emp).toContain('lg:hidden fixed bottom-0 inset-x-0 z-30 pb-safe');
    expect(cust).toContain('lg:hidden fixed bottom-0 inset-x-0 z-30 pb-safe');
    expect(emp).toContain('min-h-[44px]');
    expect(cust).toContain('min-h-[44px]');
  });
});
