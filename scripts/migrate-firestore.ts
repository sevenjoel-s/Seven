/**
 * Idempotent Firestore Migration & Bootstrap Utility for 7Sunday Ethiopia
 *
 * Usage:
 *   npx tsx scripts/migrate-firestore.ts
 *
 * Notes:
 * - Safe to run multiple times without overwriting real company records.
 * - Initializes publicConfig/appSettings & publicConfig/supportRouting if missing.
 * - Backfills missing fields (unit, availabilityStatus, galleryImages) on existing products
 *   and statusHistory on existing orders when running with Firebase Admin credentials.
 */
import 'dotenv/config';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../firebase-applet-config.json' with { type: 'json' };

async function runMigration() {
  if (!getApps().length) {
    initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }

  const db = firebaseConfig.firestoreDatabaseId
    ? getFirestore(firebaseConfig.firestoreDatabaseId)
    : getFirestore();

  const now = new Date().toISOString();

  // 1. Ensure publicConfig/appSettings exists
  const settingsRef = db.collection('publicConfig').doc('appSettings');
  const settingsSnap = await settingsRef.get();
  if (!settingsSnap.exists) {
    await settingsRef.set({ showDemoData: false, updatedAt: now });
    console.log('Initialized publicConfig/appSettings');
  }

  // 2. Sync active support staff into publicConfig/supportRouting
  const usersSnap = await db.collection('users').where('status', '==', 'active').get();
  const staffRoles = new Set(['support_agent', 'company_admin', 'super_admin', 'department_manager']);
  const agentUids: string[] = [];
  const supportAgents: Array<{
    uid: string;
    fullName: string;
    role: string;
    jobTitle?: string;
    availability: string;
  }> = [];

  usersSnap.forEach((docSnap) => {
    const u = docSnap.data();
    if (staffRoles.has(u.role)) {
      agentUids.push(u.uid);
      supportAgents.push({
        uid: u.uid,
        fullName: u.fullName || 'Support Staff',
        role: u.role,
        ...(u.jobTitle ? { jobTitle: u.jobTitle } : {}),
        availability: u.availability || 'available',
      });
    }
  });

  await db.collection('publicConfig').doc('supportRouting').set(
    {
      agentUids: agentUids.slice(0, 50),
      supportAgents: supportAgents.slice(0, 50),
      updatedAt: now,
    },
    { merge: true }
  );
  console.log(`Synced ${agentUids.length} active support agents to publicConfig/supportRouting`);

  // 3. Idempotent backfill for products lacking unit / availabilityStatus / galleryImages
  const productsSnap = await db.collection('products').get();
  let updatedProducts = 0;
  for (const docSnap of productsSnap.docs) {
    const p = docSnap.data();
    const patch: Record<string, unknown> = {};
    if (!p.unit) patch.unit = 'Piece';
    if (!p.availabilityStatus) {
      patch.availabilityStatus = (p.stock || 0) > 5 ? 'in_stock' : (p.stock || 0) > 0 ? 'low_stock' : 'out_of_stock';
    }
    if (!Array.isArray(p.galleryImages)) patch.galleryImages = p.imageUrl ? [p.imageUrl] : [];
    if (Object.keys(patch).length > 0) {
      patch.updatedAt = now;
      await docSnap.ref.update(patch);
      updatedProducts += 1;
    }
  }
  console.log(`Backfilled ${updatedProducts} product documents.`);

  // 4. Idempotent backfill for orders lacking statusHistory
  const ordersSnap = await db.collection('orders').get();
  let updatedOrders = 0;
  for (const docSnap of ordersSnap.docs) {
    const o = docSnap.data();
    if (!Array.isArray(o.statusHistory) || o.statusHistory.length === 0) {
      await docSnap.ref.update({
        statusHistory: [
          {
            status: o.status || 'pending',
            timestamp: o.updatedAt || o.createdAt || now,
            actorUid: o.customerUid || 'system',
            note: 'Migrated order status baseline',
          },
        ],
        updatedAt: now,
      });
      updatedOrders += 1;
    }
  }
  console.log(`Backfilled ${updatedOrders} order timelines.`);
  console.log('Migration complete.');
}

runMigration().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
