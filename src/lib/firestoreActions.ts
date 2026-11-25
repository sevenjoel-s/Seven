import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';
import { hasPermission } from './rbac';
import {
  AuditLog,
  CallRecord,
  CustomerOrder,
  DeliveryAddress,
  FinancialTransaction,
  NotificationItem,
  OrderItem,
  OrderStatus,
  ShoppingCartItem,
  SupportAgentInfo,
  SyncRecord,
  UserAccount,
} from '../types/domain';

export async function logAuditEvent(
  actor: Pick<UserAccount, 'uid' | 'email' | 'role'>,
  action: string,
  targetType: string,
  targetId: string,
  details: string,
  severity: AuditLog['severity'] = 'info'
) {
  try {
    await addDoc(collection(db, 'auditLogs'), {
      actorUid: actor.uid,
      actorEmail: actor.email,
      actorRole: actor.role,
      action: action.slice(0, 120),
      targetType: targetType.slice(0, 64),
      targetId: targetId.slice(0, 128),
      details: details.slice(0, 1000),
      severity,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Audit log error:', error);
  }
}

export async function createNotification(
  targetUid: string,
  type: NotificationItem['type'],
  title: string,
  body: string,
  linkTab?: string,
  linkId?: string
) {
  try {
    await addDoc(collection(db, 'notifications'), {
      targetUid,
      type,
      title: title.slice(0, 140),
      body: body.slice(0, 500),
      ...(linkTab ? { linkTab } : {}),
      ...(linkId ? { linkId } : {}),
      read: false,
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, 'notifications');
  }
}

export async function recordSyncCheckpoint(
  uid: string,
  syncType: SyncRecord['syncType'],
  itemsSynced: number,
  status: SyncRecord['status'] = 'synced',
  errorMessage?: string
) {
  const deviceId = getOrCreateDeviceId();
  const deviceName = navigator.platform
    ? `${navigator.platform} — ${navigator.userAgent.includes('Chrome') ? 'Chrome' : navigator.userAgent.includes('Firefox') ? 'Firefox' : navigator.userAgent.includes('Safari') ? 'Safari' : 'Browser'}`
    : 'Web Browser';
  const now = new Date().toISOString();
  try {
    await setDoc(doc(db, 'syncRecords', `${uid}_${deviceId}_${syncType}`), {
      uid,
      deviceId,
      deviceName: deviceName.slice(0, 140),
      syncType,
      status,
      itemsSynced,
      ...(errorMessage ? { errorMessage: errorMessage.slice(0, 400) } : {}),
      createdAt: now,
      updatedAt: now,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'syncRecords');
  }
}

export function getOrCreateDeviceId(): string {
  const key = '7sunday_device_id';
  let id = window.localStorage.getItem(key);
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    id = `dev_${Math.random().toString(36).slice(2, 12)}`;
    window.localStorage.setItem(key, id);
  }
  return id;
}

export async function uploadFileToServer(file: File, token: string): Promise<{
  url: string;
  name: string;
  mime: string;
  size: number;
}> {
  const form = new FormData();
  form.append('file', file);
  const resp = await fetch('/api/uploads', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: form,
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: 'File upload failed.' }));
    throw new Error(err.error || 'File upload failed.');
  }
  return resp.json();
}

export async function savePersistentCart(customerUid: string, items: ShoppingCartItem[]) {
  const now = new Date().toISOString();
  await setDoc(doc(db, 'shoppingCarts', customerUid), {
    customerUid,
    items: items.slice(0, 50),
    updatedAt: now,
  });
}

