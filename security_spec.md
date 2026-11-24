# Security Specification — Seven Sunday Connect / 7Sunday Meet

## 1. Data Invariants
1. **Strict Account Isolation**: Customer accounts (`accountType == 'customer'`) can never read `employeeDirectory`, internal `departments`, internal `roles`, `auditLogs`, `employeeInvites`, or `conversations` where `scope == 'internal'`.
2. **No Self-Privilege Escalation**: A user creating or updating their own `/users/{userId}` document can never set or modify `role`, `accountType`, `status`, or `departmentId` (except the bootstrapped Super Admin `sevenjoel326@gmail.com` or an Admin/HR Manager updating another account, or claiming a verified pending `employeeInvites` doc).
3. **Master Gate Conversation Access**: Messages inside `/conversations/{conversationId}/messages/{messageId}` can only be read or created by users who are active members of the parent conversation (and for `internal` scope, verified active employees).
4. **Order & Notification Ownership**: Customers can only read and create `/orders/{orderId}` where `customerUid == request.auth.uid`, and users can only read/update `/notifications/{notificationId}` where `targetUid == request.auth.uid`.
5. **Immutable Audit Trail**: `/auditLogs/{logId}` cannot be updated or deleted by any client role, preserving forensic integrity.
6. **Verified Identity & Temporal Integrity**: All client writes require `request.auth != null && request.auth.token.email_verified == true` and valid string length bounds (`isValidId`, `.size()` limits).

## 2. Dirty Dozen Adversarial Payloads
1. **Privilege Escalation on Signup**: Customer sends `{ uid, email, role: 'super_admin', accountType: 'employee', status: 'active' }` -> MUST FAIL.
2. **Self-Promotion on Profile Update**: Employee updates own `/users/{uid}` with `{ role: 'super_admin' }` -> MUST FAIL.
3. **Shadow Ghost Field Injection**: User creates `/products/{id}` or `/users/{uid}` with extra field `{ isVerifiedAdmin: true }` -> MUST FAIL.
4. **ID Poisoning**: Client writes to `/meetings/{1500_char_id}` or `/meetings/bad$id!` -> MUST FAIL.
5. **Cross-Tenant Customer Read of Employee Directory**: Customer attempts `get` or `list` on `/employeeDirectory` -> MUST FAIL.
6. **Internal Channel Snooping**: Customer attempts `get` or `list` on `/conversations/{internalId}/messages` -> MUST FAIL.
7. **Unverified Email Spoofing**: User with `email: 'sevenjoel326@gmail.com'` and `email_verified: false` attempts admin read -> MUST FAIL.
8. **Order Hijacking**: Customer A attempts to read or cancel Customer B's `/orders/{orderB}` -> MUST FAIL.
9. **Audit Log Tampering**: User or Admin attempts `update` or `delete` on `/auditLogs/{logId}` -> MUST FAIL.
10. **Blanket List Scraping**: User attempts `list` on `/users` or `/orders` without ownership/admin gate -> MUST FAIL.
11. **Oversized Denial-of-Wallet Payload**: User writes 50,000-char string to `ChatMessage.text` -> MUST FAIL.
12. **Terminal State Bypass**: Customer attempts to modify `/orders/{id}` items or total after status is `'delivered'` -> MUST FAIL.
