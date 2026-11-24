import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, doc, onSnapshot, query, updateDoc, where } from 'firebase/firestore';
import {
  Bell,
  Eye,
  HelpCircle,
  LogOut,
  Menu,
  MessageSquare,
  Package,
  Search,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { downloadFinancialReceiptPDF, downloadOrderInvoicePDF } from '../../lib/exportUtils';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { logAuditEvent, placeOrderWithTransaction } from '../../lib/firestoreActions';
import {
  CustomerFeedback,
  CustomerOrder,
  FinancialTransaction,
  Meeting,
  NotificationItem,
  OrderItem,
  Product,
} from '../../types/domain';
import { MessagingCenter } from '../chat/MessagingCenter';
import { MeetingsHub } from '../meetings/MeetingsHub';
import { DocumentPreviewModal } from '../shared/DocumentPreviewModal';
import { PWAInstallButton } from '../shared/PWAComponents';
import { SearchFilterSortBar } from '../shared/SearchFilterSortBar';
import { SyncAndSecurityCenter } from '../shared/SyncAndSecurityCenter';

type CustomerTab = 'catalog' | 'orders' | 'support' | 'community' | 'meetings' | 'account';

export const CustomerPortal: React.FC = () => {
  const { profile, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { connected: wsConnected } = useWebSocket();

  const [tab, setTab] = useState<CustomerTab>('catalog');
  const [mobileMenu, setMobileMenu] = useState(false);

  const [products, setProducts] = useState<Product[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [feedback, setFeedback] = useState<CustomerFeedback[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showDemoData, setShowDemoData] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);

  const [cart, setCart] = useState<Record<string, number>>({});
  const [shippingAddress, setShippingAddress] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<FinancialTransaction['method']>('bank_transfer');
  const [catFilter, setCatFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);

  // Order & Receipt search/filter/sort + printable previews
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [orderSortBy, setOrderSortBy] = useState<'createdAt' | 'total'>('createdAt');
  const [orderSortDir, setOrderSortDir] = useState<'asc' | 'desc'>('desc');

  const [txSearch, setTxSearch] = useState('');
  const [txStatusFilter, setTxStatusFilter] = useState('all');
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('desc');

  const [previewInvoiceOrder, setPreviewInvoiceOrder] = useState<CustomerOrder | null>(null);
  const [previewReceiptTx, setPreviewReceiptTx] = useState<FinancialTransaction | null>(null);

  // Feedback form
  const [fbType, setFbType] = useState<CustomerFeedback['type']>('inquiry');
  const [fbSubject, setFbSubject] = useState('');
  const [fbMessage, setFbMessage] = useState('');
  const [fbRating, setFbRating] = useState(5);
  const [fbOrderId, setFbOrderId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    const unsubProd = onSnapshot(
      query(collection(db, 'products'), where('active', '==', true)),
      (snap) => setProducts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'products')
    );
    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), where('customerUid', '==', profile.uid)),
      (snap) =>
        setOrders(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerOrder, 'id'>) }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'orders')
    );
    const unsubTx = onSnapshot(
      query(collection(db, 'financialTransactions'), where('customerUid', '==', profile.uid)),
      (snap) =>
        setTransactions(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<FinancialTransaction, 'id'>) }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'financialTransactions')
    );
    const unsubFb = onSnapshot(
      query(collection(db, 'customerFeedback'), where('customerUid', '==', profile.uid)),
      (snap) => setFeedback(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerFeedback, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'customerFeedback')
    );
    const unsubNotif = onSnapshot(
      query(collection(db, 'notifications'), where('targetUid', '==', profile.uid)),
      (snap) =>
        setNotifications(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<NotificationItem, 'id'>) }))
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        ),
      (err) => handleFirestoreError(err, OperationType.LIST, 'notifications')
    );
    const unsubSettings = onSnapshot(doc(db, 'publicConfig', 'appSettings'), (snap) => {
      if (snap.exists()) setShowDemoData(Boolean(snap.data().showDemoData));
    });

    return () => {
      unsubProd();
      unsubOrders();
      unsubTx();
      unsubFb();
      unsubNotif();
      unsubSettings();
    };
  }, [profile?.uid]);

  const activeCatalogProducts = useMemo(
    () => products.filter((p) => showDemoData || !p.isDemo),
    [products, showDemoData]
  );

  const categories = useMemo(
    () => ['all', ...Array.from(new Set(activeCatalogProducts.map((p) => p.category)))],
    [activeCatalogProducts]
  );

  const visibleProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return activeCatalogProducts.filter((p) => {
      if (catFilter !== 'all' && p.category !== catFilter) return false;
      if (term && !p.name.toLowerCase().includes(term) && !(p.description || '').toLowerCase().includes(term)) return false;
      return true;
    });
  }, [activeCatalogProducts, catFilter, searchTerm]);

  const filteredOrders = useMemo(() => {
    const term = orderSearch.trim().toLowerCase();
    return orders
      .filter((o) => {
        if (!showDemoData && o.isDemo) return false;
        if (orderStatusFilter !== 'all' && o.status !== orderStatusFilter) return false;
        if (
          term &&
          !o.orderNumber.toLowerCase().includes(term) &&
          !o.invoiceNumber.toLowerCase().includes(term)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        const cmp = orderSortBy === 'total' ? a.total - b.total : a.createdAt.localeCompare(b.createdAt);
        return orderSortDir === 'asc' ? cmp : -cmp;
      });
  }, [orders, showDemoData, orderSearch, orderStatusFilter, orderSortBy, orderSortDir]);

  const filteredTransactions = useMemo(() => {
    const term = txSearch.trim().toLowerCase();
    return transactions
      .filter((t) => {
        if (!showDemoData && t.isDemo) return false;
        if (txStatusFilter !== 'all' && t.status !== txStatusFilter) return false;
        if (
          term &&
          !t.txNumber.toLowerCase().includes(term) &&
          !(t.orderNumber || '').toLowerCase().includes(term)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) =>
        txSortDir === 'asc' ? a.createdAt.localeCompare(b.createdAt) : b.createdAt.localeCompare(a.createdAt)
      );
  }, [transactions, showDemoData, txSearch, txStatusFilter, txSortDir]);

  const cartItems = useMemo(() => {
    const items: OrderItem[] = [];
    Object.entries(cart).forEach(([id, qty]) => {
      const prod = activeCatalogProducts.find((p) => p.id === id);
      if (prod && qty > 0) {
        items.push({ productId: prod.id, name: prod.name, sku: prod.sku, quantity: qty, unitPrice: prod.price });
      }
    });
    return items;
  }, [cart, activeCatalogProducts]);

  const cartTotal = useMemo(() => cartItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0), [cartItems]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const placeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!profile || cartItems.length === 0) return;
    if (shippingAddress.trim().length < 4) {
      setFormError('Please provide a complete delivery or installation address.');
      return;
    }

    try {
      const res = await placeOrderWithTransaction({
        customer: profile,
        items: cartItems,
        total: cartTotal,
        currency: activeCatalogProducts[0]?.currency || 'ETB',
        shippingAddress: shippingAddress.trim(),
        notes: orderNotes.trim() || undefined,
        paymentMethod,
      });
      setCart({});
      setShippingAddress('');
      setOrderNotes('');
      setNotice(`Order ${res.orderNumber} & financial receipt ${res.txNumber} recorded. Preview, print, or download your invoice below.`);
      setTab('orders');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to submit order.');
    }
  };

  const handleCancelOrder = async (o: CustomerOrder) => {
    if (!profile) return;
    await updateDoc(doc(db, 'orders', o.id), {
      status: 'cancelled',
      updatedAt: new Date().toISOString(),
    });
    await logAuditEvent(profile, 'CUSTOMER_ORDER_CANCELLED', 'order', o.id, `Customer cancelled ${o.orderNumber}`, 'warning');
    setNotice(`Order ${o.orderNumber} cancelled.`);
    if (previewInvoiceOrder?.id === o.id) {
      setPreviewInvoiceOrder(null);
    }
  };

  const submitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !fbSubject.trim() || !fbMessage.trim()) return;
    const now = new Date().toISOString();
    await addDoc(collection(db, 'customerFeedback'), {
      customerUid: profile.uid,
      customerName: profile.fullName,
      ...(fbOrderId ? { orderId: fbOrderId } : {}),
      type: fbType,
      subject: fbSubject.trim(),
      message: fbMessage.trim(),
      rating: fbRating,
      status: 'open',
      isDemo: false,
      createdAt: now,
      updatedAt: now,
    });
    setFbSubject('');
    setFbMessage('');
    setNotice('Your inquiry/feedback has been submitted to Seven Sunday Customer Care.');
  };

  const navItems: Array<{ id: CustomerTab; label: string; shortLabel: string; Icon: React.ElementType }> = [
    { id: 'catalog', label: 'Catalog & Order', shortLabel: 'Catalog', Icon: ShoppingBag },
    { id: 'orders', label: 'Orders & Invoices', shortLabel: 'Orders', Icon: Package },
    { id: 'support', label: 'Support Chat', shortLabel: 'Support', Icon: HelpCircle },
    { id: 'community', label: 'Customer Community', shortLabel: 'Community', Icon: Users },
    { id: 'meetings', label: 'Invited Meetings', shortLabel: 'Meetings', Icon: Video },
    { id: 'account', label: 'Account & Sync', shortLabel: 'Account', Icon: Shield },
  ];

  return (
    <div className="min-h-screen bg-[#F5F8FC] dark:bg-slate-950 text-[#293858] dark:text-slate-100 flex">
      {/* Customer Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-white/10 bg-[#082B59] text-white flex flex-col justify-between transition-transform lg:static lg:translate-x-0 ${
          mobileMenu ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
                alt="7Sunday Meet"
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full bg-white object-contain p-0.5"
              />
              <span className="font-display font-bold text-base">Customer Portal</span>
            </div>
            <button type="button" onClick={() => setMobileMenu(false)} className="lg:hidden min-h-[40px] min-w-[40px] inline-flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="p-3 space-y-1">
            {navItems.map(({ id, label, Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setTab(id);
                  setMobileMenu(false);
                }}
                className={`w-full min-h-[44px] flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  tab === id
                    ? 'bg-[#1178B9] text-white'
                    : 'text-[#EAF4FF]/85 hover:bg-white/10'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-white/10 space-y-3 text-xs bg-[#293858]">
          <div>
            <p className="font-semibold truncate text-white">{profile?.fullName}</p>
            <p className="text-[#EAF4FF]/75 truncate">Customer Account · {wsConnected ? 'Live' : 'Connecting'}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="w-full min-h-[40px] inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-white/20 hover:bg-white/10 font-medium text-white"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 sm:px-6 py-3 flex items-center justify-between gap-4 pt-safe">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" onClick={() => setMobileMenu(true)} aria-label="Open menu" className="lg:hidden min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-1.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <Menu className="w-4 h-4" />
            </button>
            <span className="text-sm font-semibold text-[#15243A] dark:text-slate-100 truncate">
              Seven Sunday Customer Portal / {navItems.find((i) => i.id === tab)?.label}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotifications(!showNotifications)}
                aria-label="Notifications"
                className="relative min-h-[40px] min-w-[40px] inline-flex items-center justify-center p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#1178B9] text-white text-[10px] flex items-center justify-center tabular-nums">
                    {unreadCount}
                  </span>
                )}
              </button>
              {showNotifications && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl z-50 p-4 space-y-2 max-h-96 overflow-y-auto">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Notifications</span>
                    <button type="button" onClick={() => setShowNotifications(false)}><X className="w-3.5 h-3.5" /></button>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">No notifications yet.</p>
                  ) : (
                    notifications.map((n) => (
                      <div
                        key={n.id}
                        onClick={() => updateDoc(doc(db, 'notifications', n.id), { read: true })}
                        className={`p-2.5 rounded-lg border text-xs cursor-pointer ${
                          n.read ? 'border-slate-100 dark:border-slate-800 opacity-70' : 'border-[#1178B9]/30 bg-[#EAF4FF] dark:bg-[#082B59]/40'
                        }`}
                      >
                        <p className="font-semibold text-[#15243A] dark:text-slate-100">{n.title}</p>
                        <p className="text-slate-500">{n.body}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={toggleTheme}
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium"
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
          </div>
        </header>

        <main className="flex-1 p-4 sm:p-6 pb-24 lg:pb-8 max-w-7xl w-full mx-auto space-y-6">
          {notice && (
            <div className="rounded-xl border border-[#1178B9]/30 bg-[#EAF4FF] dark:bg-[#082B59]/40 p-3 text-xs text-[#082B59] dark:text-[#EAF4FF] flex justify-between items-center">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)}><X className="w-3.5 h-3.5" /></button>
            </div>
          )}
          {formError && (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 flex justify-between items-center">
              <span>{formError}</span>
              <button type="button" onClick={() => setFormError(null)}><X className="w-3.5 h-3.5" /></button>
            </div>
          )}

          {tab === 'catalog' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-8 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-slate-800">
                    {categories.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCatFilter(c)}
                        className={`min-h-[36px] px-3 py-1 rounded-md text-xs font-medium capitalize ${
                          catFilter === c ? 'bg-[#082B59] text-white shadow-sm' : 'text-[#293858] dark:text-slate-300'
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="Search products..."
                      className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-8 pr-3 py-1.5 text-xs"
                    />
                  </div>
                </div>

                {visibleProducts.length === 0 ? (
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-500">
                    No active products published in the catalog yet. Check back soon or contact Customer Support.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {visibleProducts.map((p) => (
                      <div key={p.id} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col justify-between">
                        <div>
                          <img
                            src={p.imageUrl || '/src/assets/images/enterprise_room_kit_1795502288635.jpg'}
                            alt={p.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-44 object-cover bg-[#F3F5F8] dark:bg-slate-800"
                          />
                          <div className="p-4 space-y-1.5">
                            <p className="text-xs text-slate-500 flex items-center gap-2">
                              <span>{p.category} · SKU {p.sku}</span>
                              {p.isDemo && (
                                <span className="px-1.5 py-0.5 rounded bg-[#EAF4FF] text-[#082B59] text-[10px] font-semibold">DEMO</span>
                              )}
                            </p>
                            <h4 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">{p.name}</h4>
                            {p.description && <p className="text-xs text-slate-500 line-clamp-2">{p.description}</p>}
                          </div>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                          <span className="text-sm font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">{p.currency} {p.price.toFixed(2)}</span>
                          <button
                            type="button"
                            disabled={p.stock <= 0}
                            onClick={() => setCart((prev) => ({ ...prev, [p.id]: (prev[p.id] || 0) + 1 }))}
                            className="min-h-[40px] px-3.5 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white text-xs font-medium"
                          >
                            {p.stock > 0 ? 'Add to Order' : 'Out of Stock'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Cart & Checkout */}
              <form onSubmit={placeOrder} className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 h-fit">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold flex items-center gap-2 text-[#15243A] dark:text-slate-100"><ShoppingCart className="w-4 h-4 text-[#1178B9]" /> Order Summary</h3>
                  <span className="text-xs text-slate-500 tabular-nums">{cartItems.length} items</span>
                </div>

                {cartItems.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">Select products from the catalog to build an order.</p>
                ) : (
                  <div className="space-y-2 divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {cartItems.map((item) => (
                      <div key={item.productId} className="pt-2 flex items-center justify-between gap-2">
                        <div>
                          <p className="font-medium">{item.name}</p>
                          <p className="text-slate-400 tabular-nums">{item.quantity} × {item.unitPrice.toFixed(2)}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCart((prev) => { const n = { ...prev }; delete n[item.productId]; return n; })}
                          className="text-red-600"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <input
                  type="text"
                  required
                  value={shippingAddress}
                  onChange={(e) => setShippingAddress(e.target.value)}
                  placeholder="Delivery / Installation Address"
                  className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                />
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as FinancialTransaction['method'])}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                  >
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="card">Corporate / Debit Card</option>
                    <option value="mobile_money">Mobile Money</option>
                    <option value="cash_on_delivery">Cash on Delivery</option>
                  </select>
                </div>
                <textarea
                  rows={2}
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(e.target.value)}
                  placeholder="Optional order notes..."
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                />

                <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-sm font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">
                  <span>Total</span>
                  <span>ETB {cartTotal.toFixed(2)}</span>
                </div>

                <button
                  type="submit"
                  disabled={cartItems.length === 0}
                  className="w-full min-h-[44px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white py-2.5 text-xs font-medium"
                >
                  Submit Order & Record Transaction
                </button>
              </form>
            </div>
          )}

          {tab === 'orders' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 space-y-4">
                  <SearchFilterSortBar
                    search={orderSearch}
                    onSearchChange={setOrderSearch}
                    searchPlaceholder="Search by Order # or Invoice #..."
                    filters={[
                      {
                        label: 'Order status filter',
                        value: orderStatusFilter,
                        onChange: setOrderStatusFilter,
                        options: [
                          { label: 'All Statuses', value: 'all' },
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
                      { label: 'Amount', value: 'total' },
                    ]}
                    sortBy={orderSortBy}
                    onSortByChange={(v) => setOrderSortBy(v as typeof orderSortBy)}
                    sortDir={orderSortDir}
                    onToggleSortDir={() => setOrderSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                    resultCount={filteredOrders.length}
                  />

                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                    <div className="px-5 py-3.5 text-sm font-semibold text-[#15243A] dark:text-slate-100">My Orders & Invoices</div>
                    {filteredOrders.length === 0 ? (
                      <p className="p-8 text-center text-xs text-slate-500">No matching orders found.</p>
                    ) : (
                      filteredOrders.map((o) => (
                        <div key={o.id} className="p-5 flex flex-wrap items-center justify-between gap-4 text-xs">
                          <div className="space-y-1">
                            <p className="font-semibold text-sm flex items-center gap-2">
                              <span className="font-mono text-[#082B59] dark:text-[#EAF4FF]">{o.orderNumber}</span>
                              <span>·</span>
                              <span className="capitalize">{o.status}</span>
                              {o.isDemo && (
                                <span className="px-1.5 py-0.5 rounded bg-[#EAF4FF] text-[#082B59] text-[10px] font-semibold">DEMO</span>
                              )}
                            </p>
                            <p className="text-slate-500 tabular-nums">
                              {new Date(o.createdAt).toLocaleString()} · {o.items.length} line items · {o.currency} {o.total.toFixed(2)}
                            </p>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setPreviewInvoiceOrder(o)}
                              className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] font-medium"
                            >
                              <Eye className="w-3.5 h-3.5 text-[#1178B9]" /> Invoice & Print
                            </button>
                            {(o.status === 'pending' || o.status === 'confirmed') && (
                              <button
                                type="button"
                                onClick={() => handleCancelOrder(o)}
                                className="min-h-[38px] px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <form onSubmit={submitFeedback} className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
                  <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Submit Inquiry, Complaint, or Feedback</h3>
                  <div className="grid grid-cols-2 gap-2">
                    <select value={fbType} onChange={(e) => setFbType(e.target.value as CustomerFeedback['type'])} className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs">
                      <option value="inquiry">Product Inquiry</option>
                      <option value="complaint">Complaint</option>
                      <option value="feedback">Service Feedback</option>
                    </select>
                    <select value={fbOrderId} onChange={(e) => setFbOrderId(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs">
                      <option value="">Optional Order</option>
                      {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber}</option>)}
                    </select>
                  </div>
                  <input type="text" required value={fbSubject} onChange={(e) => setFbSubject(e.target.value)} placeholder="Subject" className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                  <textarea rows={3} required value={fbMessage} onChange={(e) => setFbMessage(e.target.value)} placeholder="Describe your inquiry or feedback..." className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                  <div className="flex items-center justify-between text-xs">
                    <span>Rating:</span>
                    <select value={fbRating} onChange={(e) => setFbRating(Number(e.target.value))} className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1">
                      {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
                    </select>
                  </div>
                  <button type="submit" className="w-full min-h-[40px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white py-2 text-xs font-medium">Submit to Support</button>

                  {feedback.length > 0 && (
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                      <p className="font-semibold text-slate-500">Previous Submissions</p>
                      {feedback.map((f) => (
                        <div key={f.id} className="p-2.5 rounded-lg bg-[#F5F8FC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                          <p className="font-medium">{f.subject} · <span className="capitalize">{f.status}</span></p>
                          <p className="text-slate-500">{f.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </form>
              </div>

              {/* Financial Receipts Ledger */}
              <div className="space-y-3">
                <SearchFilterSortBar
                  search={txSearch}
                  onSearchChange={setTxSearch}
                  searchPlaceholder="Search financial receipts by TX # or Order #..."
                  filters={[
                    {
                      label: 'Receipt status filter',
                      value: txStatusFilter,
                      onChange: setTxStatusFilter,
                      options: [
                        { label: 'All Receipt Statuses', value: 'all' },
                        { label: 'Completed', value: 'completed' },
                        { label: 'Pending', value: 'pending' },
                        { label: 'Refunded', value: 'refunded' },
                      ],
                    },
                  ]}
                  sortDir={txSortDir}
                  onToggleSortDir={() => setTxSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                  resultCount={filteredTransactions.length}
                />

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
                  <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 text-sm font-semibold text-[#15243A] dark:text-slate-100">
                    My Financial Transaction Receipts
                  </div>
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-200 dark:border-slate-800 bg-[#EAF4FF] dark:bg-slate-950 text-[#082B59] dark:text-slate-300">
                      <tr>
                        <th className="px-4 py-2.5 font-semibold">Receipt #</th>
                        <th className="px-4 py-2.5 font-semibold">Order #</th>
                        <th className="px-4 py-2.5 font-semibold">Method</th>
                        <th className="px-4 py-2.5 font-semibold">Amount</th>
                        <th className="px-4 py-2.5 font-semibold">Status</th>
                        <th className="px-4 py-2.5 font-semibold text-right">Document</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {filteredTransactions.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-4 py-6 text-center text-slate-500">No transaction receipts recorded yet.</td>
                        </tr>
                      ) : (
                        filteredTransactions.map((tx) => (
                          <tr key={tx.id} className="hover:bg-[#F5F8FC] dark:hover:bg-slate-800/40">
                            <td className="px-4 py-2.5 font-mono font-semibold">{tx.txNumber}</td>
                            <td className="px-4 py-2.5 font-mono">{tx.orderNumber || '—'}</td>
                            <td className="px-4 py-2.5 capitalize">{tx.method.replace('_', ' ')}</td>
                            <td className="px-4 py-2.5 tabular-nums font-semibold">{tx.currency} {tx.amount.toFixed(2)}</td>
                            <td className="px-4 py-2.5 capitalize">{tx.status}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                type="button"
                                onClick={() => setPreviewReceiptTx(tx)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF]"
                              >
                                <Eye className="w-3.5 h-3.5 text-[#1178B9]" /> View / Print
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {tab === 'support' && <MessagingCenter mode="customer_support" />}
          {tab === 'community' && <MessagingCenter mode="customer_community" />}
          {tab === 'meetings' && (
            <MeetingsHub
              employees={[]}
              departments={[]}
              activeMeeting={activeMeeting}
              setActiveMeeting={setActiveMeeting}
            />
          )}
          {tab === 'account' && <SyncAndSecurityCenter />}
        </main>

        <footer className="hidden lg:block bg-[#293858] text-[#EAF4FF]/80 px-6 py-3 text-xs border-t border-white/10">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <span>Seven Sunday Connect — Customer Portal</span>
            <span>Real-Time Order, Support & Conferencing Suite</span>
          </div>
        </footer>
      </div>

      {/* Mobile Bottom Navigation Bar (Android & iPhone thumb ergonomics) */}
      <nav
        aria-label="Mobile customer navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 pb-safe bg-[#082B59] text-white border-t border-white/15 grid grid-cols-5"
      >
        {navItems.slice(0, 5).map(({ id, shortLabel, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
              tab === id ? 'text-white bg-[#1178B9]' : 'text-[#EAF4FF]/75'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span>{shortLabel}</span>
          </button>
        ))}
      </nav>

      {/* Printable Invoice Modal */}
      <DocumentPreviewModal
        open={Boolean(previewInvoiceOrder)}
        title={`Official Invoice ${previewInvoiceOrder?.invoiceNumber || ''}`}
        subtitle={previewInvoiceOrder ? `Order ${previewInvoiceOrder.orderNumber} · ${new Date(previewInvoiceOrder.createdAt).toLocaleString()}` : ''}
        badge={previewInvoiceOrder?.status.toUpperCase()}
        onClose={() => setPreviewInvoiceOrder(null)}
        onDownload={() => previewInvoiceOrder && downloadOrderInvoicePDF(previewInvoiceOrder)}
        downloadLabel="Download Invoice PDF"
        onAdd={
          previewInvoiceOrder
            ? () => {
                const nextCart: Record<string, number> = { ...cart };
                previewInvoiceOrder.items.forEach((it) => {
                  nextCart[it.productId] = (nextCart[it.productId] || 0) + it.quantity;
                });
                setCart(nextCart);
                setPreviewInvoiceOrder(null);
                setTab('catalog');
                setNotice(`Added items from ${previewInvoiceOrder.orderNumber} back to your order builder.`);
              }
            : undefined
        }
        addLabel="Reorder Items"
        onRemove={
          previewInvoiceOrder && (previewInvoiceOrder.status === 'pending' || previewInvoiceOrder.status === 'confirmed')
            ? () => handleCancelOrder(previewInvoiceOrder)
            : undefined
        }
        removeLabel="Cancel Order"
      >
        {previewInvoiceOrder && (
          <div className="space-y-4">
            <div className="text-xs space-y-1">
              <p><strong>Billed To:</strong> {previewInvoiceOrder.customerName} ({previewInvoiceOrder.customerEmail})</p>
              {previewInvoiceOrder.shippingAddress && <p><strong>Delivery Address:</strong> {previewInvoiceOrder.shippingAddress}</p>}
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
                {previewInvoiceOrder.items.map((item) => (
                  <tr key={item.productId}>
                    <td className="p-2">{item.name}</td>
                    <td className="p-2 font-mono">{item.sku}</td>
                    <td className="p-2 tabular-nums">{item.quantity}</td>
                    <td className="p-2 text-right tabular-nums">{previewInvoiceOrder.currency} {(item.quantity * item.unitPrice).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="text-right font-bold text-sm text-[#082B59] dark:text-[#EAF4FF] tabular-nums">
              Total: {previewInvoiceOrder.currency} {previewInvoiceOrder.total.toFixed(2)}
            </div>
          </div>
        )}
      </DocumentPreviewModal>

      {/* Printable Financial Receipt Modal */}
      <DocumentPreviewModal
        open={Boolean(previewReceiptTx)}
        title={`Transaction Receipt ${previewReceiptTx?.txNumber || ''}`}
        subtitle={previewReceiptTx ? `Recorded ${new Date(previewReceiptTx.createdAt).toLocaleString()}` : ''}
        badge={previewReceiptTx?.status.toUpperCase()}
        onClose={() => setPreviewReceiptTx(null)}
        onDownload={() => previewReceiptTx && downloadFinancialReceiptPDF(previewReceiptTx)}
        downloadLabel="Download Receipt PDF"
      >
        {previewReceiptTx && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-2 gap-3 rounded-lg bg-[#F5F8FC] dark:bg-slate-800 p-4 border border-slate-200 dark:border-slate-700">
              <div><strong>Transaction #:</strong> {previewReceiptTx.txNumber}</div>
              <div><strong>Order #:</strong> {previewReceiptTx.orderNumber || '—'}</div>
              <div><strong>Method:</strong> {previewReceiptTx.method.replace('_', ' ')}</div>
              <div><strong>Amount:</strong> {previewReceiptTx.currency} {previewReceiptTx.amount.toFixed(2)}</div>
              <div><strong>Status:</strong> {previewReceiptTx.status}</div>
              <div><strong>Date:</strong> {new Date(previewReceiptTx.createdAt).toLocaleDateString()}</div>
            </div>
            {previewReceiptTx.notes && <p><strong>Notes:</strong> {previewReceiptTx.notes}</p>}
          </div>
        )}
      </DocumentPreviewModal>
    </div>
  );
};
