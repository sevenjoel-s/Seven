import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import {
  Banknote,
  Building2,
  Check,
  Database,
  Download,
  Eye,
  Package,
  Plus,
  Shield,
  ShoppingCart,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import {
  downloadFinancialLedgerPDF,
  downloadFinancialReceiptPDF,
  downloadOrderInvoicePDF,
  exportDataToExcel,
} from '../../lib/exportUtils';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  approveOrUpdateTransaction,
  createNotification,
  loadOptionalDemoData,
  logAuditEvent,
  processOrderStatusWithAudit,
  recordManualTransaction,
  removeOptionalDemoData,
} from '../../lib/firestoreActions';
import { hasPermission, ROLE_LABELS, ROLE_MATRIX } from '../../lib/rbac';
import {
  AccountStatus,
  AuditLog,
  CustomerFeedback,
  CustomerOrder,
  Department,
  EmployeeInvite,
  FinancialTransaction,
  ModerationReport,
  Product,
  RoleDefinition,
  RoleKey,
  UserAccount,
} from '../../types/domain';
import { DocumentPreviewModal } from '../shared/DocumentPreviewModal';
import { SearchFilterSortBar } from '../shared/SearchFilterSortBar';

interface AdminDashboardProps {
  users: UserAccount[];
  departments: Department[];
  products: Product[];
  orders: CustomerOrder[];
  feedback: CustomerFeedback[];
  transactions?: FinancialTransaction[];
  showDemoData?: boolean;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  users,
  departments,
  products,
  orders,
  feedback,
  transactions = [],
  showDemoData = false,
}) => {
  const { profile, getToken } = useAuth();
  const [tab, setTab] = useState<'users' | 'departments' | 'roles' | 'catalog' | 'orders' | 'finance' | 'security'>('users');

  const [invites, setInvites] = useState<EmployeeInvite[]>([]);
  const [customRoles, setCustomRoles] = useState<RoleDefinition[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [modReports, setModReports] = useState<ModerationReport[]>([]);
  const [integrationStatus, setIntegrationStatus] = useState<Record<string, boolean | string>>({});

  // Invite form
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<RoleKey>('employee');
  const [inviteDeptId, setInviteDeptId] = useState('');
  const [inviteTitle, setInviteTitle] = useState('');

  // Department form
  const [deptName, setDeptName] = useState('');
  const [deptCode, setDeptCode] = useState('');
  const [deptDesc, setDeptDesc] = useState('');

  // Custom role form
  const [roleName, setRoleName] = useState('');
  const [rolePerms, setRolePerms] = useState('messaging:view,messaging:create,meetings:view');

  // Product form
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodCategory, setProdCategory] = useState('Hardware');
  const [prodPrice, setProdPrice] = useState('4500');
  const [prodStock, setProdStock] = useState('25');
  const [prodDesc, setProdDesc] = useState('');

  // Manual Financial Transaction form
  const [txCustomerUid, setTxCustomerUid] = useState('');
  const [txCustomerName, setTxCustomerName] = useState('');
  const [txType, setTxType] = useState<FinancialTransaction['type']>('order_payment');
  const [txMethod, setTxMethod] = useState<FinancialTransaction['method']>('bank_transfer');
  const [txAmount, setTxAmount] = useState('');
  const [txOrderNumber, setTxOrderNumber] = useState('');
  const [txNotes, setTxNotes] = useState('');

  // Document preview modals
  const [previewReceipt, setPreviewReceipt] = useState<FinancialTransaction | null>(null);
  const [previewOrder, setPreviewOrder] = useState<CustomerOrder | null>(null);

  // Table search, filter, sort states
  const [userSearch, setUserSearch] = useState('');
  const [userTypeFilter, setUserTypeFilter] = useState('all');
  const [userStatusFilter, setUserStatusFilter] = useState('all');
  const [userSortBy, setUserSortBy] = useState<'fullName' | 'createdAt' | 'role'>('fullName');
  const [userSortDir, setUserSortDir] = useState<'asc' | 'desc'>('asc');

  const [prodSearch, setProdSearch] = useState('');
  const [prodActiveFilter, setProdActiveFilter] = useState('all');
  const [prodSortBy, setProdSortBy] = useState<'name' | 'price' | 'stock'>('name');
  const [prodSortDir, setProdSortDir] = useState<'asc' | 'desc'>('asc');

  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [orderSortBy, setOrderSortBy] = useState<'createdAt' | 'total'>('createdAt');
  const [orderSortDir, setOrderSortDir] = useState<'asc' | 'desc'>('desc');

  const [txSearch, setTxSearch] = useState('');
  const [txTypeFilter, setTxTypeFilter] = useState('all');
  const [txStatusFilter, setTxStatusFilter] = useState('all');
  const [txSortBy, setTxSortBy] = useState<'createdAt' | 'amount'>('createdAt');
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('desc');

  const [auditSearch, setAuditSearch] = useState('');
  const [auditSeverityFilter, setAuditSeverityFilter] = useState('all');
  const [auditSortDir, setAuditSortDir] = useState<'asc' | 'desc'>('desc');

  const [notice, setNotice] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  useEffect(() => {
    const unsubInv = onSnapshot(collection(db, 'employeeInvites'), (snap) =>
      setInvites(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EmployeeInvite, 'id'>) })))
    );
    const unsubRoles = onSnapshot(collection(db, 'roles'), (snap) =>
      setCustomRoles(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RoleDefinition, 'id'>) })))
    );
    const unsubAudit = onSnapshot(
      collection(db, 'auditLogs'),
      (snap) =>
        setAuditLogs(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<AuditLog, 'id'>) }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .slice(0, 200)
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'auditLogs')
    );
    const unsubMod = onSnapshot(collection(db, 'moderationReports'), (snap) =>
      setModReports(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ModerationReport, 'id'>) })))
    );

    getToken().then((token) => {
      if (!token) return;
      fetch('/api/integrations/status', { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then(setIntegrationStatus)
        .catch(() => {});
    });

    return () => {
      unsubInv();
      unsubRoles();
      unsubAudit();
      unsubMod();
    };
  }, []);

  const showError = (err: unknown) => {
    setErrorMsg(err instanceof Error ? err.message : 'Operation could not be completed.');
  };

  // Filtered & sorted collections
  const filteredUsers = useMemo(() => {
    const term = userSearch.trim().toLowerCase();
    return users
      .filter((u) => {
        if (userTypeFilter !== 'all' && u.accountType !== userTypeFilter) return false;
        if (userStatusFilter !== 'all' && u.status !== userStatusFilter) return false;
        if (
          term &&
          !u.fullName.toLowerCase().includes(term) &&
          !u.email.toLowerCase().includes(term) &&
          !u.role.toLowerCase().includes(term)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp =
          userSortBy === 'createdAt'
            ? a.createdAt.localeCompare(b.createdAt)
            : userSortBy === 'role'
            ? a.role.localeCompare(b.role)
            : a.fullName.localeCompare(b.fullName);
        return userSortDir === 'asc' ? cmp : -cmp;
      });
  }, [users, userSearch, userTypeFilter, userStatusFilter, userSortBy, userSortDir]);

  const filteredProducts = useMemo(() => {
    const term = prodSearch.trim().toLowerCase();
    return products
      .filter((p) => {
        if (prodActiveFilter === 'active' && !p.active) return false;
        if (prodActiveFilter === 'hidden' && p.active) return false;
        if (prodActiveFilter === 'demo' && !p.isDemo) return false;
        if (
          term &&
          !p.name.toLowerCase().includes(term) &&
          !p.sku.toLowerCase().includes(term) &&
          !p.category.toLowerCase().includes(term)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp =
          prodSortBy === 'price'
            ? a.price - b.price
            : prodSortBy === 'stock'
            ? a.stock - b.stock
            : a.name.localeCompare(b.name);
        return prodSortDir === 'asc' ? cmp : -cmp;
      });
  }, [products, prodSearch, prodActiveFilter, prodSortBy, prodSortDir]);

  const filteredOrders = useMemo(() => {
    const term = orderSearch.trim().toLowerCase();
    return orders
      .filter((o) => {
        if (orderStatusFilter !== 'all' && o.status !== orderStatusFilter) return false;
        if (
          term &&
          !o.orderNumber.toLowerCase().includes(term) &&
          !o.invoiceNumber.toLowerCase().includes(term) &&
          !o.customerName.toLowerCase().includes(term)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp = orderSortBy === 'total' ? a.total - b.total : a.createdAt.localeCompare(b.createdAt);
        return orderSortDir === 'asc' ? cmp : -cmp;
      });
  }, [orders, orderSearch, orderStatusFilter, orderSortBy, orderSortDir]);

  const filteredTransactions = useMemo(() => {
    const term = txSearch.trim().toLowerCase();
    return transactions
      .filter((t) => {
        if (txTypeFilter !== 'all' && t.type !== txTypeFilter) return false;
        if (txStatusFilter !== 'all' && t.status !== txStatusFilter) return false;
        if (
          term &&
          !t.txNumber.toLowerCase().includes(term) &&
          !t.customerName.toLowerCase().includes(term) &&
          !(t.orderNumber || '').toLowerCase().includes(term) &&
          !(t.notes || '').toLowerCase().includes(term)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp = txSortBy === 'amount' ? a.amount - b.amount : a.createdAt.localeCompare(b.createdAt);
        return txSortDir === 'asc' ? cmp : -cmp;
      });
  }, [transactions, txSearch, txTypeFilter, txStatusFilter, txSortBy, txSortDir]);

  const filteredAuditLogs = useMemo(() => {
    const term = auditSearch.trim().toLowerCase();
    return auditLogs
      .filter((l) => {
        if (auditSeverityFilter !== 'all' && l.severity !== auditSeverityFilter) return false;
        if (
          term &&
          !(l.actorEmail || l.actorUid).toLowerCase().includes(term) &&
          !l.action.toLowerCase().includes(term) &&
          !(l.details || '').toLowerCase().includes(term)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) =>
        auditSortDir === 'asc' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)
      );
  }, [auditLogs, auditSearch, auditSeverityFilter, auditSortDir]);

  const financeSummary = useMemo(() => {
    const completed = transactions
      .filter((t) => t.status === 'completed' && t.type !== 'refund')
      .reduce((s, t) => s + t.amount, 0);
    const pending = transactions.filter((t) => t.status === 'pending').reduce((s, t) => s + t.amount, 0);
    const refunds = transactions
      .filter((t) => t.status === 'refunded' || t.type === 'refund')
      .reduce((s, t) => s + t.amount, 0);
    return { completed, pending, refunds };
  }, [transactions]);

  const updateUserAccount = async (target: UserAccount, patch: Partial<UserAccount>, auditAction: string) => {
    if (!profile) return;
    setErrorMsg(null);
    if (!hasPermission(profile, 'hr', 'edit') && !hasPermission(profile, 'admin', 'manage') && !hasPermission(profile, 'admin', 'approve')) {
      setErrorMsg('Permission denied: insufficient privileges to approve or modify user accounts.');
      return;
    }
    const now = new Date().toISOString();
    await updateDoc(doc(db, 'users', target.uid), { ...patch, updatedAt: now });

    const nextRole = patch.role || target.role;
    const nextStatus = patch.status || target.status;
    const nextDeptId = patch.departmentId ?? target.departmentId;
    const nextDeptName = patch.departmentName ?? target.departmentName;

    if (target.accountType === 'employee' && nextStatus === 'active') {
      await setDoc(
        doc(db, 'employeeDirectory', target.uid),
        {
          uid: target.uid,
          fullName: target.fullName,
          role: nextRole,
          ...(nextDeptId ? { departmentId: nextDeptId } : {}),
          ...(nextDeptName ? { departmentName: nextDeptName } : {}),
          ...(target.jobTitle ? { jobTitle: target.jobTitle } : {}),
          availability: target.availability || 'available',
          updatedAt: now,
        },
        { merge: true }
      );
    }

    if (nextStatus === 'active' && ['support_agent', 'company_admin', 'super_admin'].includes(nextRole)) {
      const supportUids = users
        .filter((u) => u.status === 'active' && ['support_agent', 'company_admin', 'super_admin'].includes(u.role))
        .map((u) => u.uid);
      if (!supportUids.includes(target.uid)) supportUids.push(target.uid);
      await setDoc(doc(db, 'publicConfig', 'supportRouting'), {
        agentUids: supportUids.slice(0, 50),
        updatedAt: now,
      }).catch(() => {});
    }

    await logAuditEvent(profile, auditAction, 'user', target.uid, `Updated ${target.email}: ${JSON.stringify(patch)}`, 'warning');
    await createNotification(target.uid, 'security', 'Account Updated', `An administrator updated your account (${auditAction}).`);
    setNotice(`Updated ${target.fullName}.`);
  };

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setErrorMsg(null);
    if (!hasPermission(profile, 'hr', 'create') && !hasPermission(profile, 'admin', 'manage')) {
      setErrorMsg('Permission denied: cannot issue employee invitations.');
      return;
    }
    const cleanEmail = inviteEmail.trim().toLowerCase();
    if (!cleanEmail.includes('@')) {
      setErrorMsg('Enter a valid corporate email address.');
      return;
    }
    const now = new Date().toISOString();
    const dept = departments.find((d) => d.id === inviteDeptId);
    await addDoc(collection(db, 'employeeInvites'), {
      email: cleanEmail,
      role: inviteRole,
      ...(dept ? { departmentId: dept.id, departmentName: dept.name } : {}),
      ...(inviteTitle ? { jobTitle: inviteTitle.trim() } : {}),
      status: 'pending',
      createdBy: profile.uid,
      createdAt: now,
      updatedAt: now,
    });
    await logAuditEvent(profile, 'EMPLOYEE_INVITED', 'invite', cleanEmail, `Role ${inviteRole}`);
    setInviteEmail('');
    setInviteTitle('');
    setNotice('Employee invitation created. When they sign in with this email, their role activates automatically.');
  };

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setErrorMsg(null);
    if (!hasPermission(profile, 'admin', 'create') && !hasPermission(profile, 'admin', 'manage')) {
      setErrorMsg('Permission denied: cannot create departments.');
      return;
    }
    if (!deptName.trim() || !deptCode.trim()) return;
    const now = new Date().toISOString();
    await addDoc(collection(db, 'departments'), {
      name: deptName.trim(),
      code: deptCode.trim().toUpperCase(),
      ...(deptDesc ? { description: deptDesc.trim() } : {}),
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    await logAuditEvent(profile, 'DEPARTMENT_CREATED', 'department', deptCode.trim(), deptName.trim());
    setDeptName('');
    setDeptCode('');
    setDeptDesc('');
    setNotice('Department created and logged in audit trail.');
  };

  const handleDeleteDepartment = async (d: Department) => {
    if (!profile) return;
    if (!hasPermission(profile, 'admin', 'delete') && !hasPermission(profile, 'admin', 'manage')) {
      setErrorMsg('Permission denied: cannot delete departments.');
      return;
    }
    await deleteDoc(doc(db, 'departments', d.id));
    await logAuditEvent(profile, 'DEPARTMENT_DELETED', 'department', d.id, `Removed ${d.name} (${d.code})`, 'warning');
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setErrorMsg(null);
    if (!hasPermission(profile, 'products', 'create') && !hasPermission(profile, 'admin', 'manage')) {
      setErrorMsg('Permission denied: cannot create catalog products.');
      return;
    }
    if (!prodName.trim() || !prodSku.trim()) return;
    const parsedPrice = Number(prodPrice);
    const parsedStock = Number(prodStock);
    if (Number.isNaN(parsedPrice) || parsedPrice < 0 || Number.isNaN(parsedStock) || parsedStock < 0) {
      setErrorMsg('Product price and stock must be valid non-negative numbers.');
      return;
    }
    const now = new Date().toISOString();
    await addDoc(collection(db, 'products'), {
      name: prodName.trim(),
      sku: prodSku.trim().toUpperCase(),
      category: prodCategory.trim() || 'General',
      description: prodDesc.trim(),
      price: parsedPrice,
      currency: 'ETB',
      stock: parsedStock,
      imageUrl: '/src/assets/images/enterprise_room_kit_1795502288635.jpg',
      active: true,
      createdBy: profile.uid,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    await logAuditEvent(profile, 'PRODUCT_CREATED', 'product', prodSku.trim(), prodName.trim());
    setProdName('');
    setProdSku('');
    setProdDesc('');
    setNotice('Product published to Customer Portal.');
  };

  const handleRecordManualTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setErrorMsg(null);
    const amount = Number(txAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorMsg('Transaction amount must be greater than zero.');
      return;
    }
    const matchedUser = users.find((u) => u.uid === txCustomerUid);
    const finalUid = matchedUser?.uid || profile.uid;
    const finalName = matchedUser?.fullName || txCustomerName.trim();
    if (!finalName) {
      setErrorMsg('Please select or enter a customer name.');
      return;
    }
    try {
      const txNum = await recordManualTransaction(profile, {
        customerUid: finalUid,
        customerName: finalName,
        type: txType,
        method: txMethod,
        amount,
        currency: 'ETB',
        orderNumber: txOrderNumber.trim() || undefined,
        notes: txNotes.trim() || `Manual ${txType.replace('_', ' ')} entry`,
      });
      setTxAmount('');
      setTxOrderNumber('');
      setTxNotes('');
      setTxCustomerName('');
      setNotice(`Financial ledger transaction ${txNum} recorded and audited.`);
    } catch (err) {
      showError(err);
    }
  };

  const handleLoadDemo = async () => {
    if (!profile) return;
    setDemoBusy(true);
    setErrorMsg(null);
    try {
      await loadOptionalDemoData(profile);
      setNotice('Optional demonstration data loaded and clearly tagged with [DEMO]. Real company records are untouched.');
    } catch (err) {
      showError(err);
    } finally {
      setDemoBusy(false);
    }
  };

  const handleToggleDemoVisibility = async () => {
    if (!profile) return;
    if (!hasPermission(profile, 'admin', 'manage') && profile.role !== 'super_admin') {
      setErrorMsg('Permission denied: only administrators can toggle demonstration visibility.');
      return;
    }
    await setDoc(doc(db, 'publicConfig', 'appSettings'), {
      showDemoData: !showDemoData,
      updatedAt: new Date().toISOString(),
    });
    await logAuditEvent(profile, 'DEMO_VISIBILITY_TOGGLED', 'system', 'appSettings', `showDemoData=${!showDemoData}`);
    setNotice(`Optional demonstration data visibility set to ${!showDemoData ? 'Enabled' : 'Disabled'}.`);
  };

  const handleRemoveDemo = async () => {
    if (!profile) return;
    setDemoBusy(true);
    setErrorMsg(null);
    try {
      const count = await removeOptionalDemoData(profile);
      setNotice(`Safely removed ${count} tagged demonstration records without affecting any real company data.`);
    } catch (err) {
      showError(err);
    } finally {
      setDemoBusy(false);
    }
  };

  const demoRecordCount = useMemo(
    () =>
      departments.filter((d) => d.isDemo).length +
      products.filter((p) => p.isDemo).length +
      orders.filter((o) => o.isDemo).length +
      transactions.filter((t) => t.isDemo).length +
      feedback.filter((f) => f.isDemo).length,
    [departments, products, orders, transactions, feedback]
  );

  return (
    <div className="space-y-6">
      {notice && (
        <div className="rounded-xl border border-[#1178B9]/30 bg-[#EAF4FF] dark:bg-[#082B59]/40 p-3 text-xs text-[#082B59] dark:text-[#EAF4FF] flex items-center justify-between">
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="font-semibold underline ml-2">Dismiss</button>
        </div>
      )}
      {errorMsg && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 flex items-center justify-between">
          <span>{errorMsg}</span>
          <button type="button" onClick={() => setErrorMsg(null)} className="font-semibold underline ml-2">Dismiss</button>
        </div>
      )}

      {/* Admin Navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl bg-[#F3F5F8] dark:bg-slate-800 w-full sm:w-fit">
        {(
          [
            { id: 'users', label: 'Users & Invites', Icon: Users },
            { id: 'departments', label: 'Departments', Icon: Building2 },
            { id: 'roles', label: 'RBAC Roles', Icon: Shield },
            { id: 'catalog', label: 'Product Catalog', Icon: Package },
            { id: 'orders', label: 'Orders & Support', Icon: ShoppingCart },
            { id: 'finance', label: 'Financial Ledger', Icon: Banknote },
            { id: 'security', label: 'Audit & Demo Data', Icon: Database },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === id
                ? 'bg-[#082B59] text-white shadow-sm'
                : 'text-[#293858] dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-700'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {/* 1. USERS & INVITES */}
      {tab === 'users' && (
        <div className="space-y-4">
          <form onSubmit={handleCreateInvite} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#15243A] dark:text-slate-100">
              <UserPlus className="w-4 h-4 text-[#1178B9]" />
              <span>Pre-Authorize Corporate Employee</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="employee@sevensundayethiopia.com"
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as RoleKey)}
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              >
                {Object.entries(ROLE_LABELS)
                  .filter(([k]) => k !== 'customer' && k !== 'external_guest')
                  .map(([k, label]) => (
                    <option key={k} value={k}>{label}</option>
                  ))}
              </select>
              <select
                value={inviteDeptId}
                onChange={(e) => setInviteDeptId(e.target.value)}
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              >
                <option value="">Select Department</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <input
                type="text"
                value={inviteTitle}
                onChange={(e) => setInviteTitle(e.target.value)}
                placeholder="Job Title"
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              />
              <button type="submit" className="min-h-[40px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white px-4 py-2 text-xs font-medium">
                Issue Invite
              </button>
            </div>
            {invites.length > 0 && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-xs space-y-1">
                <p className="font-medium text-slate-500">Issued Invitations ({invites.length})</p>
                <div className="flex flex-wrap gap-3">
                  {invites.map((inv) => (
                    <span key={inv.id} className="text-[#293858] dark:text-slate-300">
                      {inv.email} ({inv.role} · {inv.status})
                    </span>
                  ))}
                </div>
              </div>
            )}
          </form>

          <SearchFilterSortBar
            search={userSearch}
            onSearchChange={setUserSearch}
            searchPlaceholder="Search users by name, email, or role..."
            filters={[
              {
                label: 'Account type filter',
                value: userTypeFilter,
                onChange: setUserTypeFilter,
                options: [
                  { label: 'All Account Types', value: 'all' },
                  { label: 'Employees', value: 'employee' },
                  { label: 'Customers', value: 'customer' },
                  { label: 'External Guests', value: 'external_guest' },
                ],
              },
              {
                label: 'Account status filter',
                value: userStatusFilter,
                onChange: setUserStatusFilter,
                options: [
                  { label: 'All Statuses', value: 'all' },
                  { label: 'Active', value: 'active' },
                  { label: 'Pending Approval', value: 'pending_approval' },
                  { label: 'Suspended', value: 'suspended' },
                  { label: 'Deactivated', value: 'deactivated' },
                  { label: 'Blocked', value: 'blocked' },
                ],
              },
            ]}
            sortOptions={[
              { label: 'Name', value: 'fullName' },
              { label: 'Role', value: 'role' },
              { label: 'Created Date', value: 'createdAt' },
            ]}
            sortBy={userSortBy}
            onSortByChange={(v) => setUserSortBy(v as typeof userSortBy)}
            sortDir={userSortDir}
            onToggleSortDir={() => setUserSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            resultCount={filteredUsers.length}
          />

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-[#EAF4FF] dark:bg-slate-950 text-[#082B59] dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">Role</th>
                  <th className="px-4 py-3 font-semibold">Department</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredUsers.map((u) => (
                  <tr key={u.uid} className="hover:bg-[#F5F8FC] dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#15243A] dark:text-slate-100">{u.fullName}</div>
                      <div className="text-slate-500">{u.email}</div>
                    </td>
                    <td className="px-4 py-3 capitalize">{u.accountType.replace('_', ' ')}</td>
                    <td className="px-4 py-3">
                      <select
                        value={u.role}
                        disabled={u.uid === profile?.uid && u.role === 'super_admin'}
                        onChange={(e) => updateUserAccount(u, { role: e.target.value as RoleKey }, 'ROLE_CHANGED')}
                        className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                      >
                        {Object.entries(ROLE_LABELS).map(([k, label]) => (
                          <option key={k} value={k}>{label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {u.accountType === 'employee' ? (
                        <select
                          value={u.departmentId || ''}
                          onChange={(e) => {
                            const d = departments.find((x) => x.id === e.target.value);
                            updateUserAccount(
                              u,
                              { departmentId: d?.id || '', departmentName: d?.name || '' },
                              'DEPARTMENT_ASSIGNED'
                            );
                          }}
                          className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                        >
                          <option value="">Unassigned</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={u.status}
                        disabled={u.uid === profile?.uid}
                        onChange={(e) => updateUserAccount(u, { status: e.target.value as AccountStatus }, 'STATUS_CHANGED')}
                        className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                      >
                        <option value="active">Active</option>
                        <option value="pending_approval">Pending Approval</option>
                        <option value="suspended">Suspended</option>
                        <option value="deactivated">Deactivated</option>
                        <option value="blocked">Blocked</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      {u.status === 'pending_approval' && (
                        <button
                          type="button"
                          onClick={() => updateUserAccount(u, { status: 'active' }, 'EMPLOYEE_APPROVED')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1178B9] hover:bg-[#0D6096] text-white"
                        >
                          <Check className="w-3 h-3" /> Approve
                        </button>
                      )}
                      {u.uid !== profile?.uid && profile?.role === 'super_admin' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteDoc(doc(db, 'users', u.uid));
                            await logAuditEvent(profile, 'USER_DELETED', 'user', u.uid, `Deleted ${u.email}`, 'critical');
                          }}
                          className="text-red-600 hover:text-red-700"
                          title="Delete Account"
                        >
                          <Trash2 className="w-4 h-4 inline" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 2. DEPARTMENTS */}
      {tab === 'departments' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleCreateDepartment} className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
            <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Create Department</h3>
            <input type="text" required value={deptName} onChange={(e) => setDeptName(e.target.value)} placeholder="Department Name (e.g. Engineering)" className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
            <input type="text" required value={deptCode} onChange={(e) => setDeptCode(e.target.value)} placeholder="Code (e.g. ENG)" className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs uppercase" />
            <textarea rows={2} value={deptDesc} onChange={(e) => setDeptDesc(e.target.value)} placeholder="Description" className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
            <button type="submit" className="w-full min-h-[40px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white py-2 text-xs font-medium">Add Department</button>
          </form>
          <div className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {departments.length === 0 ? (
              <p className="p-8 text-center text-xs text-slate-500">No departments created yet.</p>
            ) : (
              departments.map((d) => (
                <div key={d.id} className="p-4 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-2">
                      <span>{d.name}</span>
                      <span className="font-mono text-xs text-slate-400">({d.code})</span>
                      {d.isDemo && (
                        <span className="px-1.5 py-0.5 rounded bg-[#EAF4FF] text-[#082B59] text-[10px] font-semibold">
                          DEMO
                        </span>
                      )}
                    </p>
                    {d.description && <p className="text-xs text-slate-500">{d.description}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteDepartment(d)}
                    className="text-red-600 hover:text-red-700 p-2"
                    aria-label={`Delete ${d.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 3. RBAC ROLES */}
      {tab === 'roles' && (
        <div className="space-y-6">
          {profile?.role === 'super_admin' && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!roleName.trim()) return;
                const now = new Date().toISOString();
                const ref = await addDoc(collection(db, 'roles'), {
                  key: roleName.trim().toLowerCase().replace(/\s+/g, '_'),
                  name: roleName.trim(),
                  permissions: rolePerms.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 40),
                  isSystem: false,
                  createdAt: now,
                  updatedAt: now,
                });
                await logAuditEvent(profile, 'ROLE_DEFINITION_CREATED', 'role', ref.id, `Created custom role ${roleName.trim()}`);
                setRoleName('');
                setNotice('Custom RBAC role saved and audited.');
              }}
              className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 grid grid-cols-1 md:grid-cols-3 gap-3"
            >
              <input type="text" required value={roleName} onChange={(e) => setRoleName(e.target.value)} placeholder="Custom Role Name" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
              <input type="text" required value={rolePerms} onChange={(e) => setRolePerms(e.target.value)} placeholder="module:action, ..." className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs font-mono" />
              <button type="submit" className="min-h-[40px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white px-4 py-2 text-xs font-medium">Create Custom Role</button>
            </form>
          )}

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            {Object.entries(ROLE_MATRIX).map(([key, perms]) => (
              <div key={key} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                <div>
                  <p className="font-semibold text-sm text-[#15243A] dark:text-slate-100">{ROLE_LABELS[key as RoleKey]}</p>
                  <p className="font-mono text-slate-400">{key}</p>
                </div>
                <p className="font-mono text-[#293858] dark:text-slate-300 max-w-xl">{perms.join(' · ')}</p>
              </div>
            ))}
            {customRoles.map((cr) => (
              <div key={cr.id} className="p-4 flex items-center justify-between gap-2 text-xs">
                <div>
                  <p className="font-semibold text-sm">{cr.name} (Custom)</p>
                  <p className="font-mono text-slate-500">{cr.permissions.join(' · ')}</p>
                </div>
                {profile?.role === 'super_admin' && (
                  <button
                    type="button"
                    onClick={async () => {
                      await deleteDoc(doc(db, 'roles', cr.id));
                      await logAuditEvent(profile, 'ROLE_DEFINITION_DELETED', 'role', cr.id, `Deleted custom role ${cr.name}`, 'warning');
                    }}
                    className="text-red-600 p-1"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 4. PRODUCT CATALOG */}
      {tab === 'catalog' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <form onSubmit={handleCreateProduct} className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-[#15243A] dark:text-slate-100"><Plus className="w-4 h-4 text-[#1178B9]" /> Add Customer Product / Service</h3>
            <input type="text" required value={prodName} onChange={(e) => setProdName(e.target.value)} placeholder="Product Name" className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
            <div className="grid grid-cols-2 gap-2">
              <input type="text" required value={prodSku} onChange={(e) => setProdSku(e.target.value)} placeholder="SKU" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs uppercase" />
              <input type="text" required value={prodCategory} onChange={(e) => setProdCategory(e.target.value)} placeholder="Category" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input type="number" min={0} step="0.01" required value={prodPrice} onChange={(e) => setProdPrice(e.target.value)} placeholder="Price (ETB)" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
              <input type="number" min={0} required value={prodStock} onChange={(e) => setProdStock(e.target.value)} placeholder="Stock" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
            </div>
            <textarea rows={3} value={prodDesc} onChange={(e) => setProdDesc(e.target.value)} placeholder="Product description..." className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
            <button type="submit" className="w-full min-h-[40px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white py-2 text-xs font-medium">Publish Product</button>
          </form>

          <div className="lg:col-span-8 space-y-4">
            <SearchFilterSortBar
              search={prodSearch}
              onSearchChange={setProdSearch}
              searchPlaceholder="Search products by name, SKU, category..."
              filters={[
                {
                  label: 'Catalog status filter',
                  value: prodActiveFilter,
                  onChange: setProdActiveFilter,
                  options: [
                    { label: 'All Items', value: 'all' },
                    { label: 'Active Only', value: 'active' },
                    { label: 'Hidden Only', value: 'hidden' },
                    { label: 'Demo Items', value: 'demo' },
                  ],
                },
              ]}
              sortOptions={[
                { label: 'Name', value: 'name' },
                { label: 'Price', value: 'price' },
                { label: 'Stock', value: 'stock' },
              ]}
              sortBy={prodSortBy}
              onSortByChange={(v) => setProdSortBy(v as typeof prodSortBy)}
              sortDir={prodSortDir}
              onToggleSortDir={() => setProdSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              resultCount={filteredProducts.length}
            />

            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
              {filteredProducts.length === 0 ? (
                <p className="p-8 text-center text-xs text-slate-500">No products match your filter criteria.</p>
              ) : (
                filteredProducts.map((p) => (
                  <div key={p.id} className="p-4 flex items-center justify-between gap-4 text-xs">
                    <div>
                      <p className="text-sm font-semibold flex items-center gap-2">
                        <span>{p.name}</span>
                        <span className="font-mono text-slate-400">({p.sku})</span>
                        {p.isDemo && (
                          <span className="px-1.5 py-0.5 rounded bg-[#EAF4FF] text-[#082B59] text-[10px] font-semibold">DEMO</span>
                        )}
                      </p>
                      <p className="text-slate-500 tabular-nums">{p.category} · {p.currency} {p.price.toFixed(2)} · Stock: {p.stock}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!profile || (!hasPermission(profile, 'products', 'edit') && !hasPermission(profile, 'admin', 'manage'))) {
                            setErrorMsg('Permission denied: cannot modify catalog status.');
                            return;
                          }
                          await updateDoc(doc(db, 'products', p.id), { active: !p.active, updatedAt: new Date().toISOString() });
                          await logAuditEvent(profile, 'PRODUCT_VISIBILITY_TOGGLED', 'product', p.id, `${p.sku} active=${!p.active}`);
                        }}
                        className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF]"
                      >
                        {p.active ? 'Hide' : 'Activate'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!profile || (!hasPermission(profile, 'products', 'delete') && !hasPermission(profile, 'admin', 'manage'))) {
                            setErrorMsg('Permission denied: cannot delete catalog items.');
                            return;
                          }
                          await deleteDoc(doc(db, 'products', p.id));
                          await logAuditEvent(profile, 'PRODUCT_DELETED', 'product', p.id, `Deleted ${p.name} (${p.sku})`, 'warning');
                        }}
                        className="text-red-600 p-1"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. ORDERS & FEEDBACK */}
      {tab === 'orders' && (
        <div className="space-y-6">
          <SearchFilterSortBar
            search={orderSearch}
            onSearchChange={setOrderSearch}
            searchPlaceholder="Search orders by Order #, Invoice #, or customer..."
            filters={[
              {
                label: 'Order status filter',
                value: orderStatusFilter,
                onChange: setOrderStatusFilter,
                options: [
                  { label: 'All Order Statuses', value: 'all' },
                  { label: 'Pending', value: 'pending' },
                  { label: 'Confirmed', value: 'confirmed' },
                  { label: 'Processing', value: 'processing' },
                  { label: 'Shipped', value: 'shipped' },
                  { label: 'Delivered', value: 'delivered' },
                  { label: 'Cancelled', value: 'cancelled' },
                ],
              },
            ]}
            sortOptions={[
              { label: 'Order Date', value: 'createdAt' },
              { label: 'Total Amount', value: 'total' },
            ]}
            sortBy={orderSortBy}
            onSortByChange={(v) => setOrderSortBy(v as typeof orderSortBy)}
            sortDir={orderSortDir}
            onToggleSortDir={() => setOrderSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            resultCount={filteredOrders.length}
          />

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold text-[#15243A] dark:text-slate-100">
              Customer Orders (Permission & Audit Enforced)
            </div>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-[#EAF4FF] dark:bg-slate-950 text-[#082B59] dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Order / Invoice</th>
                  <th className="px-4 py-2.5 font-semibold">Customer</th>
                  <th className="px-4 py-2.5 font-semibold">Total</th>
                  <th className="px-4 py-2.5 font-semibold">Status Approval</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Document</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredOrders.map((o) => (
                  <tr key={o.id} className="hover:bg-[#F5F8FC] dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3">
                      <span className="font-mono font-semibold">{o.orderNumber}</span>
                      <div className="text-[11px] text-slate-400 font-mono">{o.invoiceNumber}</div>
                      {o.isDemo && (
                        <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-[#EAF4FF] text-[#082B59] text-[10px] font-semibold">DEMO</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{o.customerName}</td>
                    <td className="px-4 py-3 tabular-nums font-medium">{o.currency} {o.total.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={o.status}
                        onChange={async (e) => {
                          if (!profile) return;
                          try {
                            await processOrderStatusWithAudit(profile, o, e.target.value as CustomerOrder['status']);
                            setNotice(`Order ${o.orderNumber} updated and recorded in audit trail.`);
                          } catch (err) {
                            showError(err);
                          }
                        }}
                        className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                      >
                        <option value="pending">Pending</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="processing">Processing</option>
                        <option value="shipped">Shipped</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled (Auto Refund Ledger)</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setPreviewOrder(o)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF]"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#1178B9]" /> Invoice
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
            <div className="px-5 py-3 text-sm font-semibold">Customer Inquiries, Complaints & Feedback</div>
            {feedback.map((f) => (
              <div key={f.id} className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                <div>
                  <p className="font-semibold flex items-center gap-2">
                    <span>{f.subject}</span>
                    <span className="text-slate-400">({f.type})</span>
                    {f.isDemo && (
                      <span className="px-1.5 py-0.5 rounded bg-[#EAF4FF] text-[#082B59] text-[10px] font-semibold">DEMO</span>
                    )}
                  </p>
                  <p className="text-[#293858] dark:text-slate-300">{f.message}</p>
                  <p className="text-slate-400 mt-1">From {f.customerName} · Status: {f.status}</p>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (!profile || (!hasPermission(profile, 'orders', 'edit') && !hasPermission(profile, 'admin', 'manage'))) {
                      setErrorMsg('Permission denied: cannot resolve support feedback.');
                      return;
                    }
                    await updateDoc(doc(db, 'customerFeedback', f.id), {
                      status: 'resolved',
                      respondedBy: profile.uid,
                      updatedAt: new Date().toISOString(),
                    });
                    await logAuditEvent(profile, 'FEEDBACK_RESOLVED', 'customerFeedback', f.id, `Resolved "${f.subject}"`);
                  }}
                  className="min-h-[36px] px-3 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white font-medium"
                >
                  Mark Resolved
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. FINANCIAL TRANSACTION LEDGER */}
      {tab === 'finance' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1">
              <p className="text-xs text-slate-500">Completed Ledger Volume</p>
              <p className="text-xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">ETB {financeSummary.completed.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1">
              <p className="text-xs text-slate-500">Pending Verification</p>
              <p className="text-xl font-bold text-amber-600 tabular-nums">ETB {financeSummary.pending.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-1">
              <p className="text-xs text-slate-500">Refunds Recorded</p>
              <p className="text-xl font-bold text-red-600 tabular-nums">ETB {financeSummary.refunds.toFixed(2)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-col justify-between gap-2">
              <p className="text-xs text-slate-500">Ledger Exports ({filteredTransactions.length})</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => downloadFinancialLedgerPDF(filteredTransactions)}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
                >
                  <Download className="w-3.5 h-3.5" /> PDF
                </button>
                <button
                  type="button"
                  onClick={() =>
                    exportDataToExcel(
                      'Financial Ledger',
                      filteredTransactions.map((t) => ({
                        TransactionNumber: t.txNumber,
                        Customer: t.customerName,
                        Type: t.type,
                        Method: t.method,
                        Amount: t.amount,
                        Currency: t.currency,
                        Status: t.status,
                        OrderNumber: t.orderNumber || '',
                        IsDemo: Boolean(t.isDemo),
                        CreatedAt: t.createdAt,
                      })),
                      '7sunday-financial-ledger.xlsx'
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 text-xs font-medium"
                >
                  <Download className="w-3.5 h-3.5" /> Excel
                </button>
              </div>
            </div>
          </div>

          <form onSubmit={handleRecordManualTransaction} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Record Financial Ledger Entry</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
              <select
                value={txCustomerUid}
                onChange={(e) => setTxCustomerUid(e.target.value)}
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              >
                <option value="">Select Account (or Enter Name)</option>
                {users.map((u) => (
                  <option key={u.uid} value={u.uid}>{u.fullName} ({u.role})</option>
                ))}
              </select>
              {!txCustomerUid && (
                <input
                  type="text"
                  value={txCustomerName}
                  onChange={(e) => setTxCustomerName(e.target.value)}
                  placeholder="Account / Customer Name"
                  className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                />
              )}
              <select
                value={txType}
                onChange={(e) => setTxType(e.target.value as FinancialTransaction['type'])}
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              >
                <option value="order_payment">Order Payment</option>
                <option value="refund">Refund</option>
                <option value="adjustment">Adjustment</option>
                <option value="payout">Payout</option>
              </select>
              <select
                value={txMethod}
                onChange={(e) => setTxMethod(e.target.value as FinancialTransaction['method'])}
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              >
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
                <option value="mobile_money">Mobile Money</option>
                <option value="cash_on_delivery">Cash on Delivery</option>
                <option value="credit_adjustment">Credit Adjustment</option>
              </select>
              <input
                type="number"
                min={0.01}
                step="0.01"
                required
                value={txAmount}
                onChange={(e) => setTxAmount(e.target.value)}
                placeholder="Amount (ETB)"
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              />
              <input
                type="text"
                value={txOrderNumber}
                onChange={(e) => setTxOrderNumber(e.target.value)}
                placeholder="Order # (Optional)"
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="text"
                value={txNotes}
                onChange={(e) => setTxNotes(e.target.value)}
                placeholder="Audit memo / reference number..."
                className="flex-1 min-w-[220px] min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              />
              <button type="submit" className="min-h-[40px] px-5 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium">
                Post to Ledger
              </button>
            </div>
          </form>

          <SearchFilterSortBar
            search={txSearch}
            onSearchChange={setTxSearch}
            searchPlaceholder="Search transactions by TX #, customer, order #, notes..."
            filters={[
              {
                label: 'Transaction type filter',
                value: txTypeFilter,
                onChange: setTxTypeFilter,
                options: [
                  { label: 'All Types', value: 'all' },
                  { label: 'Order Payment', value: 'order_payment' },
                  { label: 'Refund', value: 'refund' },
                  { label: 'Adjustment', value: 'adjustment' },
                  { label: 'Payout', value: 'payout' },
                ],
              },
              {
                label: 'Transaction status filter',
                value: txStatusFilter,
                onChange: setTxStatusFilter,
                options: [
                  { label: 'All Statuses', value: 'all' },
                  { label: 'Pending', value: 'pending' },
                  { label: 'Completed', value: 'completed' },
                  { label: 'Refunded', value: 'refunded' },
                  { label: 'Failed', value: 'failed' },
                  { label: 'Cancelled', value: 'cancelled' },
                ],
              },
            ]}
            sortOptions={[
              { label: 'Transaction Date', value: 'createdAt' },
              { label: 'Amount', value: 'amount' },
            ]}
            sortBy={txSortBy}
            onSortByChange={(v) => setTxSortBy(v as typeof txSortBy)}
            sortDir={txSortDir}
            onToggleSortDir={() => setTxSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            resultCount={filteredTransactions.length}
          />

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-[#EAF4FF] dark:bg-slate-950 text-[#082B59] dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-semibold">Transaction #</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Type & Method</th>
                  <th className="px-4 py-3 font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions & Receipt</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredTransactions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500">No financial ledger transactions found.</td>
                  </tr>
                ) : (
                  filteredTransactions.map((tx) => (
                    <tr key={tx.id} className="hover:bg-[#F5F8FC] dark:hover:bg-slate-800/40">
                      <td className="px-4 py-3">
                        <span className="font-mono font-semibold">{tx.txNumber}</span>
                        {tx.orderNumber && <div className="text-[11px] text-slate-400 font-mono">{tx.orderNumber}</div>}
                        {tx.isDemo && (
                          <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded bg-[#EAF4FF] text-[#082B59] text-[10px] font-semibold">DEMO</span>
                        )}
                      </td>
                      <td className="px-4 py-3">{tx.customerName}</td>
                      <td className="px-4 py-3 capitalize">
                        <div>{tx.type.replace('_', ' ')}</div>
                        <div className="text-[11px] text-slate-400">{tx.method.replace('_', ' ')}</div>
                      </td>
                      <td className="px-4 py-3 tabular-nums font-semibold">{tx.currency} {tx.amount.toFixed(2)}</td>
                      <td className="px-4 py-3 capitalize">{tx.status}</td>
                      <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                        {tx.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => profile && approveOrUpdateTransaction(profile, tx, 'completed').catch(showError)}
                            className="px-2 py-1 rounded bg-[#1178B9] hover:bg-[#0D6096] text-white"
                          >
                            Approve
                          </button>
                        )}
                        {tx.status === 'completed' && tx.type === 'order_payment' && (
                          <button
                            type="button"
                            onClick={() => profile && approveOrUpdateTransaction(profile, tx, 'refunded').catch(showError)}
                            className="px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50"
                          >
                            Mark Refunded
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setPreviewReceipt(tx)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF]"
                        >
                          <Eye className="w-3.5 h-3.5 text-[#1178B9]" /> Receipt
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 7. SECURITY AUDIT, MODERATION, INTEGRATIONS & OPTIONAL DEMO DATA */}
      {tab === 'security' && (
        <div className="space-y-6">
          {/* Optional Demonstration Data Management */}
          <div className="rounded-xl border border-[#1178B9]/30 bg-[#EAF4FF]/60 dark:bg-[#082B59]/30 p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#082B59] dark:text-[#EAF4FF]">
                  Optional Demonstration Data Isolation ({demoRecordCount} tagged demo records)
                </h3>
                <p className="text-xs text-[#293858] dark:text-slate-300">
                  Real company data is stored cleanly without demo records. You can optionally load, toggle visibility, or permanently remove tagged [DEMO] records at any time.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={demoBusy}
                  onClick={handleLoadDemo}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white text-xs font-medium"
                >
                  Load Optional Demo Data
                </button>
                <button
                  type="button"
                  disabled={demoBusy}
                  onClick={handleToggleDemoVisibility}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-lg border border-[#082B59]/30 bg-white dark:bg-slate-900 text-[#082B59] dark:text-[#EAF4FF] text-xs font-medium"
                >
                  Demo Visibility: {showDemoData ? 'Enabled' : 'Disabled'}
                </button>
                <button
                  type="button"
                  disabled={demoBusy || demoRecordCount === 0}
                  onClick={handleRemoveDemo}
                  className="min-h-[40px] px-3.5 py-1.5 rounded-lg border border-red-300 bg-white dark:bg-slate-900 text-red-600 hover:bg-red-50 disabled:opacity-50 text-xs font-medium"
                >
                  Safely Remove All Demo Data
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h3 className="text-sm font-semibold">External Messaging Gateway Configuration</h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              {[
                { label: 'Telegram Bot API', ok: Boolean(integrationStatus.telegramBot) },
                { label: 'WhatsApp Cloud API', ok: Boolean(integrationStatus.whatsappCloud) },
                { label: 'Twilio SMS Gateway', ok: Boolean(integrationStatus.twilioSms) },
                { label: 'Email SMTP Webhook', ok: Boolean(integrationStatus.emailWebhook) },
              ].map((g) => (
                <div key={g.label} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <p className="font-medium">{g.label}</p>
                  <p className={g.ok ? 'text-[#1178B9] font-medium' : 'text-slate-400'}>
                    {g.ok ? 'Server Configured' : 'Direct Client Share Fallback'}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {modReports.length > 0 && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
              <div className="px-5 py-3 text-sm font-semibold">Moderation Queue ({modReports.length})</div>
              {modReports.map((mr) => (
                <div key={mr.id} className="p-4 flex items-center justify-between text-xs">
                  <div>
                    <p className="font-medium">{mr.reason}</p>
                    <p className="text-slate-400">Status: {mr.status}</p>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!profile || !hasPermission(profile, 'admin', 'manage')) {
                        setErrorMsg('Permission denied: administrator privileges required.');
                        return;
                      }
                      await updateDoc(doc(db, 'moderationReports', mr.id), { status: 'resolved', updatedAt: new Date().toISOString() });
                      await logAuditEvent(profile, 'MODERATION_REPORT_RESOLVED', 'moderationReport', mr.id, mr.reason);
                    }}
                    className="px-3 py-1.5 rounded bg-[#082B59] text-white"
                  >
                    Resolve
                  </button>
                </div>
              ))}
            </div>
          )}

          <SearchFilterSortBar
            search={auditSearch}
            onSearchChange={setAuditSearch}
            searchPlaceholder="Search audit log by actor, action, or details..."
            filters={[
              {
                label: 'Severity filter',
                value: auditSeverityFilter,
                onChange: setAuditSeverityFilter,
                options: [
                  { label: 'All Severities', value: 'all' },
                  { label: 'Info', value: 'info' },
                  { label: 'Warning', value: 'warning' },
                  { label: 'Critical', value: 'critical' },
                ],
              },
            ]}
            sortDir={auditSortDir}
            onToggleSortDir={() => setAuditSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            resultCount={filteredAuditLogs.length}
          />

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold">Security Audit Log</div>
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-[#EAF4FF] dark:bg-slate-950 text-[#082B59] dark:text-slate-300">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Timestamp</th>
                  <th className="px-4 py-2.5 font-semibold">Actor</th>
                  <th className="px-4 py-2.5 font-semibold">Action</th>
                  <th className="px-4 py-2.5 font-semibold">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredAuditLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-[#F5F8FC] dark:hover:bg-slate-800/40">
                    <td className="px-4 py-2.5 tabular-nums text-slate-500">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2.5">{log.actorEmail || log.actorUid}</td>
                    <td className="px-4 py-2.5 font-mono">{log.action}</td>
                    <td className="px-4 py-2.5 text-[#293858] dark:text-slate-300">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Printable Financial Receipt Modal */}
      <DocumentPreviewModal
        open={Boolean(previewReceipt)}
        title={`Official Receipt ${previewReceipt?.txNumber || ''}`}
        subtitle={previewReceipt ? `Recorded ${new Date(previewReceipt.createdAt).toLocaleString()}` : ''}
        badge={previewReceipt?.status.toUpperCase()}
        onClose={() => setPreviewReceipt(null)}
        onDownload={() => previewReceipt && downloadFinancialReceiptPDF(previewReceipt)}
        downloadLabel="Download Receipt PDF"
      >
        {previewReceipt && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-[#F5F8FC] dark:bg-slate-800 p-4 border border-slate-200 dark:border-slate-700 text-xs">
              <div><strong>Transaction #:</strong> {previewReceipt.txNumber}</div>
              <div><strong>Customer:</strong> {previewReceipt.customerName}</div>
              <div><strong>Type:</strong> {previewReceipt.type.replace('_', ' ')}</div>
              <div><strong>Method:</strong> {previewReceipt.method.replace('_', ' ')}</div>
              <div><strong>Amount:</strong> {previewReceipt.currency} {previewReceipt.amount.toFixed(2)}</div>
              <div><strong>Status:</strong> {previewReceipt.status}</div>
              {previewReceipt.orderNumber && <div><strong>Order #:</strong> {previewReceipt.orderNumber}</div>}
              {previewReceipt.invoiceNumber && <div><strong>Invoice #:</strong> {previewReceipt.invoiceNumber}</div>}
            </div>
            {previewReceipt.notes && (
              <p className="text-xs text-[#293858] dark:text-slate-300">
                <strong>Ledger Notes:</strong> {previewReceipt.notes}
              </p>
            )}
          </div>
        )}
      </DocumentPreviewModal>

      {/* Printable Order Invoice Modal */}
      <DocumentPreviewModal
        open={Boolean(previewOrder)}
        title={`Invoice ${previewOrder?.invoiceNumber || ''}`}
        subtitle={previewOrder ? `Order ${previewOrder.orderNumber} · ${previewOrder.customerName}` : ''}
        badge={previewOrder?.status.toUpperCase()}
        onClose={() => setPreviewOrder(null)}
        onDownload={() => previewOrder && downloadOrderInvoicePDF(previewOrder)}
        downloadLabel="Download Invoice PDF"
      >
        {previewOrder && (
          <div className="space-y-4">
            <div className="text-xs space-y-1">
              <p><strong>Customer:</strong> {previewOrder.customerName} ({previewOrder.customerEmail})</p>
              {previewOrder.shippingAddress && <p><strong>Shipping Address:</strong> {previewOrder.shippingAddress}</p>}
            </div>
            <table className="w-full text-left text-xs border border-slate-200 dark:border-slate-700">
              <thead className="bg-[#EAF4FF] dark:bg-slate-800 text-[#082B59] dark:text-slate-200">
                <tr>
                  <th className="p-2">Item</th>
                  <th className="p-2">SKU</th>
                  <th className="p-2">Qty</th>
                  <th className="p-2 text-right">Line Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                {previewOrder.items.map((item) => (
                  <tr key={item.productId}>
                    <td className="p-2">{item.name}</td>
                    <td className="p-2 font-mono">{item.sku}</td>
                    <td className="p-2 tabular-nums">{item.quantity}</td>
                    <td className="p-2 text-right tabular-nums">{previewOrder.currency} {(item.quantity * item.unitPrice).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-right font-bold text-sm text-[#082B59] dark:text-[#EAF4FF] tabular-nums">
              Total: {previewOrder.currency} {previewOrder.total.toFixed(2)}
            </div>
          </div>
        )}
      </DocumentPreviewModal>
    </div>
  );
};
