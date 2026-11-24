// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe('Security Tests — Firestore Rules, Path Hardening & Client Code Hygiene', () => {
  it('enforces default-deny global fallback and strict ID regex in firestore.rules', () => {
    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false;');
    expect(rules).toContain("id.matches('^[a-zA-Z0-9_\\\\-]+$')");
  });

  it('prevents self privilege escalation on user updates and preserves immutable audit logs', () => {
    expect(rules).toMatch(
      /incoming\(\)\.diff\(existing\(\)\)\.affectedKeys\(\)\.hasOnly\(\[\s*'fullName',\s*'phone',\s*'photoUrl',\s*'availability',\s*'mfaEnabled',\s*'biometricEnabled',\s*'updatedAt'\s*\]\)/
    );
    expect(rules).toContain('match /auditLogs/{logId}');
    expect(rules).toContain('allow update, delete: if false;');
  });

  it('prevents deletion of real financial transactions and real orders while allowing demo cleanup', () => {
    expect(rules).toContain('allow delete: if isValidId(txId) && isAdmin() && existing().isDemo == true;');
    expect(rules).toContain('allow delete: if isValidId(orderId) && isAdmin() && existing().isDemo == true;');
  });

  it('never uses forbidden window.open or window.alert or hardcoded private secrets in src/ or server.ts', () => {
    const files = [...walkFiles(path.resolve(process.cwd(), 'src')), path.resolve(process.cwd(), 'server.ts')];
    for (const f of files) {
      const content = fs.readFileSync(f, 'utf8');
      expect(content).not.toMatch(/\bwindow\.open\s*\(/);
      expect(content).not.toMatch(/\bwindow\.alert\s*\(/);
      expect(content).not.toMatch(/AIza[0-9A-Za-z_-]{35}/);
    }
  });
});
