import { describe, expect, it } from 'vitest';
import { hasPermission, isAdminRole, ROLE_LABELS, ROLE_MATRIX } from '../src/lib/rbac';
import { detectDeviceClass } from '../src/components/shared/SyncAndSecurityCenter';
import { UserAccount } from '../src/types/domain';

function makeUser(overrides: Partial<UserAccount> = {}): UserAccount {
  return {
    uid: 'user_1',
    email: 'staff@sevensundayethiopia.com',
    fullName: 'Test Staff',
    accountType: 'employee',
    role: 'employee',
    status: 'active',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Unit Tests — RBAC, Device Detection & Domain Rules', () => {
  it('enforces wildcard permissions for super_admin', () => {
    const admin = makeUser({ role: 'super_admin' });
    expect(hasPermission(admin, 'finance', 'approve')).toBe(true);
    expect(hasPermission(admin, 'admin', 'delete')).toBe(true);
    expect(isAdminRole(admin.role)).toBe(true);
  });

  it('denies all permissions when user status is not active', () => {
    const suspended = makeUser({ role: 'company_admin', status: 'suspended' });
    expect(hasPermission(suspended, 'hr', 'view')).toBe(false);
    expect(hasPermission(suspended, 'finance', 'approve')).toBe(false);
  });

  it('isolates customer and external_guest permissions strictly from corporate finance approval & admin', () => {
    const customer = makeUser({ accountType: 'customer', role: 'customer' });
    expect(hasPermission(customer, 'orders', 'create')).toBe(true);
    expect(hasPermission(customer, 'finance', 'view')).toBe(true);
    expect(hasPermission(customer, 'finance', 'approve')).toBe(false);
    expect(hasPermission(customer, 'admin', 'view')).toBe(false);

    const guest = makeUser({ accountType: 'external_guest', role: 'external_guest' });
    expect(hasPermission(guest, 'meetings', 'view')).toBe(true);
    expect(hasPermission(guest, 'orders', 'view')).toBe(false);
    expect(hasPermission(guest, 'finance', 'view')).toBe(false);
  });

  it('grants support_agent order approval and finance viewing without system admin deletion rights', () => {
    const agent = makeUser({ role: 'support_agent' });
    expect(hasPermission(agent, 'orders', 'approve')).toBe(true);
    expect(hasPermission(agent, 'finance', 'view')).toBe(true);
    expect(hasPermission(agent, 'admin', 'delete')).toBe(false);
  });

  it('covers all 12 roles cleanly in ROLE_MATRIX and ROLE_LABELS', () => {
    const keys = Object.keys(ROLE_MATRIX);
    expect(keys).toHaveLength(12);
    keys.forEach((k) => {
      expect(ROLE_LABELS[k as keyof typeof ROLE_LABELS]).toBeTruthy();
      expect(ROLE_MATRIX[k as keyof typeof ROLE_MATRIX].length).toBeGreaterThan(0);
    });
  });

  it('accurately detects Android phones, iPhones, Tablets, and Desktop browsers', () => {
    expect(detectDeviceClass('Mozilla/5.0 (Linux; Android 14; Pixel 8 Mobile)', 390).id).toBe('android');
    expect(detectDeviceClass('Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X)', 390).id).toBe('iphone');
    expect(detectDeviceClass('Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X)', 820).id).toBe('tablet');
    expect(detectDeviceClass('Mozilla/5.0 (Linux; Android 14; SM-X810)', 1024).id).toBe('tablet');
    expect(detectDeviceClass('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/125.0', 1440).id).toBe('desktop');
  });
});
