// @vitest-environment node
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const blueprint = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf8'));
const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
const domainTypes = fs.readFileSync(path.resolve(process.cwd(), 'src/types/domain.ts'), 'utf8');

function extractValidatorFields(validatorName: string): string[] {
  const regex = new RegExp(`function ${validatorName}\\(data\\)[\\s\\S]*?hasOnly\\(\\[([\\s\\S]*?)\\]\\)`);
  const match = rules.match(regex);
  if (!match) return [];
  return Array.from(match[1].matchAll(/'([^']+)'/g)).map((m) => m[1]);
}

describe('Database Tests — Blueprint, Domain Types & Firestore Rules Alignment', () => {
  it('defines FinancialTransaction schema in blueprint, domain.ts, and firestore.rules identically', () => {
    const bpFields = Object.keys(blueprint.entities.FinancialTransaction.properties);
    const ruleFields = extractValidatorFields('isValidFinancialTransaction');

    expect(blueprint.firestore['/financialTransactions/{txId}']).toBeDefined();
    expect(ruleFields.length).toBeGreaterThan(0);

    bpFields.forEach((field) => {
      expect(ruleFields).toContain(field);
    });
    expect(domainTypes).toContain('export interface FinancialTransaction');
  });

  it('supports optional demonstration data flags (isDemo, demoBatchId) across cleanable entities', () => {
    const pairs: Array<[string, string]> = [
      ['Department', 'isValidDepartment'],
      ['Meeting', 'isValidMeeting'],
      ['Product', 'isValidProduct'],
      ['CustomerOrder', 'isValidOrder'],
      ['FinancialTransaction', 'isValidFinancialTransaction'],
      ['CustomerFeedback', 'isValidFeedback'],
    ];

    pairs.forEach(([entityName, validatorFn]) => {
      const props = Object.keys(blueprint.entities[entityName].properties);
      const ruleFields = extractValidatorFields(validatorFn);
      expect(props).toContain('isDemo');
      expect(props).toContain('demoBatchId');
      expect(ruleFields).toContain('isDemo');
      expect(ruleFields).toContain('demoBatchId');
    });
  });

  it('includes firestore paths for all core enterprise collections', () => {
    const expectedPaths = [
      '/users/{userId}',
      '/employeeDirectory/{userId}',
      '/customerDirectory/{userId}',
      '/departments/{departmentId}',
      '/conversations/{conversationId}',
      '/meetings/{meetingId}',
      '/products/{productId}',
      '/orders/{orderId}',
      '/financialTransactions/{txId}',
      '/auditLogs/{logId}',
      '/syncRecords/{syncId}',
    ];
    expectedPaths.forEach((p) => {
      expect(blueprint.firestore[p]).toBeDefined();
    });
  });
});