export async function saveCustomerDeliveryAddress(
  customerUid: string,
  payload: Omit<DeliveryAddress, 'id' | 'customerUid' | 'createdAt' | 'updatedAt'>,
  existingAddresses: DeliveryAddress[]
) {
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  if (payload.isDefault) {
    existingAddresses
      .filter((a) => a.isDefault)
      .forEach((a) => {
        batch.update(doc(db, 'deliveryAddresses', a.id), { isDefault: false, updatedAt: now });
      });
  }
  const ref = doc(collection(db, 'deliveryAddresses'));
  batch.set(ref, {
    customerUid,
    label: payload.label.trim().slice(0, 60),
    recipientName: payload.recipientName.trim().slice(0, 120),
    phone: payload.phone.trim().slice(0, 40),
    city: payload.city.trim().slice(0, 80),
    ...(payload.subCity?.trim() ? { subCity: payload.subCity.trim().slice(0, 80) } : {}),
    streetAddress: payload.streetAddress.trim().slice(0, 300),
    ...(payload.notes?.trim() ? { notes: payload.notes.trim().slice(0, 300) } : {}),
    isDefault: payload.isDefault,
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();
  return ref.id;
}

export async function syncSupportRoutingDirectory(users: UserAccount[]) {
  const staffRoles = new Set(['support_agent', 'company_admin', 'super_admin', 'department_manager']);
  const activeAgents = users.filter((u) => u.status === 'active' && staffRoles.has(u.role));
  const agentUids = activeAgents.map((u) => u.uid).slice(0, 50);
  const supportAgents: SupportAgentInfo[] = activeAgents.slice(0, 50).map((u) => ({
    uid: u.uid,
    fullName: u.fullName,
    role: u.role,
    ...(u.jobTitle ? { jobTitle: u.jobTitle } : {}),
    availability: u.availability || 'available',
  }));
  await setDoc(doc(db, 'publicConfig', 'supportRouting'), {
    agentUids,
    supportAgents,
    updatedAt: new Date().toISOString(),
  });
}

export async function createCallRecord(payload: Omit<CallRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
  const now = new Date().toISOString();
  const ref = await addDoc(collection(db, 'calls'), {
    ...payload,
    createdAt: now,
    updatedAt: now,
  });
  return ref.id;
}

export async function updateCallRecord(callId: string, patch: Partial<CallRecord>) {
  const now = new Date().toISOString();
  await setDoc(
    doc(db, 'calls', callId),
    {
      ...patch,
      updatedAt: now,
    },
    { merge: true }
  );
}

const ORDER_NOTIFICATION_COPY: Record<OrderStatus, { title: string; body: string }> = {
  pending: { title: 'Order Submitted', body: 'has been submitted and is awaiting confirmation.' },
  confirmed: { title: 'Order Confirmed', body: 'has been confirmed by Seven Sunday PLC.' },
  processing: { title: 'Order Processing', body: 'is now being prepared and packed.' },
  ready_for_delivery: { title: 'Order Ready for Delivery', body: 'is packed and ready for dispatch.' },
  shipped: { title: 'Order Dispatched / Shipped', body: 'is on its way to your delivery address.' },
  delivered: { title: 'Order Delivered', body: 'has been marked as delivered.' },
  cancelled: { title: 'Order Cancelled', body: 'has been cancelled and logged on the ledger.' },
};

export async function placeOrderWithTransaction(params: {
  customer: Pick<UserAccount, 'uid' | 'fullName' | 'email' | 'role'>;
  items: OrderItem[];
  total: number;
  currency: string;
  shippingAddress: string;
  customerPhone?: string;
  deliveryCity?: string;
  notes?: string;
  paymentMethod: FinancialTransaction['method'];
}): Promise<{ orderId: string; orderNumber: string; invoiceNumber: string; txNumber: string }> {
  const now = new Date().toISOString();
  const suffix = `${Date.now().toString().slice(-6)}${Math.floor(Math.random() * 90 + 10)}`;
  const orderNumber = `ORD-${suffix}`;
  const invoiceNumber = `INV-${suffix}`;
  const txNumber = `TXN-${suffix}`;

  const orderRef = doc(collection(db, 'orders'));
  const txRef = doc(collection(db, 'financialTransactions'));
  const batch = writeBatch(db);

  batch.set(orderRef, {
    orderNumber,
    invoiceNumber,
    customerUid: params.customer.uid,
    customerName: params.customer.fullName,
    customerEmail: params.customer.email,
    ...(params.customerPhone?.trim() ? { customerPhone: params.customerPhone.trim().slice(0, 40) } : {}),
    items: params.items,
    subtotal: params.total,
    tax: 0,
    total: params.total,
    currency: params.currency,
    status: 'pending',
    statusHistory: [
      {
        status: 'pending',
        timestamp: now,
        actorUid: params.customer.uid,
        note: 'Order submitted via 7Sunday Ethiopia Customer Portal',
      },
    ],
    shippingAddress: params.shippingAddress.trim(),
    ...(params.deliveryCity?.trim() ? { deliveryCity: params.deliveryCity.trim().slice(0, 80) } : {}),
    ...(params.notes?.trim() ? { notes: params.notes.trim() } : {}),
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  });

  batch.set(txRef, {
    txNumber,
    orderId: orderRef.id,
    orderNumber,
    invoiceNumber,
    customerUid: params.customer.uid,
    customerName: params.customer.fullName,
    type: 'order_payment',
    method: params.paymentMethod,
    amount: params.total,
    currency: params.currency,
    status: params.paymentMethod === 'cash_on_delivery' ? 'pending' : 'completed',
    recordedByUid: params.customer.uid,
    notes: `Initial payment for ${orderNumber} (${params.paymentMethod.replace('_', ' ')})`,
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  });

  batch.set(doc(db, 'shoppingCarts', params.customer.uid), {
    customerUid: params.customer.uid,
    items: [],
    updatedAt: now,
  });

  await batch.commit();

  await createNotification(
    params.customer.uid,
    'order',
    `Order Submitted — ${orderNumber}`,
    `Order totaling ${params.currency} ${params.total.toFixed(2)} (Receipt ${txNumber}) submitted.`,
    'orders',
    orderRef.id
  );

  // Notify routed customer care / admin staff of the new order
  try {
    const routingSnap = await getDoc(doc(db, 'publicConfig', 'supportRouting'));
    if (routingSnap.exists()) {
      const agentUids = (routingSnap.data().agentUids || []) as string[];
      agentUids
        .filter((uid) => uid !== params.customer.uid)
        .slice(0, 8)
        .forEach((uid) => {
          createNotification(
            uid,
            'order',
            `New Customer Order ${orderNumber}`,
            `${params.customer.fullName} submitted ${params.currency} ${params.total.toFixed(2)}.`,
            'admin',
            orderRef.id
          ).catch(() => {});
        });
    }
  } catch {
    // non-fatal if routing doc hasn't been initialized yet
  }

  await logAuditEvent(
    params.customer,
    'ORDER_AND_TRANSACTION_CREATED',
    'order',
    orderRef.id,
    `${orderNumber} / ${txNumber} (${params.currency} ${params.total.toFixed(2)})`
  );

  return { orderId: orderRef.id, orderNumber, invoiceNumber, txNumber };
}

export async function processOrderStatusWithAudit(
  actor: UserAccount,
  order: CustomerOrder,
  nextStatus: CustomerOrder['status'],
  note?: string
) {
  if (!hasPermission(actor, 'orders', 'edit') && !hasPermission(actor, 'orders', 'approve')) {
    throw new Error('Permission denied: insufficient privileges to update order status.');
  }
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  const existingHistory = Array.isArray(order.statusHistory) ? order.statusHistory : [];
  const nextHistory = [
    ...existingHistory.slice(-28),
    {
      status: nextStatus,
      timestamp: now,
      actorUid: actor.uid,
      ...(note ? { note: note.slice(0, 200) } : {}),
    },
  ];
  batch.update(doc(db, 'orders', order.id), {
    status: nextStatus,
    statusHistory: nextHistory,
    updatedAt: now,
  });

  if (nextStatus === 'cancelled') {
    const refundRef = doc(collection(db, 'financialTransactions'));
    batch.set(refundRef, {
      txNumber: `TXN-RF-${Date.now().toString().slice(-6)}`,
      orderId: order.id,
      orderNumber: order.orderNumber,
      invoiceNumber: order.invoiceNumber,
      customerUid: order.customerUid,
      customerName: order.customerName,
      type: 'refund',
      method: 'credit_adjustment',
      amount: order.total,
      currency: order.currency,
      status: 'refunded',
      recordedByUid: actor.uid,
      approvedByUid: actor.uid,
      notes: `Automatic refund ledger entry on cancellation of ${order.orderNumber}`,
      isDemo: Boolean(order.isDemo),
      ...(order.demoBatchId ? { demoBatchId: order.demoBatchId } : {}),
      createdAt: now,
      updatedAt: now,
    });
  }

  await batch.commit();

  // Deduct stock cleanly when confirming a pending order
  if (order.status === 'pending' && nextStatus === 'confirmed') {
    for (const item of order.items) {
      try {
        const prodRef = doc(db, 'products', item.productId);
        const prodSnap = await getDoc(prodRef);
        if (prodSnap.exists()) {
          const currentStock = Number(prodSnap.data().stock || 0);
          const nextStock = Math.max(0, currentStock - item.quantity);
          await setDoc(
            prodRef,
            {
              stock: nextStock,
              availabilityStatus: nextStock === 0 ? 'out_of_stock' : nextStock <= 5 ? 'low_stock' : 'in_stock',
              updatedAt: now,
            },
            { merge: true }
          );
        }
      } catch {
        // Skip if product was removed
      }
    }
  }

  const copy = ORDER_NOTIFICATION_COPY[nextStatus];
  await createNotification(
    order.customerUid,
    'order',
    `${copy.title} — ${order.orderNumber}`,
    `Order ${order.orderNumber} ${copy.body}`,
    'orders',
    order.id
  );
  await logAuditEvent(
    actor,
    'ORDER_STATUS_APPROVED',
    'order',
    order.id,
    `Changed ${order.orderNumber} from ${order.status} to ${nextStatus}`,
    nextStatus === 'cancelled' ? 'warning' : 'info'
  );
}

export async function approveOrUpdateTransaction(
  actor: UserAccount,
  tx: FinancialTransaction,
  nextStatus: FinancialTransaction['status']
) {
  if (!hasPermission(actor, 'finance', 'approve') && !hasPermission(actor, 'finance', 'manage')) {
    throw new Error('Permission denied: financial approval permission required.');
  }
  const now = new Date().toISOString();
  const batch = writeBatch(db);
  batch.update(doc(db, 'financialTransactions', tx.id), {
    status: nextStatus,
    approvedByUid: actor.uid,
    updatedAt: now,
  });
  await batch.commit();
  await logAuditEvent(
    actor,
    'FINANCIAL_TRANSACTION_APPROVED',
    'financialTransaction',
    tx.id,
    `${tx.txNumber} updated to ${nextStatus} (${tx.currency} ${tx.amount.toFixed(2)})`,
    nextStatus === 'refunded' ? 'warning' : 'info'
  );
}

export async function recordManualTransaction(
  actor: UserAccount,
  payload: {
    customerUid: string;
    customerName: string;
    type: FinancialTransaction['type'];
    method: FinancialTransaction['method'];
    amount: number;
    currency: string;
    notes: string;
    orderNumber?: string;
    invoiceNumber?: string;
  }
) {
  if (!hasPermission(actor, 'finance', 'create') && !hasPermission(actor, 'finance', 'manage')) {
    throw new Error('Permission denied: cannot record financial ledger transactions.');
  }
  const now = new Date().toISOString();
  const txNumber = `TXN-${Date.now().toString().slice(-6)}`;
  const ref = await addDoc(collection(db, 'financialTransactions'), {
    txNumber,
    customerUid: payload.customerUid,
    customerName: payload.customerName.trim(),
    type: payload.type,
    method: payload.method,
    amount: payload.amount,
    currency: payload.currency,
    status: 'completed',
    recordedByUid: actor.uid,
    approvedByUid: actor.uid,
    ...(payload.orderNumber ? { orderNumber: payload.orderNumber } : {}),
    ...(payload.invoiceNumber ? { invoiceNumber: payload.invoiceNumber } : {}),
    notes: payload.notes.trim().slice(0, 500),
    isDemo: false,
    createdAt: now,
    updatedAt: now,
  });
  await logAuditEvent(
    actor,
    'FINANCIAL_TRANSACTION_RECORDED',
    'financialTransaction',
    ref.id,
    `Recorded ${txNumber} (${payload.type}) for ${payload.currency} ${payload.amount.toFixed(2)}`,
    'info'
  );
  return txNumber;
}

export async function loadOptionalDemoData(actor: UserAccount): Promise<string> {
  if (!hasPermission(actor, 'admin', 'manage') && actor.role !== 'super_admin') {
    throw new Error('Permission denied: only Administrators can load optional demonstration data.');
  }
  const batchId = `demo_${Date.now()}`;
  const now = new Date().toISOString();
  const end = new Date(Date.now() + 3600_000).toISOString();
  const batch = writeBatch(db);

  const deptRef = doc(collection(db, 'departments'));
  batch.set(deptRef, {
    name: '[DEMO] Operations & Customer Success',
    code: 'DEMO-OPS',
    description: 'Optional demonstration department (safely removable).',
    isDemo: true,
    demoBatchId: batchId,
    createdAt: now,
    updatedAt: now,
  });

  const prod1Ref = doc(collection(db, 'products'));
  batch.set(prod1Ref, {
    name: '[DEMO] Enterprise Conference Room Kit',
    sku: `DEMO-KIT-${batchId.slice(-4)}`,
    category: 'Hardware',
    description: 'Optional demo catalog item showcasing customer ordering & financial receipts.',
    price: 12500,
    currency: 'ETB',
    stock: 15,
    imageUrl: '/src/assets/images/enterprise_room_kit_1795502288635.jpg',
    active: true,
    createdBy: actor.uid,
    isDemo: true,
    demoBatchId: batchId,
    createdAt: now,
    updatedAt: now,
  });

  const orderRef = doc(collection(db, 'orders'));
  batch.set(orderRef, {
    orderNumber: `DEMO-ORD-${batchId.slice(-4)}`,
    invoiceNumber: `DEMO-INV-${batchId.slice(-4)}`,
    customerUid: actor.uid,
    customerName: '[DEMO] Addis Enterprise Client',
    customerEmail: 'demo-client@example.com',
    items: [
      {
        productId: prod1Ref.id,
        name: '[DEMO] Enterprise Conference Room Kit',
        sku: `DEMO-KIT-${batchId.slice(-4)}`,
        quantity: 2,
        unitPrice: 12500,
      },
    ],
    subtotal: 25000,
    tax: 0,
    total: 25000,
    currency: 'ETB',
    status: 'confirmed',
    shippingAddress: 'Bole Sub-City, Addis Ababa (Demo)',
    isDemo: true,
    demoBatchId: batchId,
    createdAt: now,
    updatedAt: now,
  });

  const txRef = doc(collection(db, 'financialTransactions'));
  batch.set(txRef, {
    txNumber: `DEMO-TXN-${batchId.slice(-4)}`,
    orderId: orderRef.id,
    orderNumber: `DEMO-ORD-${batchId.slice(-4)}`,
    invoiceNumber: `DEMO-INV-${batchId.slice(-4)}`,
    customerUid: actor.uid,
    customerName: '[DEMO] Addis Enterprise Client',
    type: 'order_payment',
    method: 'bank_transfer',
    amount: 25000,
    currency: 'ETB',
    status: 'completed',
    recordedByUid: actor.uid,
    approvedByUid: actor.uid,
    notes: 'Optional demonstration financial ledger entry',
    isDemo: true,
    demoBatchId: batchId,
    createdAt: now,
    updatedAt: now,
  });

  const meetRef = doc(collection(db, 'meetings'));
  batch.set(meetRef, {
    title: '[DEMO] Weekly Executive Sync',
    agenda: '1. Operations review\n2. Customer portal rollout',
    meetingCode: `DEM-${batchId.slice(-4)}`,
    hostUid: actor.uid,
    hostName: actor.fullName,
    type: 'scheduled',
    scope: 'internal',
    departmentId: deptRef.id,
    priority: 'normal',
    startTime: now,
    endTime: end,
    recurrence: 'none',
    waitingRoomEnabled: true,
    status: 'scheduled',
    recordingConsentRequired: true,
    participantUids: [actor.uid],
    isDemo: true,
    demoBatchId: batchId,
    createdAt: now,
    updatedAt: now,
  });

  const fbRef = doc(collection(db, 'customerFeedback'));
  batch.set(fbRef, {
    customerUid: actor.uid,
    customerName: '[DEMO] Addis Enterprise Client',
    orderId: orderRef.id,
    type: 'feedback',
    subject: '[DEMO] Smooth Onboarding Experience',
    message: 'Optional sample feedback entry clearly flagged as demonstration data.',
    rating: 5,
    status: 'open',
    isDemo: true,
    demoBatchId: batchId,
    createdAt: now,
    updatedAt: now,
  });

  batch.set(doc(db, 'publicConfig', 'appSettings'), {
    showDemoData: true,
    updatedAt: now,
  });

  await batch.commit();
  await logAuditEvent(actor, 'DEMO_DATA_LOADED', 'system', batchId, 'Loaded clearly tagged optional demonstration data');
  return batchId;
}

export async function removeOptionalDemoData(actor: UserAccount): Promise<number> {
  if (!hasPermission(actor, 'admin', 'manage') && actor.role !== 'super_admin') {
    throw new Error('Permission denied: only Administrators can remove demonstration data.');
  }
  const collectionsToClean = [
    'departments',
    'products',
    'orders',
    'financialTransactions',
    'meetings',
    'customerFeedback',
  ];
  let removed = 0;
  const batch = writeBatch(db);
  for (const colName of collectionsToClean) {
    const snap = await getDocs(query(collection(db, colName), where('isDemo', '==', true)));
    snap.docs.forEach((d) => {
      batch.delete(d.ref);
      removed += 1;
    });
  }
  batch.set(doc(db, 'publicConfig', 'appSettings'), {
    showDemoData: false,
    updatedAt: new Date().toISOString(),
  });
  await batch.commit();
  await logAuditEvent(
    actor,
    'DEMO_DATA_REMOVED',
    'system',
    'demo_cleanup',
    `Safely removed ${removed} optional demonstration records`,
    'info'
  );
  return removed;
}
