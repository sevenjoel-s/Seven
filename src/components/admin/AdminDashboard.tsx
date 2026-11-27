import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, setDoc, updateDoc } from 'firebase/firestore';
import {
  Banknote,
  Bell,
  Building2,
  Check,
  Database,
  Download,
  Edit3,
  Eye,
  FolderPlus,
  ImagePlus,
  Mail,
  MessageSquare,
  Package,
  Phone,
  PhoneCall,
  Plus,
  Send,
  Shield,
  ShoppingCart,
  Trash2,
  UserCheck,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDirectCall } from '../../context/DirectCallContext';
import {
  downloadFinancialLedgerPDF,
  downloadFinancialReceiptPDF,
  downloadOrderInvoicePDF,
  exportDatabaseBackupJSON,
  exportDataToExcel,
  ORDER_STATUS_LABELS,
} from '../../lib/exportUtils';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  approveOrUpdateTransaction,
  createNotification,
  loadOptionalDemoData,
  logAuditEvent,
  notifyAllUsersOfNewProduct,
  processOrderStatusWithAudit,
  purgeAllRegisteredUsers,
  recordManualTransaction,
  removeOptionalDemoData,
  syncSupportRoutingDirectory,
  uploadFileToServer,
} from '../../lib/firestoreActions';
import { hasPermission, ROLE_LABELS, ROLE_MATRIX } from '../../lib/rbac';
import {
  AccountStatus,
  AuditLog,
  BroadcastChannel,
  CustomerFeedback,
  CustomerOrder,
  Department,
  EmployeeInvite,
  FinancialTransaction,
  ModerationReport,
  Product,
  ProductAvailabilityStatus,
  ProductBroadcastReport,
  ProductCategory,
  ProductSpecification,
  RoleDefinition,
  RoleKey,
  UserAccount,
} from '../../types/domain';
import { DirectCallPanel } from '../calls/DirectCallPanel';
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
  onOpenCustomerChat?: (customer: UserAccount) => void;
  onOpenDirectChat?: (user: UserAccount, opts?: { order?: CustomerOrder; subject?: string }) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  users,
  departments,
  products,
  orders,
  feedback,
  transactions = [],
  showDemoData = false,
  onOpenCustomerChat,
  onOpenDirectChat,
}) => {
  const { profile, getToken, updateAvailability } = useAuth();
  const { phase: callPhase, startCall } = useDirectCall();
  const [tab, setTab] = useState<
    'users' | 'customers' | 'departments' | 'roles' | 'catalog' | 'orders' | 'calls' | 'finance' | 'security'
  >('users');
  const [confirmPurgeUsers, setConfirmPurgeUsers] = useState(false);
  const [purgingUsers, setPurgingUsers] = useState(false);

  const [invites, setInvites] = useState<EmployeeInvite[]>([]);
  const [customRoles, setCustomRoles] = useState<RoleDefinition[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [modReports, setModReports] = useState<ModerationReport[]>([]);
  const [productCategories, setProductCategories] = useState<ProductCategory[]>([]);
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

  // Category form
  const [catName, setCatName] = useState('');
  const [catDesc, setCatDesc] = useState('');
  const [catImageUrl, setCatImageUrl] = useState('');
  const [catUploading, setCatUploading] = useState(false);

  // Product form (shared create + edit modal)
  const [prodName, setProdName] = useState('');
  const [prodSku, setProdSku] = useState('');
  const [prodCategory, setProdCategory] = useState('Hardware');
  const [prodUnit, setProdUnit] = useState('Piece');
  const [prodPrice, setProdPrice] = useState('4500');
  const [prodContactForPrice, setProdContactForPrice] = useState(false);
  const [prodStock, setProdStock] = useState('25');
  const [prodAvail, setProdAvail] = useState<ProductAvailabilityStatus>('in_stock');
  const [prodImageUrl, setProdImageUrl] = useState('');
  const [prodGallery, setProdGallery] = useState<string[]>([]);
  const [prodSpecs, setProdSpecs] = useState<ProductSpecification[]>([]);
  const [specKey, setSpecKey] = useState('');
  const [specVal, setSpecVal] = useState('');
  const [prodDesc, setProdDesc] = useState('');
  const [prodUploading, setProdUploading] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [notifyUsersOnSave, setNotifyUsersOnSave] = useState(true);
  const [notifyChannels, setNotifyChannels] = useState<BroadcastChannel[]>([
    'in_app',
    'push',
    'email',
    'sms',
    'whatsapp',
    'telegram',
  ]);
  const [notifyCustomMsg, setNotifyCustomMsg] = useState('');
  const [notifyTelegramTarget, setNotifyTelegramTarget] = useState('');
  const [broadcastingProductId, setBroadcastingProductId] = useState<string | null>(null);
  const [broadcastReport, setBroadcastReport] = useState<{
    productName: string;
    sku: string;
    report: ProductBroadcastReport;
  } | null>(null);

  // Customer management search & drilldown
  const [custSearch, setCustSearch] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState<UserAccount | null>(null);

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
    const unsubCats = onSnapshot(collection(db, 'productCategories'), (snap) =>
      setProductCategories(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ProductCategory, 'id'>) }))
          .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.name.localeCompare(b.name))
      )
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
      unsubCats();
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

    if (nextStatus === 'active' && ['support_agent', 'company_admin', 'super_admin', 'department_manager'].includes(nextRole)) {
      const updatedList = users.map((u) => (u.uid === target.uid ? { ...u, role: nextRole, status: nextStatus } : u));
      await syncSupportRoutingDirectory(updatedList).catch(() => {});
    }

    await logAuditEvent(profile, auditAction, 'user', target.uid, `Updated ${target.email}: ${JSON.stringify(patch)}`, 'warning');
    await createNotification(target.uid, 'security', 'Account Updated', `An administrator updated your account (${auditAction}).`);
    setNotice(`Updated ${target.fullName}.`);
  };

  const customerAccounts = useMemo(() => {
    const term = custSearch.trim().toLowerCase();
    return users
      .filter((u) => u.accountType === 'customer')
      .filter((u) => {
        if (!term) return true;
        return (
          u.fullName.toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term) ||
          (u.phone || '').toLowerCase().includes(term)
        );
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [users, custSearch]);

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

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !catName.trim()) return;
    setErrorMsg(null);
    if (!hasPermission(profile, 'products', 'create') && !hasPermission(profile, 'admin', 'manage')) {
      setErrorMsg('Permission denied: cannot manage product categories.');
      return;
    }
    const now = new Date().toISOString();
    const slug = catName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || `cat-${Date.now()}`;
    await addDoc(collection(db, 'productCategories'), {
      name: catName.trim().slice(0, 100),
      slug: slug.slice(0, 100),
      ...(catDesc.trim() ? { description: catDesc.trim().slice(0, 600) } : {}),
      ...(catImageUrl.trim() ? { imageUrl: catImageUrl.trim().slice(0, 500) } : {}),
      sortOrder: productCategories.length + 1,
      active: true,
      createdBy: profile.uid,
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    await logAuditEvent(profile, 'PRODUCT_CATEGORY_CREATED', 'productCategory', slug, catName.trim());
    setCatName('');
    setCatDesc('');
    setCatImageUrl('');
    setNotice('Product category created.');
  };

  const handleUploadCategoryImage = async (file: File) => {
    setCatUploading(true);
    setErrorMsg(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication token unavailable.');
      const res = await uploadFileToServer(file, token);
      setCatImageUrl(res.url);
    } catch (err) {
      showError(err);
    } finally {
      setCatUploading(false);
    }
  };

  const handleUploadProductImages = async (files: FileList | null, target: 'main' | 'gallery') => {
    if (!files || files.length === 0) return;
    setProdUploading(true);
    setErrorMsg(null);
    try {
      const token = await getToken();
      if (!token) throw new Error('Authentication token unavailable.');
      for (const file of Array.from(files).slice(0, 8)) {
        const res = await uploadFileToServer(file, token);
        if (target === 'main') {
          setProdImageUrl(res.url);
          break;
        } else {
          setProdGallery((prev) => Array.from(new Set([...prev, res.url])).slice(0, 12));
        }
      }
    } catch (err) {
      showError(err);
    } finally {
      setProdUploading(false);
    }
  };

  const toggleNotifyChannel = (ch: BroadcastChannel) => {
    setNotifyChannels((prev) => (prev.includes(ch) ? prev.filter((item) => item !== ch) : [...prev, ch]));
  };

  const resetProductForm = () => {
    setEditingProduct(null);
    setProdName('');
    setProdSku('');
    setProdCategory(productCategories[0]?.name || 'Hardware');
    setProdUnit('Piece');
    setProdPrice('4500');
    setProdContactForPrice(false);
    setProdStock('25');
    setProdAvail('in_stock');
    setProdImageUrl('');
    setProdGallery([]);
    setProdSpecs([]);
    setSpecKey('');
    setSpecVal('');
    setProdDesc('');
    setNotifyUsersOnSave(true);
    setNotifyCustomMsg('');
  };

  const startEditProduct = (p: Product) => {
    setEditingProduct(p);
    setProdName(p.name);
    setProdSku(p.sku);
    setProdCategory(p.category);
    setProdUnit(p.unit || 'Piece');
    setProdContactForPrice(Boolean(p.contactForPrice));
    setProdPrice(p.contactForPrice ? '' : String(p.price ?? 0));
    setProdStock(String(p.stock));
    setProdAvail(
      p.availabilityStatus || (p.stock <= 0 ? 'out_of_stock' : p.stock <= 5 ? 'low_stock' : 'in_stock')
    );
    setProdImageUrl(p.imageUrl || '');
    setProdGallery(p.galleryImages || []);
    setProdSpecs(p.specifications || []);
    setProdDesc(p.description || '');
    setNotifyUsersOnSave(false);
  };

  const broadcastProductAlert = async (prod: {
    id: string;
    name: string;
    sku: string;
    category: string;
    price: number;
    contactForPrice?: boolean;
    currency: string;
    unit?: string;
    description?: string;
    imageUrl?: string;
  }) => {
    if (!profile) return null;
    setBroadcastingProductId(prod.id);
    try {
      const token = await getToken();
      const report = await notifyAllUsersOfNewProduct({
        actor: profile,
        token,
        product: prod,
        users,
        channels: notifyChannels.length > 0 ? notifyChannels : ['in_app', 'push', 'email', 'sms'],
        extraTelegramChatId: notifyTelegramTarget,
        customMessage: notifyCustomMsg,
      });
      setBroadcastReport({ productName: prod.name, sku: prod.sku, report });
      return report;
    } finally {
      setBroadcastingProductId(null);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setErrorMsg(null);
    const permAction = editingProduct ? 'edit' : 'create';
    if (!hasPermission(profile, 'products', permAction) && !hasPermission(profile, 'admin', 'manage')) {
      setErrorMsg(`Permission denied: cannot ${permAction} catalog products.`);
      return;
    }
    if (!prodName.trim() || !prodSku.trim()) return;
    const isContactPrice = prodContactForPrice || prodPrice.trim() === '';
    const parsedPrice = isContactPrice ? 0 : Number(prodPrice);
    const parsedStock = Number(prodStock);
    if ((!isContactPrice && (Number.isNaN(parsedPrice) || parsedPrice < 0)) || Number.isNaN(parsedStock) || parsedStock < 0) {
      setErrorMsg('Product price and stock must be valid non-negative numbers.');
      return;
    }
    const matchedCat = productCategories.find((c) => c.name.toLowerCase() === prodCategory.trim().toLowerCase());
    const now = new Date().toISOString();
    const payload = {
      name: prodName.trim().slice(0, 160),
      sku: prodSku.trim().toUpperCase().slice(0, 64),
      category: prodCategory.trim().slice(0, 80) || 'General',
      ...(matchedCat ? { categoryId: matchedCat.id } : {}),
      description: prodDesc.trim().slice(0, 2000),
      unit: prodUnit.trim().slice(0, 40) || 'Piece',
      specifications: prodSpecs.slice(0, 40),
      price: parsedPrice,
      contactForPrice: isContactPrice,
      currency: 'ETB',
      stock: parsedStock,
      availabilityStatus: prodAvail,
      imageUrl: (prodImageUrl.trim() || '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png').slice(0, 500),
      galleryImages: prodGallery.slice(0, 12),
      active: editingProduct ? editingProduct.active : true,
      createdBy: editingProduct ? editingProduct.createdBy : profile.uid,
      isDemo: editingProduct ? Boolean(editingProduct.isDemo) : false,
      createdAt: editingProduct ? editingProduct.createdAt : now,
      updatedAt: now,
    };

    if (editingProduct) {
      await setDoc(doc(db, 'products', editingProduct.id), payload, { merge: true });
      await logAuditEvent(profile, 'PRODUCT_UPDATED', 'product', editingProduct.id, `Updated ${payload.name} (${payload.sku})`);
      if (notifyUsersOnSave && notifyChannels.length > 0) {
        const rep = await broadcastProductAlert({ id: editingProduct.id, ...payload });
        setNotice(
          `Updated ${payload.name} and notified ${rep?.inAppSaved ?? 0} user(s) across selected channels.`
        );
      } else {
        setNotice(`Updated ${payload.name}.`);
      }
    } else {
      const docRef = await addDoc(collection(db, 'products'), payload);
      await logAuditEvent(profile, 'PRODUCT_CREATED', 'product', docRef.id || payload.sku, payload.name);
      if (notifyUsersOnSave && notifyChannels.length > 0) {
        const rep = await broadcastProductAlert({ id: docRef.id, ...payload });
        setNotice(
          `Product published and notifications dispatched (${rep?.inAppSaved ?? 0} in-app alerts saved across ${rep?.totalRecipients ?? 0} active user(s)).`
        );
      } else {
        setNotice('Product published to 7Sunday Ethiopia catalog.');
      }
    }
    resetProductForm();
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
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl bg-[#F3F5F8] dark:bg-slate-800 w-full">
        {(
          [
            { id: 'users', label: 'Users & Invites', Icon: Users },
            { id: 'customers', label: 'Customers', Icon: UserCheck },
            { id: 'catalog', label: 'Catalog & Categories', Icon: Package },
            { id: 'orders', label: 'Orders & Support', Icon: ShoppingCart },
            { id: 'calls', label: 'Call Desk', Icon: PhoneCall },
            { id: 'finance', label: 'Financial Ledger', Icon: Banknote },
            { id: 'departments', label: 'Departments', Icon: Building2 },
            { id: 'roles', label: 'RBAC Roles', Icon: Shield },
            { id: 'security', label: 'Audit, Backup & Demo', Icon: Database },
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

          {profile?.role === 'super_admin' && (
            <div className="rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/20 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div>
                <p className="font-bold text-red-700 dark:text-red-300">
                  Registered Users Management ({users.filter((u) => u.uid !== profile.uid).length} non-admin accounts)
                </p>
                <p className="text-red-700/80 dark:text-red-300/80">
                  Remove all registered user profiles, directory records, carts, delivery addresses, and invites from Firestore while keeping your Super Admin session.
                </p>
              </div>
              {!confirmPurgeUsers ? (
                <button
                  type="button"
                  onClick={() => setConfirmPurgeUsers(true)}
                  className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Remove All Registered Users
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={purgingUsers}
                    onClick={async () => {
                      if (!profile) return;
                      setPurgingUsers(true);
                      try {
                        const res = await purgeAllRegisteredUsers(profile);
                        setConfirmPurgeUsers(false);
                        setNotice(
                          `Removed ${res.deletedUsers} user accounts, ${res.deletedDirectories} directory entries, ${res.deletedInvites} invites, and ${res.deletedCustomerArtifacts} customer carts/addresses.`
                        );
                      } catch (err) {
                        showError(err);
                      } finally {
                        setPurgingUsers(false);
                      }
                    }}
                    className="min-h-[40px] px-3.5 py-2 rounded-lg bg-red-700 hover:bg-red-800 disabled:opacity-50 text-white font-semibold"
                  >
                    {purgingUsers ? 'Removing Users...' : 'Confirm Remove All'}
                  </button>
                  <button
                    type="button"
                    disabled={purgingUsers}
                    onClick={() => setConfirmPurgeUsers(false)}
                    className="min-h-[40px] px-3 py-2 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-slate-900 font-medium"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

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
                    <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                      {u.status === 'pending_approval' && (
                        <button
                          type="button"
                          onClick={() => updateUserAccount(u, { status: 'active' }, 'EMPLOYEE_APPROVED')}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-[#1178B9] hover:bg-[#0D6096] text-white"
                        >
                          <Check className="w-3 h-3" /> Approve
                        </button>
                      )}
                      {u.uid !== profile?.uid && (
                        <>
                          {(onOpenDirectChat || (u.accountType === 'customer' && onOpenCustomerChat)) && (
                            <button
                              type="button"
                              onClick={() => (onOpenDirectChat ? onOpenDirectChat(u) : onOpenCustomerChat?.(u))}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF]"
                              title={`Message ${u.fullName}`}
                            >
                              <MessageSquare className="w-3 h-3 text-[#1178B9]" /> Chat
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={callPhase !== 'idle'}
                            onClick={() => {
                              setTab('calls');
                              startCall({ targetUid: u.uid, targetName: u.fullName, callType: 'audio' });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] disabled:opacity-40"
                            title={`Voice call ${u.fullName}`}
                          >
                            <Phone className="w-3 h-3 text-[#1178B9]" /> Audio
                          </button>
                          <button
                            type="button"
                            disabled={callPhase !== 'idle'}
                            onClick={() => {
                              setTab('calls');
                              startCall({ targetUid: u.uid, targetName: u.fullName, callType: 'video' });
                            }}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-40 text-white"
                            title={`Video call ${u.fullName}`}
                          >
                            <Video className="w-3 h-3" /> Video
                          </button>
                        </>
                      )}
                      {u.uid !== profile?.uid && profile?.role === 'super_admin' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteDoc(doc(db, 'users', u.uid));
                            await logAuditEvent(profile, 'USER_DELETED', 'user', u.uid, `Deleted ${u.email}`, 'critical');
                          }}
                          className="text-red-600 hover:text-red-700 align-middle"
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

      {/* 1b. CUSTOMER MANAGEMENT */}
      {tab === 'customers' && (
        <div className="space-y-4">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[#15243A] dark:text-slate-100">
                Registered Customers ({customerAccounts.length})
              </h3>
              <p className="text-xs text-slate-500">
                Inspect customer profiles, view order history, or initiate a direct message, voice call, or video call.
              </p>
            </div>
            <input
              type="text"
              value={custSearch}
              onChange={(e) => setCustSearch(e.target.value)}
              placeholder="Search customers by name, email, phone..."
              className="min-h-[40px] w-full sm:w-72 rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
            />
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 dark:border-slate-800 bg-[#EAF4FF] dark:bg-slate-950 text-[#082B59] dark:text-slate-300">
                <tr>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Phone</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Orders / Spend</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {customerAccounts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No registered customers match your search.</td>
                  </tr>
                ) : (
                  customerAccounts.map((cust) => {
                    const custOrders = orders.filter((o) => o.customerUid === cust.uid && (showDemoData || !o.isDemo));
                    const spend = custOrders.filter((o) => o.status !== 'cancelled').reduce((s, o) => s + o.total, 0);
                    return (
                      <tr key={cust.uid} className="hover:bg-[#F5F8FC] dark:hover:bg-slate-800/40">
                        <td className="px-4 py-3">
                          <div className="font-semibold text-[#15243A] dark:text-slate-100">{cust.fullName}</div>
                          <div className="text-slate-500">{cust.email}</div>
                        </td>
                        <td className="px-4 py-3 tabular-nums">{cust.phone || '—'}</td>
                        <td className="px-4 py-3 capitalize">{cust.status.replace('_', ' ')}</td>
                        <td className="px-4 py-3 tabular-nums">
                          <span className="font-semibold">{custOrders.length}</span> orders · ETB {spend.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => setSelectedCustomer(cust)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF]"
                          >
                            <Eye className="w-3.5 h-3.5 text-[#1178B9]" /> Orders
                          </button>
                          {(onOpenDirectChat || onOpenCustomerChat) && (
                            <button
                              type="button"
                              onClick={() => (onOpenDirectChat ? onOpenDirectChat(cust) : onOpenCustomerChat?.(cust))}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF]"
                            >
                              <MessageSquare className="w-3.5 h-3.5 text-[#1178B9]" /> Chat
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={callPhase !== 'idle'}
                            onClick={() => {
                              setTab('calls');
                              startCall({ targetUid: cust.uid, targetName: cust.fullName, callType: 'audio' });
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] disabled:opacity-40"
                          >
                            <Phone className="w-3.5 h-3.5 text-[#1178B9]" /> Audio
                          </button>
                          <button
                            type="button"
                            disabled={callPhase !== 'idle'}
                            onClick={() => {
                              setTab('calls');
                              startCall({ targetUid: cust.uid, targetName: cust.fullName, callType: 'video' });
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-40 text-white"
                          >
                            <Video className="w-3.5 h-3.5" /> Video
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
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

      {/* 4. PRODUCT CATALOG & CATEGORIES */}
      {tab === 'catalog' && (
        <div className="space-y-6">
          {/* Categories Management */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
            <h3 className="text-sm font-semibold flex items-center gap-2 text-[#15243A] dark:text-slate-100">
              <FolderPlus className="w-4 h-4 text-[#1178B9]" /> Product Categories ({productCategories.length})
            </h3>
            <form onSubmit={handleCreateCategory} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              <input
                type="text"
                required
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="Category Name (e.g. Packaging)"
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              />
              <input
                type="text"
                value={catDesc}
                onChange={(e) => setCatDesc(e.target.value)}
                placeholder="Short description"
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              />
              <input
                type="text"
                value={catImageUrl}
                onChange={(e) => setCatImageUrl(e.target.value)}
                placeholder="Category Image URL (or upload)"
                className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
              />
              <label className="min-h-[40px] inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-xs font-medium cursor-pointer hover:bg-[#EAF4FF]">
                <ImagePlus className="w-3.5 h-3.5 text-[#1178B9]" />
                {catUploading ? 'Uploading...' : 'Upload Image'}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleUploadCategoryImage(e.target.files[0])}
                />
              </label>
              <button type="submit" className="min-h-[40px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white px-4 py-2 text-xs font-semibold">
                Add Category
              </button>
            </form>
            {productCategories.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                {productCategories.map((c) => (
                  <div
                    key={c.id}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 text-xs"
                  >
                    <span className="font-semibold">{c.name}</span>
                    <button
                      type="button"
                      onClick={() => updateDoc(doc(db, 'productCategories', c.id), { active: !c.active, updatedAt: new Date().toISOString() })}
                      className="text-[11px] text-[#1178B9] hover:underline"
                    >
                      {c.active ? 'Active' : 'Hidden'}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteDoc(doc(db, 'productCategories', c.id))}
                      aria-label={`Delete category ${c.name}`}
                      className="text-red-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form onSubmit={handleSaveProduct} className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold flex items-center gap-2 text-[#15243A] dark:text-slate-100">
                  {editingProduct ? <Edit3 className="w-4 h-4 text-[#1178B9]" /> : <Plus className="w-4 h-4 text-[#1178B9]" />}
                  {editingProduct ? `Edit Product — ${editingProduct.sku}` : 'Add Customer Product / Service'}
                </h3>
                {editingProduct && (
                  <button type="button" onClick={resetProductForm} className="text-xs text-slate-500 hover:underline">
                    Cancel Edit
                  </button>
                )}
              </div>

              <input type="text" required value={prodName} onChange={(e) => setProdName(e.target.value)} placeholder="Product Name *" className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />

              <div className="grid grid-cols-2 gap-2">
                <input type="text" required value={prodSku} onChange={(e) => setProdSku(e.target.value)} placeholder="Product Code / SKU *" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs uppercase" />
                <div>
                  <input
                    list="admin-product-categories"
                    required
                    value={prodCategory}
                    onChange={(e) => setProdCategory(e.target.value)}
                    placeholder="Category *"
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                  <datalist id="admin-product-categories">
                    {productCategories.map((c) => <option key={c.id} value={c.name} />)}
                  </datalist>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[11px] font-medium text-slate-500">Pricing Option</span>
                  <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => {
                        setProdContactForPrice(false);
                        if (!prodPrice) setProdPrice('0');
                      }}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                        !prodContactForPrice
                          ? 'bg-[#082B59] text-white'
                          : 'text-[#293858] dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800'
                      }`}
                    >
                      Fixed Price
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setProdContactForPrice(true);
                        setProdPrice('');
                      }}
                      className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                        prodContactForPrice
                          ? 'bg-[#1178B9] text-white'
                          : 'text-[#293858] dark:text-slate-300 hover:bg-white/60 dark:hover:bg-slate-800'
                      }`}
                    >
                      Contact for Price
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {prodContactForPrice ? (
                    <div className="min-h-[40px] rounded-lg border border-[#1178B9]/40 bg-[#EAF4FF] dark:bg-[#082B59]/40 px-3 py-2 text-[11px] font-semibold text-[#082B59] dark:text-[#EAF4FF] flex items-center">
                      Contact for Price
                    </div>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={prodPrice}
                      onChange={(e) => setProdPrice(e.target.value)}
                      placeholder="Price (ETB, optional)"
                      className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                    />
                  )}
                  <input type="number" min={0} required value={prodStock} onChange={(e) => setProdStock(e.target.value)} placeholder="Stock *" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                  <input type="text" required value={prodUnit} onChange={(e) => setProdUnit(e.target.value)} placeholder="Unit (Piece, Box...)" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Availability Status</label>
                <select
                  value={prodAvail}
                  onChange={(e) => setProdAvail(e.target.value as ProductAvailabilityStatus)}
                  className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                >
                  <option value="in_stock">In Stock</option>
                  <option value="low_stock">Low Stock</option>
                  <option value="out_of_stock">Out of Stock</option>
                  <option value="preorder">Pre-Order</option>
                </select>
              </div>

              {/* Main Image & Additional Gallery */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={prodImageUrl}
                    onChange={(e) => setProdImageUrl(e.target.value)}
                    placeholder="Main product image URL (or upload)"
                    className="flex-1 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-1.5 text-xs"
                  />
                  <label className="min-h-[38px] inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-2.5 py-1.5 text-xs font-medium cursor-pointer hover:bg-[#EAF4FF]">
                    <ImagePlus className="w-3.5 h-3.5 text-[#1178B9]" /> Main
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleUploadProductImages(e.target.files, 'main')}
                    />
                  </label>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">Additional Gallery Images ({prodGallery.length}/12)</span>
                  <label className="inline-flex items-center gap-1 text-[#1178B9] font-medium cursor-pointer hover:underline">
                    <ImagePlus className="w-3.5 h-3.5" /> {prodUploading ? 'Uploading...' : 'Add Gallery Photos'}
                    <input
                      type="file"
                      multiple
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleUploadProductImages(e.target.files, 'gallery')}
                    />
                  </label>
                </div>

                {prodGallery.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {prodGallery.map((gUrl, idx) => (
                      <div key={`${gUrl}_${idx}`} className="relative w-12 h-12 rounded border border-slate-200 overflow-hidden">
                        <img src={gUrl} alt="Gallery" referrerPolicy="no-referrer" className="w-full h-full object-cover" />
                        <button
                          type="button"
                          onClick={() => setProdGallery((prev) => prev.filter((_, i) => i !== idx))}
                          className="absolute top-0 right-0 bg-red-600 text-white p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Technical Specifications */}
              <div className="space-y-2 pt-1">
                <label className="block text-[11px] font-medium text-slate-500">Product Specifications</label>
                <div className="flex gap-1.5">
                  <input type="text" value={specKey} onChange={(e) => setSpecKey(e.target.value)} placeholder="Spec Name (e.g. Material)" className="flex-1 min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-1 text-xs" />
                  <input type="text" value={specVal} onChange={(e) => setSpecVal(e.target.value)} placeholder="Value (e.g. Steel)" className="flex-1 min-h-[36px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2.5 py-1 text-xs" />
                  <button
                    type="button"
                    onClick={() => {
                      if (!specKey.trim() || !specVal.trim()) return;
                      setProdSpecs((prev) => [...prev, { key: specKey.trim(), value: specVal.trim() }].slice(0, 40));
                      setSpecKey('');
                      setSpecVal('');
                    }}
                    className="px-2.5 rounded-lg bg-[#082B59] text-white text-xs font-medium"
                  >
                    Add
                  </button>
                </div>
                {prodSpecs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {prodSpecs.map((s, idx) => (
                      <span key={`${s.key}_${idx}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#EAF4FF] dark:bg-[#082B59]/40 text-[#082B59] dark:text-[#EAF4FF]">
                        <strong>{s.key}:</strong> {s.value}
                        <button type="button" onClick={() => setProdSpecs((prev) => prev.filter((_, i) => i !== idx))}>
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <textarea rows={3} value={prodDesc} onChange={(e) => setProdDesc(e.target.value)} placeholder="Detailed product description..." className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />

              {/* Multi-Channel User Notification Broadcast Settings */}
              <div className="rounded-xl border border-[#1178B9]/30 bg-[#EAF4FF]/60 dark:bg-[#082B59]/25 p-3.5 space-y-2.5 text-xs">
                <label className="flex items-center justify-between gap-2 font-semibold text-[#082B59] dark:text-[#EAF4FF] cursor-pointer">
                  <span className="inline-flex items-center gap-1.5">
                    <Bell className="w-3.5 h-3.5 text-[#1178B9]" />
                    Notify All Active Users on Publish ({users.filter((u) => u.status === 'active').length})
                  </span>
                  <input
                    type="checkbox"
                    checked={notifyUsersOnSave}
                    onChange={(e) => setNotifyUsersOnSave(e.target.checked)}
                    className="rounded border-slate-300 text-[#1178B9]"
                  />
                </label>

                {notifyUsersOnSave && (
                  <div className="space-y-2 pt-1">
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          { id: 'in_app', label: 'In-App Alerts' },
                          { id: 'push', label: 'Live Push / Browser' },
                          { id: 'email', label: 'Email' },
                          { id: 'sms', label: 'Text (SMS)' },
                          { id: 'whatsapp', label: 'WhatsApp' },
                          { id: 'telegram', label: 'Telegram' },
                        ] as const
                      ).map(({ id, label }) => {
                        const selected = notifyChannels.includes(id);
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => toggleNotifyChannel(id)}
                            aria-pressed={selected}
                            className={`px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors ${
                              selected
                                ? 'bg-[#082B59] text-white border-[#082B59]'
                                : 'bg-white dark:bg-slate-900 text-[#293858] dark:text-slate-300 border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            {selected ? '✓ ' : ''}
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <input
                      type="text"
                      value={notifyCustomMsg}
                      onChange={(e) => setNotifyCustomMsg(e.target.value)}
                      placeholder="Optional launch note for email / text / push..."
                      className="w-full min-h-[34px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-[11px]"
                    />
                    {notifyChannels.includes('telegram') && (
                      <input
                        type="text"
                        value={notifyTelegramTarget}
                        onChange={(e) => setNotifyTelegramTarget(e.target.value)}
                        placeholder="Optional Telegram Chat or @Channel ID"
                        className="w-full min-h-[34px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2.5 py-1 text-[11px]"
                      />
                    )}
                    <p className="text-[11px] text-slate-600 dark:text-slate-300">
                      Audience ready: {users.filter((u) => u.status === 'active' && u.email).length} emails ·{' '}
                      {users.filter((u) => u.status === 'active' && u.phone).length} phone numbers
                    </p>
                  </div>
                )}
              </div>

              <button type="submit" className="w-full min-h-[42px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white py-2 text-xs font-semibold">
                {editingProduct ? 'Save Product Changes' : 'Publish Product'}
              </button>
            </form>

            <div className="lg:col-span-7 space-y-4">
              {broadcastReport && (
                <div className="rounded-xl border border-[#1178B9]/40 bg-[#EAF4FF]/70 dark:bg-[#082B59]/40 p-4 space-y-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-bold text-[#082B59] dark:text-[#EAF4FF]">
                        Notification Broadcast Summary — {broadcastReport.productName} ({broadcastReport.sku})
                      </p>
                      <p className="text-[11px] text-[#293858] dark:text-slate-300">
                        In-App Alerts Saved: <strong>{broadcastReport.report.inAppSaved}</strong> · Live WebSocket Recipients:{' '}
                        <strong>{broadcastReport.report.channels.websocket.delivered}</strong>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setBroadcastReport(null)}
                      aria-label="Close broadcast summary"
                      className="p-1 rounded hover:bg-white/60 dark:hover:bg-slate-800"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {(
                      [
                        { key: 'email', label: 'Email', action: 'Open Email Draft' },
                        { key: 'sms', label: 'Text (SMS)', action: 'Open SMS App' },
                        { key: 'whatsapp', label: 'WhatsApp', action: 'Share WhatsApp' },
                        { key: 'telegram', label: 'Telegram', action: 'Share Telegram' },
                      ] as const
                    ).map(({ key, label, action }) => {
                      const info = broadcastReport.report.channels[key];
                      if (!info.requested) return null;
                      return (
                        <div
                          key={key}
                          className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-2.5 space-y-1"
                        >
                          <p className="font-semibold text-[#15243A] dark:text-slate-100">{label}</p>
                          <p className="text-[11px] text-slate-500">
                            {info.configured
                              ? `Sent: ${info.delivered}/${info.attempted}`
                              : info.attempted > 0
                              ? `${info.attempted} ready (fallback)`
                              : 'Ready to launch'}
                          </p>
                          {info.fallbackUrl && (
                            <a
                              href={info.fallbackUrl}
                              target={info.fallbackUrl.startsWith('https://') ? '_blank' : undefined}
                              rel={info.fallbackUrl.startsWith('https://') ? 'noopener noreferrer' : undefined}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1178B9] hover:underline"
                            >
                              <Send className="w-3 h-3" /> {action}
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

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
                    <div key={p.id} className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                      <div className="flex items-center gap-3 min-w-0">
                        <img
                          src={p.imageUrl || '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png'}
                          alt={p.name}
                          referrerPolicy="no-referrer"
                          className="w-12 h-12 rounded-lg object-cover bg-[#F3F5F8] dark:bg-slate-800 shrink-0"
                        />
                        <div className="min-w-0">
                          <p className="text-sm font-semibold flex items-center gap-2 flex-wrap">
                            <span>{p.name}</span>
                            <span className="font-mono text-xs text-slate-400">({p.sku})</span>
                            {p.isDemo && (
                              <span className="px-1.5 py-0.5 rounded bg-[#EAF4FF] text-[#082B59] text-[10px] font-semibold">DEMO</span>
                            )}
                          </p>
                          <p className="text-slate-500 tabular-nums">
                            {p.category} ·{' '}
                            {p.contactForPrice ? (
                              <span className="font-semibold text-[#1178B9]">Contact for Price</span>
                            ) : (
                              `${p.currency} ${(p.price ?? 0).toFixed(2)}`
                            )}{' '}
                            / {p.unit || 'Unit'} · Stock: {p.stock}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={broadcastingProductId === p.id}
                          onClick={async () => {
                            const rep = await broadcastProductAlert({
                              id: p.id,
                              name: p.name,
                              sku: p.sku,
                              category: p.category,
                              price: p.price ?? 0,
                              contactForPrice: p.contactForPrice,
                              currency: p.currency,
                              unit: p.unit,
                              description: p.description,
                              imageUrl: p.imageUrl,
                            });
                            if (rep) {
                              setNotice(`Sent product announcement for ${p.name} to ${rep.inAppSaved} app user(s).`);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#EAF4FF] hover:bg-[#1178B9] hover:text-white text-[#082B59] font-medium disabled:opacity-50"
                        >
                          <Mail className="w-3.5 h-3.5" />
                          {broadcastingProductId === p.id ? 'Sending...' : 'Notify Users'}
                        </button>
                        <button
                          type="button"
                          onClick={() => startEditProduct(p)}
                          className="px-2.5 py-1.5 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF]"
                        >
                          Edit
                        </button>
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
                  { label: 'Ready for Delivery', value: 'ready_for_delivery' },
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
                  <th className="px-4 py-2.5 font-semibold">Customer & Delivery</th>
                  <th className="px-4 py-2.5 font-semibold">Total</th>
                  <th className="px-4 py-2.5 font-semibold">Status Approval</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Actions & Document</th>
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
                    <td className="px-4 py-3">
                      <div className="font-medium">{o.customerName}</div>
                      {o.customerPhone && <div className="text-[11px] text-slate-500">Tel: {o.customerPhone}</div>}
                      {o.shippingAddress && <div className="text-[11px] text-slate-400 truncate max-w-[220px]">{o.shippingAddress}</div>}
                    </td>
                    <td className="px-4 py-3 tabular-nums font-medium">{o.currency} {o.total.toFixed(2)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={o.status}
                        onChange={async (e) => {
                          if (!profile) return;
                          try {
                            await processOrderStatusWithAudit(profile, o, e.target.value as CustomerOrder['status']);
                            setNotice(`Order ${o.orderNumber} updated to ${ORDER_STATUS_LABELS[e.target.value as CustomerOrder['status']]}.`);
                          } catch (err) {
                            showError(err);
                          }
                        }}
                        className="rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-2 py-1"
                      >
                        <option value="pending">Pending</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="processing">Processing</option>
                        <option value="ready_for_delivery">Ready for Delivery</option>
                        <option value="shipped">Shipped</option>
                        <option value="delivered">Delivered</option>
                        <option value="cancelled">Cancelled (Auto Refund Ledger)</option>
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right space-x-1.5 whitespace-nowrap">
                      {o.status === 'pending' && (
                        <>
                          <button
                            type="button"
                            onClick={() => profile && processOrderStatusWithAudit(profile, o, 'confirmed', 'Order confirmed by staff').catch(showError)}
                            className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white font-medium"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => profile && processOrderStatusWithAudit(profile, o, 'cancelled', 'Rejected by administrator').catch(showError)}
                            className="px-2.5 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 font-medium"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {(onOpenDirectChat || onOpenCustomerChat) && (
                        <button
                          type="button"
                          onClick={() => {
                            const targetUser =
                              users.find((u) => u.uid === o.customerUid) ||
                              ({
                                uid: o.customerUid,
                                email: '',
                                fullName: o.customerName,
                                accountType: 'customer',
                                role: 'customer',
                                status: 'active',
                                availability: 'available',
                                createdAt: o.createdAt,
                                updatedAt: o.updatedAt,
                              } as UserAccount);
                            if (onOpenDirectChat) {
                              onOpenDirectChat(targetUser, { order: o, subject: `Order ${o.orderNumber} Support` });
                            } else {
                              onOpenCustomerChat?.(targetUser);
                            }
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF]"
                          title={`Chat with ${o.customerName}`}
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-[#1178B9]" /> Chat
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={callPhase !== 'idle'}
                        onClick={() => {
                          setTab('calls');
                          startCall({
                            targetUid: o.customerUid,
                            targetName: o.customerName,
                            callType: 'audio',
                            orderId: o.id,
                          });
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] disabled:opacity-40"
                        title={`Voice call ${o.customerName}`}
                      >
                        <Phone className="w-3.5 h-3.5 text-[#1178B9]" />
                      </button>
                      <button
                        type="button"
                        disabled={callPhase !== 'idle'}
                        onClick={() => {
                          setTab('calls');
                          startCall({
                            targetUid: o.customerUid,
                            targetName: o.customerName,
                            callType: 'video',
                            orderId: o.id,
                          });
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-40 text-white"
                        title={`Video call ${o.customerName}`}
                      >
                        <Video className="w-3.5 h-3.5" />
                      </button>
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
                <div className="flex flex-wrap items-center gap-2">
                  {(onOpenDirectChat || onOpenCustomerChat) && (
                    <button
                      type="button"
                      onClick={() => {
                        const targetUser =
                          users.find((u) => u.uid === f.customerUid) ||
                          ({
                            uid: f.customerUid,
                            email: '',
                            fullName: f.customerName,
                            accountType: 'customer',
                            role: 'customer',
                            status: 'active',
                            availability: 'available',
                            createdAt: f.createdAt,
                            updatedAt: f.updatedAt,
                          } as UserAccount);
                        if (onOpenDirectChat) {
                          onOpenDirectChat(targetUser, { subject: `Re: ${f.subject}` });
                        } else {
                          onOpenCustomerChat?.(targetUser);
                        }
                      }}
                      className="min-h-[36px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF]"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-[#1178B9]" /> Reply
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={callPhase !== 'idle'}
                    onClick={() => {
                      setTab('calls');
                      startCall({ targetUid: f.customerUid, targetName: f.customerName, callType: 'audio' });
                    }}
                    className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] disabled:opacity-40"
                    title={`Voice call ${f.customerName}`}
                  >
                    <Phone className="w-3.5 h-3.5 text-[#1178B9]" />
                  </button>
                  <button
                    type="button"
                    disabled={callPhase !== 'idle'}
                    onClick={() => {
                      setTab('calls');
                      startCall({ targetUid: f.customerUid, targetName: f.customerName, callType: 'video' });
                    }}
                    className="min-h-[36px] inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#082B59] hover:bg-[#1178B9] disabled:opacity-40 text-white"
                    title={`Video call ${f.customerName}`}
                  >
                    <Video className="w-3.5 h-3.5" />
                  </button>
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
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5b. CUSTOMER SERVICE CALL DESK */}
      {tab === 'calls' && (
        <DirectCallPanel
          mode="staff"
          customers={customerAccounts}
          onToggleAvailability={async (available) => {
            await updateAvailability(available ? 'available' : 'away');
            const updatedUsers = users.map((u) =>
              u.uid === profile?.uid ? { ...u, availability: available ? ('available' as const) : ('away' as const) } : u
            );
            await syncSupportRoutingDirectory(updatedUsers).catch(() => {});
          }}
        />
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

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Database Export & Backup</h3>
              <p className="text-xs text-slate-500">
                Download a complete JSON snapshot of users, departments, categories, products, orders, financial transactions, and audit logs.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  await syncSupportRoutingDirectory(users).catch(() => {});
                  setNotice('Synchronized Customer Service routing directory.');
                }}
                className="min-h-[40px] px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] text-xs font-medium"
              >
                Sync Call Routing Directory
              </button>
              <button
                type="button"
                onClick={() => {
                  exportDatabaseBackupJSON({
                    users,
                    departments,
                    productCategories,
                    products,
                    orders,
                    feedback,
                    transactions,
                    auditLogs,
                  });
                  if (profile) {
                    logAuditEvent(profile, 'DATABASE_BACKUP_EXPORTED', 'system', 'json_backup', `Exported ${orders.length} orders and ${products.length} products`);
                  }
                }}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-[#082B59] hover:bg-[#082B59]/90 text-white text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" /> Export Database JSON
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
            <h3 className="text-sm font-semibold">External Messaging & WebRTC Gateway Configuration</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
              {[
                { label: 'Telegram Bot API', ok: Boolean(integrationStatus.telegramBot) },
                { label: 'WhatsApp Cloud API', ok: Boolean(integrationStatus.whatsappCloud) },
                { label: 'Twilio SMS Gateway', ok: Boolean(integrationStatus.twilioSms) },
                { label: 'Email SMTP Webhook', ok: Boolean(integrationStatus.emailWebhook) },
                { label: 'TURN NAT Relay', ok: Boolean(integrationStatus.turnConfigured) },
              ].map((g) => (
                <div key={g.label} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                  <p className="font-medium">{g.label}</p>
                  <p className={g.ok ? 'text-[#1178B9] font-medium' : 'text-slate-400'}>
                    {g.ok ? 'Server Configured' : 'STUN / Client Fallback'}
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

      {/* Customer Orders Drilldown Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#082B59]/65 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-[#15243A] dark:text-slate-100">{selectedCustomer.fullName}</h3>
                <p className="text-xs text-slate-500">
                  {selectedCustomer.email} {selectedCustomer.phone ? `· ${selectedCustomer.phone}` : ''}
                </p>
              </div>
              <button type="button" onClick={() => setSelectedCustomer(null)} className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {orders.filter((o) => o.customerUid === selectedCustomer.uid).length === 0 ? (
                <p className="py-8 text-center text-slate-500">This customer has not placed any orders yet.</p>
              ) : (
                orders
                  .filter((o) => o.customerUid === selectedCustomer.uid)
                  .map((o) => (
                    <div key={o.id} className="py-3 flex items-center justify-between gap-3">
                      <div>
                        <p className="font-mono font-bold text-[#082B59] dark:text-[#EAF4FF]">
                          {o.orderNumber} · {ORDER_STATUS_LABELS[o.status]}
                        </p>
                        <p className="text-slate-500 tabular-nums">
                          {new Date(o.createdAt).toLocaleString()} · {o.items.length} items · {o.currency} {o.total.toFixed(2)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedCustomer(null);
                          setPreviewOrder(o);
                        }}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] font-medium"
                      >
                        View Invoice
                      </button>
                    </div>
                  ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
