import React, { useEffect, useMemo, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, onSnapshot, query, setDoc, updateDoc, where } from 'firebase/firestore';
import {
  ArrowRight,
  Bell,
  CheckCircle2,
  ClipboardList,
  Eye,
  Grid,
  HelpCircle,
  Home,
  LogOut,
  MapPin,
  Menu,
  MessageSquare,
  Minus,
  Package,
  Phone,
  Plus,
  Search,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  Truck,
  User,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useDirectCall } from '../../context/DirectCallContext';
import { useTheme } from '../../context/ThemeContext';
import { useWebSocket } from '../../context/WebSocketContext';
import { downloadFinancialReceiptPDF, downloadOrderInvoicePDF, ORDER_STATUS_LABELS } from '../../lib/exportUtils';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import {
  logAuditEvent,
  placeOrderWithTransaction,
  saveCustomerDeliveryAddress,
  savePersistentCart,
  triggerLocalDeviceNotification,
} from '../../lib/firestoreActions';
import {
  AvailabilityStatus,
  CustomerFeedback,
  CustomerOrder,
  DeliveryAddress,
  FinancialTransaction,
  Meeting,
  NotificationItem,
  OrderItem,
  Product,
  ProductCategory,
  ShoppingCartItem,
} from '../../types/domain';
import { DirectCallPanel } from '../calls/DirectCallPanel';
import { MessagingCenter } from '../chat/MessagingCenter';
import { MeetingsHub } from '../meetings/MeetingsHub';
import { DocumentPreviewModal } from '../shared/DocumentPreviewModal';
import { PWAInstallButton } from '../shared/PWAComponents';
import { SearchFilterSortBar } from '../shared/SearchFilterSortBar';
import { SyncAndSecurityCenter } from '../shared/SyncAndSecurityCenter';
import { OrderTracking } from './OrderTracking';
import { ProductDetailModal } from './ProductDetailModal';

type CustomerTab =
  | 'home'
  | 'products'
  | 'categories'
  | 'cart'
  | 'orders'
  | 'tracking'
  | 'audio_call'
  | 'video_call'
  | 'messages'
  | 'notifications'
  | 'profile'
  | 'support'
  | 'community'
  | 'meetings'
  | 'security';

export const CustomerPortal: React.FC = () => {
  const { profile, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { connected: wsConnected, subscribe: wsSubscribe } = useWebSocket();
  const { phase: callPhase, startCall } = useDirectCall();

  const [tab, setTab] = useState<CustomerTab>('home');
  const [mobileMenu, setMobileMenu] = useState(false);
  const [selectedConvId, setSelectedConvId] = useState<string | null>(null);
  const [liveProductAlert, setLiveProductAlert] = useState<{
    productId?: string;
    name: string;
    sku: string;
    priceLabel?: string;
    publisherName?: string;
  } | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [cartItemsState, setCartItemsState] = useState<ShoppingCartItem[]>([]);
  const [savedAddresses, setSavedAddresses] = useState<DeliveryAddress[]>([]);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [feedback, setFeedback] = useState<CustomerFeedback[]>([]);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [showDemoData, setShowDemoData] = useState(false);
  const [showNotificationsPopover, setShowNotificationsPopover] = useState(false);

  // Catalog filters & modal
  const [catFilter, setCatFilter] = useState('all');
  const [availFilter, setAvailFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [prodSort, setProdSort] = useState<'name' | 'price_asc' | 'price_desc'>('name');
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [cardQuantities, setCardQuantities] = useState<Record<string, number>>({});

  // Checkout state
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [shippingAddress, setShippingAddress] = useState('');
  const [deliveryCity, setDeliveryCity] = useState('Addis Ababa');
  const [customerPhone, setCustomerPhone] = useState(profile?.phone || '');
  const [orderNotes, setOrderNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<FinancialTransaction['method']>('bank_transfer');
  const [orderConfirmation, setOrderConfirmation] = useState<{
    orderId: string;
    orderNumber: string;
    invoiceNumber: string;
    txNumber: string;
    total: number;
    currency: string;
  } | null>(null);

  // Order & Tracking state
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [orderSortBy, setOrderSortBy] = useState<'createdAt' | 'total'>('createdAt');
  const [orderSortDir, setOrderSortDir] = useState<'asc' | 'desc'>('desc');
  const [trackedOrderId, setTrackedOrderId] = useState<string>('');

  const [txSearch, setTxSearch] = useState('');
  const [txStatusFilter, setTxStatusFilter] = useState('all');
  const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('desc');

  const [previewInvoiceOrder, setPreviewInvoiceOrder] = useState<CustomerOrder | null>(null);
  const [previewReceiptTx, setPreviewReceiptTx] = useState<FinancialTransaction | null>(null);
  const [activeMeeting, setActiveMeeting] = useState<Meeting | null>(null);

  // Notifications filter
  const [notifFilter, setNotifFilter] = useState<'all' | 'product' | 'order' | 'call' | 'message' | 'support'>('all');

  // Profile & Address forms
  const [profName, setProfName] = useState(profile?.fullName || '');
  const [profPhone, setProfPhone] = useState(profile?.phone || '');
  const [profAvail, setProfAvail] = useState<AvailabilityStatus>(profile?.availability || 'available');
  const [addrLabel, setAddrLabel] = useState('Office / Warehouse');
  const [addrRecipient, setAddrRecipient] = useState(profile?.fullName || '');
  const [addrPhone, setAddrPhone] = useState(profile?.phone || '');
  const [addrCity, setAddrCity] = useState('Addis Ababa');
  const [addrSubCity, setAddrSubCity] = useState('');
  const [addrStreet, setAddrStreet] = useState('');
  const [addrNotes, setAddrNotes] = useState('');
  const [addrDefault, setAddrDefault] = useState(true);

  // Feedback form
  const [fbType, setFbType] = useState<CustomerFeedback['type']>('inquiry');
  const [fbSubject, setFbSubject] = useState('');
  const [fbMessage, setFbMessage] = useState('');
  const [fbRating, setFbRating] = useState(5);
  const [fbOrderId, setFbOrderId] = useState('');

  const [notice, setNotice] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submittingOrder, setSubmittingOrder] = useState(false);

  // Contact for Price inquiry modal
  const [priceInquiryProduct, setPriceInquiryProduct] = useState<Product | null>(null);
  const [priceInquiryQty, setPriceInquiryQty] = useState(1);
  const [priceInquiryPhone, setPriceInquiryPhone] = useState('');
  const [priceInquiryNote, setPriceInquiryNote] = useState('');
  const [sendingPriceInquiry, setSendingPriceInquiry] = useState(false);

  useEffect(() => {
    if (profile) {
      setProfName(profile.fullName || '');
      setProfPhone(profile.phone || '');
      setProfAvail(profile.availability || 'available');
      if (!customerPhone && profile.phone) setCustomerPhone(profile.phone);
      if (!addrRecipient) setAddrRecipient(profile.fullName || '');
      if (!addrPhone && profile.phone) setAddrPhone(profile.phone);
    }
  }, [profile?.uid, profile?.fullName, profile?.phone]);

  useEffect(() => {
    if (!profile) return;
    const unsubProd = onSnapshot(
      query(collection(db, 'products'), where('active', '==', true)),
      (snap) => setProducts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Product, 'id'>) }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'products')
    );
    const unsubCats = onSnapshot(
      query(collection(db, 'productCategories'), where('active', '==', true)),
      (snap) =>
        setCategories(
          snap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<ProductCategory, 'id'>) }))
            .sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.name.localeCompare(b.name))
        ),
      () => {}
    );
    const unsubCart = onSnapshot(
      doc(db, 'shoppingCarts', profile.uid),
      (snap) => {
        if (snap.exists()) {
          const items = (snap.data().items || []) as ShoppingCartItem[];
          setCartItemsState(items);
        } else {
          setCartItemsState([]);
        }
      },
      () => {}
    );
    const unsubAddr = onSnapshot(
      query(collection(db, 'deliveryAddresses'), where('customerUid', '==', profile.uid)),
      (snap) => {
        const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryAddress, 'id'>) }));
        setSavedAddresses(list);
        const def = list.find((a) => a.isDefault) || list[0];
        if (def && !shippingAddress) {
          setSelectedAddressId(def.id);
          setShippingAddress(def.streetAddress + (def.subCity ? `, ${def.subCity}` : ''));
          setDeliveryCity(def.city);
          setCustomerPhone(def.phone);
        }
      },
      () => {}
    );
    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), where('customerUid', '==', profile.uid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerOrder, 'id'>) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setOrders(list);
        if (list.length > 0 && !trackedOrderId) setTrackedOrderId(list[0].id);
      },
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
      unsubCats();
      unsubCart();
      unsubAddr();
      unsubOrders();
      unsubTx();
      unsubFb();
      unsubNotif();
      unsubSettings();
    };
  }, [profile?.uid]);

  useEffect(() => {
    const unsubProductWs = wsSubscribe((event) => {
      if (event.type === 'product:published' && event.payload) {
        const p = event.payload as {
          productId?: string;
          name?: string;
          sku?: string;
          priceLabel?: string;
          publisherName?: string;
        };
        if (p.name) {
          setLiveProductAlert({
            productId: p.productId,
            name: p.name,
            sku: p.sku || '',
            priceLabel: p.priceLabel,
            publisherName: p.publisherName,
          });
          triggerLocalDeviceNotification(
            `New Product: ${p.name}`,
            `${p.sku ? `SKU ${p.sku} · ` : ''}${p.priceLabel || 'Available now in 7Sunday Ethiopia Catalog'}`
          );
        }
      }
    });
    return () => unsubProductWs();
  }, [wsSubscribe]);

  const activeCatalogProducts = useMemo(
    () => products.filter((p) => showDemoData || !p.isDemo),
    [products, showDemoData]
  );

  // Merge configured categories with category strings from active products
  const displayCategories = useMemo(() => {
    const visibleCats = categories.filter((c) => showDemoData || !c.isDemo);
    const map = new Map<string, { name: string; description?: string; imageUrl?: string; count: number }>();
    visibleCats.forEach((c) => {
      map.set(c.name.toLowerCase(), {
        name: c.name,
        description: c.description,
        imageUrl: c.imageUrl,
        count: 0,
      });
    });
    activeCatalogProducts.forEach((p) => {
      const key = (p.category || 'General').toLowerCase();
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
        if (!existing.imageUrl && p.imageUrl) existing.imageUrl = p.imageUrl;
      } else {
        map.set(key, { name: p.category || 'General', imageUrl: p.imageUrl, count: 1 });
      }
    });
    return Array.from(map.values());
  }, [categories, activeCatalogProducts, showDemoData]);

  const categoryNames = useMemo(
    () => ['all', ...displayCategories.map((c) => c.name)],
    [displayCategories]
  );

  const visibleProducts = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return activeCatalogProducts
      .filter((p) => {
        if (catFilter !== 'all' && p.category.toLowerCase() !== catFilter.toLowerCase()) return false;
        const avail = p.availabilityStatus || (p.stock <= 0 ? 'out_of_stock' : p.stock <= 5 ? 'low_stock' : 'in_stock');
        if (availFilter !== 'all' && avail !== availFilter) return false;
        if (
          term &&
          !p.name.toLowerCase().includes(term) &&
          !p.sku.toLowerCase().includes(term) &&
          !(p.description || '').toLowerCase().includes(term)
        ) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        if (prodSort === 'price_asc') return (a.price ?? 0) - (b.price ?? 0);
        if (prodSort === 'price_desc') return (b.price ?? 0) - (a.price ?? 0);
        return a.name.localeCompare(b.name);
      });
  }, [activeCatalogProducts, catFilter, availFilter, searchTerm, prodSort]);

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

  const filteredNotifications = useMemo(() => {
    return notifications.filter((n) => (notifFilter === 'all' ? true : n.type === notifFilter));
  }, [notifications, notifFilter]);

  const cartOrderItems = useMemo<OrderItem[]>(() => {
    return cartItemsState.map((c) => {
      const liveProd = activeCatalogProducts.find((p) => p.id === c.productId);
      const unit = liveProd?.unit || c.unit;
      const imageUrl = liveProd?.imageUrl || c.imageUrl;
      return {
        productId: c.productId,
        name: liveProd?.name || c.name || 'Product',
        sku: liveProd?.sku || c.sku || c.productId,
        quantity: c.quantity,
        unitPrice: liveProd?.price ?? c.unitPrice ?? 0,
        ...(unit ? { unit } : {}),
        ...(imageUrl ? { imageUrl } : {}),
      };
    });
  }, [cartItemsState, activeCatalogProducts]);

  const cartCount = useMemo(() => cartItemsState.reduce((s, i) => s + i.quantity, 0), [cartItemsState]);
  const cartSubtotal = useMemo(() => cartOrderItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0), [cartOrderItems]);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const persistCart = async (nextItems: ShoppingCartItem[]) => {
    setCartItemsState(nextItems);
    if (!profile) return;
    try {
      await savePersistentCart(profile.uid, nextItems);
    } catch {
      // ignore offline sync delay
    }
  };

  const openPriceInquiry = (product: Product, quantity = 1) => {
    const qtyVal = Math.max(1, Math.floor(quantity));
    setPriceInquiryProduct(product);
    setPriceInquiryQty(qtyVal);
    setPriceInquiryPhone(profile?.phone || customerPhone || '');
    setPriceInquiryNote(
      `Please share pricing and availability for ${qtyVal} ${product.unit || 'unit'}(s) of ${product.name} (SKU: ${product.sku}).`
    );
  };

  const handleSubmitPriceInquiry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !priceInquiryProduct || !priceInquiryNote.trim()) return;
    setSendingPriceInquiry(true);
    setFormError(null);
    try {
      const now = new Date().toISOString();
      await addDoc(collection(db, 'customerFeedback'), {
        customerUid: profile.uid,
        customerName: profile.fullName,
        type: 'inquiry',
        subject: `Price Request: ${priceInquiryProduct.name} (${priceInquiryProduct.sku})`,
        message: `${priceInquiryNote.trim()}${priceInquiryPhone.trim() ? `\nContact Phone: ${priceInquiryPhone.trim()}` : ''}`,
        status: 'open',
        isDemo: false,
        createdAt: now,
        updatedAt: now,
      });
      await logAuditEvent(
        profile,
        'PRICE_INQUIRY_SUBMITTED',
        'product',
        priceInquiryProduct.id,
        `Requested quote for ${priceInquiryQty}x ${priceInquiryProduct.name} (${priceInquiryProduct.sku})`
      );
      setNotice(`Price inquiry submitted for ${priceInquiryProduct.name}. Our sales team will reply shortly.`);
      setPriceInquiryProduct(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to send price inquiry.');
    } finally {
      setSendingPriceInquiry(false);
    }
  };

  const addProductToCart = async (product: Product, quantity = 1) => {
    if (product.contactForPrice) {
      openPriceInquiry(product, quantity);
      return;
    }
    const qtyToAdd = Math.max(1, Math.floor(quantity));
    const existing = cartItemsState.find((i) => i.productId === product.id);
    const nextQty = (existing?.quantity || 0) + qtyToAdd;
    const item: ShoppingCartItem = {
      productId: product.id,
      name: product.name,
      sku: product.sku,
      unitPrice: product.price ?? 0,
      currency: product.currency,
      ...(product.unit ? { unit: product.unit } : {}),
      ...(product.imageUrl ? { imageUrl: product.imageUrl } : {}),
      quantity: nextQty,
      addedAt: existing?.addedAt || new Date().toISOString(),
    };
    const nextItems = existing
      ? cartItemsState.map((i) => (i.productId === product.id ? item : i))
      : [...cartItemsState, item];
    await persistCart(nextItems);
    setNotice(`Added ${qtyToAdd} × ${product.name} to your Shopping Cart.`);
  };

  const updateCartItemQty = async (productId: string, delta: number) => {
    const nextItems = cartItemsState
      .map((i) => (i.productId === productId ? { ...i, quantity: i.quantity + delta } : i))
      .filter((i) => i.quantity > 0);
    await persistCart(nextItems);
  };

  const removeCartItem = async (productId: string) => {
    await persistCart(cartItemsState.filter((i) => i.productId !== productId));
  };

  const placeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!profile || cartOrderItems.length === 0) return;
    if (shippingAddress.trim().length < 4) {
      setFormError('Please enter a complete delivery street address.');
      return;
    }
    if (customerPhone.trim().length < 6) {
      setFormError('Please enter a valid contact phone number for delivery coordination.');
      return;
    }
    setSubmittingOrder(true);
    try {
      const currency = cartItemsState[0]?.currency || activeCatalogProducts[0]?.currency || 'ETB';
      const res = await placeOrderWithTransaction({
        customer: profile,
        items: cartOrderItems,
        total: cartSubtotal,
        currency,
        shippingAddress: shippingAddress.trim(),
        customerPhone: customerPhone.trim(),
        deliveryCity: deliveryCity.trim() || undefined,
        notes: orderNotes.trim() || undefined,
        paymentMethod,
      });
      setCartItemsState([]);
      setOrderNotes('');
      setOrderConfirmation({
        ...res,
        total: cartSubtotal,
        currency,
      });
      setTrackedOrderId(res.orderId);
      setNotice(`Order ${res.orderNumber} submitted cleanly! Invoice ${res.invoiceNumber} is ready.`);
      setTab('orders');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to submit order.');
    } finally {
      setSubmittingOrder(false);
    }
  };

  const handleCancelOrder = async (o: CustomerOrder) => {
    if (!profile) return;
    const now = new Date().toISOString();
    const nextHistory = [
      ...(o.statusHistory || []),
      { status: 'cancelled' as const, timestamp: now, actorUid: profile.uid, note: 'Cancelled by customer' },
    ];
    await updateDoc(doc(db, 'orders', o.id), {
      status: 'cancelled',
      statusHistory: nextHistory,
      updatedAt: now,
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
    setNotice('Your inquiry has been submitted to Seven Sunday Customer Support.');
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !profName.trim()) return;
    setFormError(null);
    try {
      const now = new Date().toISOString();
      await updateDoc(doc(db, 'users', profile.uid), {
        fullName: profName.trim().slice(0, 120),
        phone: profPhone.trim().slice(0, 40),
        availability: profAvail,
        updatedAt: now,
      });
      await setDoc(
        doc(db, 'customerDirectory', profile.uid),
        {
          uid: profile.uid,
          displayName: profName.trim().slice(0, 120),
          availability: profAvail,
          updatedAt: now,
        },
        { merge: true }
      );
      setNotice('Customer profile updated.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save profile.');
    }
  };

  const handleAddDeliveryAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !addrStreet.trim() || !addrPhone.trim() || !addrCity.trim()) return;
    setFormError(null);
    try {
      await saveCustomerDeliveryAddress(
        profile.uid,
        {
          label: addrLabel.trim() || 'Delivery Address',
          recipientName: addrRecipient.trim() || profile.fullName,
          phone: addrPhone.trim(),
          city: addrCity.trim(),
          subCity: addrSubCity.trim() || undefined,
          streetAddress: addrStreet.trim(),
          notes: addrNotes.trim() || undefined,
          isDefault: addrDefault,
        },
        savedAddresses
      );
      setAddrStreet('');
      setAddrSubCity('');
      setAddrNotes('');
      setNotice('Delivery address saved.');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save address.');
    }
  };

  const navItems: Array<{
    id: CustomerTab;
    label: string;
    shortLabel: string;
    Icon: React.ElementType;
    badge?: number;
  }> = [
    { id: 'home', label: 'Home', shortLabel: 'Home', Icon: Home },
    { id: 'products', label: 'All Products', shortLabel: 'Products', Icon: ShoppingBag },
    { id: 'categories', label: 'Product Categories', shortLabel: 'Categories', Icon: Grid },
    { id: 'cart', label: 'Shopping Cart', shortLabel: 'Cart', Icon: ShoppingCart, badge: cartCount || undefined },
    { id: 'orders', label: 'My Orders', shortLabel: 'Orders', Icon: Package },
    { id: 'tracking', label: 'Order Tracking', shortLabel: 'Tracking', Icon: Truck },
    { id: 'audio_call', label: 'Audio Call', shortLabel: 'Audio', Icon: Phone },
    { id: 'video_call', label: 'Video Call', shortLabel: 'Video', Icon: Video },
    { id: 'messages', label: 'Messages', shortLabel: 'Messages', Icon: MessageSquare },
    { id: 'notifications', label: 'Notifications', shortLabel: 'Alerts', Icon: Bell, badge: unreadCount || undefined },
    { id: 'profile', label: 'My Profile', shortLabel: 'Profile', Icon: User },
    { id: 'support', label: 'Help and Support', shortLabel: 'Support', Icon: HelpCircle },
    { id: 'community', label: 'Customer Community', shortLabel: 'Community', Icon: Users },
    { id: 'meetings', label: 'Invited Meetings', shortLabel: 'Meetings', Icon: ClipboardList },
    { id: 'security', label: 'Sync & Security', shortLabel: 'Security', Icon: Shield },
  ];

  const openSupportConversation = async (subject: string, orderId?: string) => {
    if (!profile) return;
    const now = new Date().toISOString();
    const convRef = await addDoc(collection(db, 'conversations'), {
      type: 'support',
      scope: 'support',
      name: subject.slice(0, 120),
      ...(orderId ? { orderId } : {}),
      createdBy: profile.uid,
      memberUids: [profile.uid],
      adminUids: [profile.uid],
      lastMessageText: subject,
      lastMessageAt: now,
      createdAt: now,
      updatedAt: now,
    });
    await setDoc(doc(db, 'conversations', convRef.id, 'members', profile.uid), {
      uid: profile.uid,
      displayName: profile.fullName,
      role: 'admin',
      joinedAt: now,
    });
    setSelectedConvId(convRef.id);
    setTab('messages');
  };

  const handleNotificationClick = async (n: NotificationItem) => {
    if (!n.read) {
      updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {});
    }
    if (n.type === 'product' || n.linkTab === 'products') {
      setTab('products');
      if (n.linkId) {
        const matched = activeCatalogProducts.find((p) => p.id === n.linkId);
        if (matched) setDetailProduct(matched);
      }
    } else if (n.type === 'order') {
      if (n.linkId) setTrackedOrderId(n.linkId);
      setTab('tracking');
    } else if (n.type === 'call') {
      setTab('audio_call');
    } else if (n.type === 'message' || n.type === 'support') {
      setTab('messages');
    } else if (n.linkTab === 'meetings') {
      setTab('meetings');
    }
    setShowNotificationsPopover(false);
  };

  return (
    <div className="min-h-screen bg-[#F5F8FC] dark:bg-slate-950 text-[#293858] dark:text-slate-100 flex">
      {/* Customer Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-white/10 bg-[#082B59] text-white flex flex-col justify-between transition-transform lg:static lg:translate-x-0 ${
          mobileMenu ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex flex-col min-h-0 flex-1">
          <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <img
                src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
                alt="7Sunday Ethiopia"
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full bg-white object-contain p-0.5"
              />
              <div>
                <span className="font-display font-bold text-sm block leading-tight">7Sunday Ethiopia</span>
                <span className="text-[10px] text-[#EAF4FF]/70 block">Customer Portal</span>
              </div>
            </div>
            <button type="button" onClick={() => setMobileMenu(false)} className="lg:hidden min-h-[40px] min-w-[40px] inline-flex items-center justify-center">
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="p-2.5 space-y-0.5 overflow-y-auto flex-1">
            {navItems.map(({ id, label, Icon, badge }, idx) => (
              <React.Fragment key={id}>
                {idx === 12 && <div className="my-2 border-t border-white/10" />}
                <button
                  type="button"
                  onClick={() => {
                    setTab(id);
                    setMobileMenu(false);
                  }}
                  className={`w-full min-h-[40px] flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${
                    tab === id
                      ? 'bg-[#1178B9] text-white'
                      : 'text-[#EAF4FF]/85 hover:bg-white/10'
                  }`}
                >
                  <span className="flex items-center gap-2.5 truncate">
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="truncate">{label}</span>
                  </span>
                  {badge !== undefined && badge > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-white text-[#082B59] text-[10px] font-bold tabular-nums">
                      {badge}
                    </span>
                  )}
                </button>
              </React.Fragment>
            ))}
          </nav>
        </div>

        <div className="p-4 border-t border-white/10 text-xs bg-[#293858] shrink-0">
          <p className="font-semibold truncate text-white">{profile?.fullName}</p>
          <p className="text-[#EAF4FF]/75 truncate">
            {wsConnected ? 'Live Sync Active' : 'Connecting...'}
          </p>
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
              7Sunday Ethiopia / {navItems.find((i) => i.id === tab)?.label}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton compact />

            <button
              type="button"
              onClick={() => setTab('cart')}
              aria-label="Open Shopping Cart"
              className="relative min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-xs font-medium"
            >
              <ShoppingCart className="w-4 h-4 text-[#1178B9]" />
              <span className="hidden sm:inline">Cart</span>
              {cartCount > 0 && (
                <span className="px-1.5 py-0.5 rounded bg-[#1178B9] text-white text-[10px] font-bold tabular-nums">
                  {cartCount}
                </span>
              )}
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={() => setShowNotificationsPopover(!showNotificationsPopover)}
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
              {showNotificationsPopover && (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl z-50 p-4 space-y-2 max-h-96 overflow-y-auto">
                  <div className="flex items-center justify-between text-xs font-semibold">
                    <span>Notifications ({unreadCount} unread)</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setShowNotificationsPopover(false);
                          setTab('notifications');
                        }}
                        className="text-[#1178B9] hover:underline"
                      >
                        View All
                      </button>
                      <button type="button" onClick={() => setShowNotificationsPopover(false)}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  {notifications.length === 0 ? (
                    <p className="text-xs text-slate-500 py-4 text-center">No notifications yet.</p>
                  ) : (
                    notifications.slice(0, 8).map((n) => (
                      <div
                        key={n.id}
                        onClick={() => handleNotificationClick(n)}
                        className={`p-2.5 rounded-lg border text-xs cursor-pointer ${
                          n.read
                            ? 'border-slate-100 dark:border-slate-800 opacity-70'
                            : 'border-[#1178B9]/30 bg-[#EAF4FF] dark:bg-[#082B59]/40'
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
              className="min-h-[40px] px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-medium whitespace-nowrap shrink-0"
            >
              {theme === 'dark' ? 'Light' : 'Dark'}
            </button>
            <button
              type="button"
              onClick={logout}
              aria-label="Log Out"
              className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 dark:hover:bg-red-950/50 text-xs font-medium text-red-700 dark:text-red-300 transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Log Out</span>
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
          {liveProductAlert && (
            <div
              role="status"
              className="rounded-xl border border-[#1178B9]/40 bg-[#EAF4FF] dark:bg-[#082B59]/60 p-3.5 text-xs text-[#082B59] dark:text-[#EAF4FF] flex flex-wrap items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2.5">
                <Bell className="w-4 h-4 text-[#1178B9] shrink-0" />
                <div>
                  <span className="font-bold">New Product Posted: {liveProductAlert.name}</span>
                  {liveProductAlert.sku && <span className="ml-1.5 font-mono">({liveProductAlert.sku})</span>}
                  {liveProductAlert.priceLabel && <span className="ml-1.5">· {liveProductAlert.priceLabel}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setTab('products');
                    if (liveProductAlert.productId) {
                      const matched = activeCatalogProducts.find((p) => p.id === liveProductAlert.productId);
                      if (matched) setDetailProduct(matched);
                    }
                    setLiveProductAlert(null);
                  }}
                  className="min-h-[34px] px-3 py-1 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white font-semibold"
                >
                  View Product
                </button>
                <button
                  type="button"
                  aria-label="Dismiss product alert"
                  onClick={() => setLiveProductAlert(null)}
                  className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center rounded-lg border border-[#1178B9]/30 hover:bg-white/60 dark:hover:bg-slate-800"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* 1. HOME */}
          {tab === 'home' && (
            <div className="space-y-6">
              <div className="rounded-2xl bg-[#082B59] text-white p-6 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
                <div className="space-y-2 max-w-2xl">
                  <p className="text-xs uppercase tracking-wider text-[#EAF4FF]/75 font-semibold">
                    Seven Sunday Manufacturing & Trading PLC
                  </p>
                  <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
                    Welcome, {profile?.fullName}
                  </h1>
                  <p className="text-xs sm:text-sm text-[#EAF4FF]/85">
                    Browse industrial and commercial products, manage orders and delivery tracking, or connect live with customer care via voice, video, or messaging.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setTab('products')}
                    className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-semibold"
                  >
                    <ShoppingBag className="w-4 h-4" /> Browse All Products
                  </button>
                  <button
                    type="button"
                    disabled={callPhase !== 'idle'}
                    onClick={() => {
                      setTab('audio_call');
                      startCall({
                        targetUid: 'support_queue',
                        targetName: 'Seven Sunday Customer Service',
                        callType: 'audio',
                        targetQueue: true,
                      });
                    }}
                    className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/25 hover:bg-white/10 text-white text-xs font-semibold"
                  >
                    <Phone className="w-4 h-4" /> Call Support
                  </button>
                  <button
                    type="button"
                    disabled={callPhase !== 'idle'}
                    onClick={() => {
                      setTab('video_call');
                      startCall({
                        targetUid: 'support_queue',
                        targetName: 'Seven Sunday Customer Service',
                        callType: 'video',
                        targetQueue: true,
                      });
                    }}
                    className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/25 hover:bg-white/10 text-white text-xs font-semibold"
                  >
                    <Video className="w-4 h-4" /> Video Call
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab('messages')}
                    className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-white/25 hover:bg-white/10 text-white text-xs font-semibold"
                  >
                    <MessageSquare className="w-4 h-4" /> Live Chat
                  </button>
                </div>
              </div>

              {/* KPI Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <button
                  type="button"
                  onClick={() => setTab('products')}
                  className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 hover:border-[#1178B9] transition-colors space-y-1"
                >
                  <p className="text-xs text-slate-500">Catalog Products</p>
                  <p className="text-2xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">{activeCatalogProducts.length}</p>
                  <p className="text-xs text-[#1178B9] font-medium">{displayCategories.length} categories</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('cart')}
                  className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 hover:border-[#1178B9] transition-colors space-y-1"
                >
                  <p className="text-xs text-slate-500">Shopping Cart</p>
                  <p className="text-2xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">{cartCount}</p>
                  <p className="text-xs text-slate-500 tabular-nums">ETB {cartSubtotal.toFixed(2)}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('orders')}
                  className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 hover:border-[#1178B9] transition-colors space-y-1"
                >
                  <p className="text-xs text-slate-500">My Orders</p>
                  <p className="text-2xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">{orders.length}</p>
                  <p className="text-xs text-slate-500 tabular-nums">
                    {orders.filter((o) => o.status !== 'delivered' && o.status !== 'cancelled').length} active
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setTab('notifications')}
                  className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 hover:border-[#1178B9] transition-colors space-y-1"
                >
                  <p className="text-xs text-slate-500">Unread Alerts</p>
                  <p className="text-2xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">{unreadCount}</p>
                  <p className="text-xs text-slate-500">Orders, calls & chat</p>
                </button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Latest Order Quick Status */}
                <div className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Latest Order Status</h2>
                    <button type="button" onClick={() => setTab('tracking')} className="text-xs text-[#1178B9] font-medium hover:underline">
                      Track Orders
                    </button>
                  </div>
                  {orders.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-500 space-y-2">
                      <p>You have not placed any orders yet.</p>
                      <button
                        type="button"
                        onClick={() => setTab('products')}
                        className="px-3.5 py-2 rounded-lg bg-[#1178B9] text-white font-medium"
                      >
                        Start Shopping
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 text-xs">
                      {orders.slice(0, 3).map((o) => (
                        <div key={o.id} className="p-3 rounded-lg bg-[#F5F8FC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-2">
                          <div>
                            <p className="font-mono font-bold text-[#082B59] dark:text-[#EAF4FF]">{o.orderNumber}</p>
                            <p className="text-slate-500 tabular-nums">
                              {ORDER_STATUS_LABELS[o.status]} · {o.currency} {o.total.toFixed(2)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setTrackedOrderId(o.id);
                              setTab('tracking');
                            }}
                            className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-medium hover:bg-[#EAF4FF]"
                          >
                            Track
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Featured Products */}
                <div className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Featured Catalog Items</h2>
                    <button type="button" onClick={() => setTab('products')} className="text-xs text-[#1178B9] font-medium hover:underline">
                      View All
                    </button>
                  </div>
                  {activeCatalogProducts.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-500">No active products published yet.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {activeCatalogProducts.slice(0, 4).map((p) => (
                        <div key={p.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 flex items-center gap-3">
                          <img
                            src={p.imageUrl || '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png'}
                            alt={p.name}
                            referrerPolicy="no-referrer"
                            className="w-16 h-16 rounded-lg object-cover bg-[#F3F5F8] dark:bg-slate-800 shrink-0"
                          />
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="text-xs font-semibold truncate text-[#15243A] dark:text-slate-100">{p.name}</p>
                            <p className="text-xs font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">
                              {p.contactForPrice ? 'Contact for Price' : `${p.currency} ${(p.price ?? 0).toFixed(2)}`}
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setDetailProduct(p)}
                                className="text-[11px] font-medium text-[#1178B9] hover:underline"
                              >
                                View
                              </button>
                              {p.contactForPrice ? (
                                <button
                                  type="button"
                                  onClick={() => openPriceInquiry(p, 1)}
                                  className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#082B59] hover:bg-[#1178B9] text-white"
                                >
                                  Contact for Price
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={p.stock <= 0 && p.availabilityStatus !== 'preorder'}
                                  onClick={() => addProductToCart(p, 1)}
                                  className="text-[11px] font-medium px-2 py-0.5 rounded bg-[#1178B9] text-white disabled:opacity-40"
                                >
                                  + Cart
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 2. ALL PRODUCTS */}
          {tab === 'products' && (
            <div className="space-y-5">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search products by name, SKU, or specification..."
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 pl-9 pr-3 py-1.5 text-xs"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={catFilter}
                    onChange={(e) => setCatFilter(e.target.value)}
                    aria-label="Filter by product category"
                    className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-1.5 text-xs"
                  >
                    {categoryNames.map((c) => (
                      <option key={c} value={c}>{c === 'all' ? 'All Categories' : c}</option>
                    ))}
                  </select>
                  <select
                    value={availFilter}
                    onChange={(e) => setAvailFilter(e.target.value)}
                    aria-label="Filter by availability"
                    className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-1.5 text-xs"
                  >
                    <option value="all">All Availability</option>
                    <option value="in_stock">In Stock</option>
                    <option value="low_stock">Low Stock</option>
                    <option value="preorder">Pre-Order</option>
                  </select>
                  <select
                    value={prodSort}
                    onChange={(e) => setProdSort(e.target.value as typeof prodSort)}
                    aria-label="Sort products"
                    className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-1.5 text-xs"
                  >
                    <option value="name">Sort: Name (A-Z)</option>
                    <option value="price_asc">Price: Low to High</option>
                    <option value="price_desc">Price: High to Low</option>
                  </select>
                </div>
              </div>

              {visibleProducts.length === 0 ? (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-12 text-center text-xs text-slate-500 space-y-2">
                  <p>No active products match your search or category filter.</p>
                  {(catFilter !== 'all' || searchTerm || availFilter !== 'all') && (
                    <button
                      type="button"
                      onClick={() => {
                        setCatFilter('all');
                        setAvailFilter('all');
                        setSearchTerm('');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#1178B9] text-white font-medium"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                  {visibleProducts.map((p) => {
                    const q = cardQuantities[p.id] || 1;
                    const canBuy = p.availabilityStatus !== 'out_of_stock' && (p.stock > 0 || p.availabilityStatus === 'preorder');
                    return (
                      <div
                        key={p.id}
                        className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden flex flex-col justify-between shadow-sm hover:border-[#1178B9]/60 transition-colors"
                      >
                        <div>
                          <button
                            type="button"
                            onClick={() => setDetailProduct(p)}
                            className="w-full block relative group text-left"
                          >
                            <img
                              src={p.imageUrl || '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png'}
                              alt={p.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-48 object-cover bg-[#F3F5F8] dark:bg-slate-800"
                            />
                            {(p.galleryImages?.length || 0) > 0 && (
                              <span className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-[#082B59]/85 text-white text-[10px] font-medium">
                                +{p.galleryImages!.length} photos
                              </span>
                            )}
                          </button>

                          <div className="p-4 space-y-2">
                            <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                              <span className="font-mono truncate">{p.category} · {p.sku}</span>
                              <span className="tabular-nums shrink-0 font-medium">
                                {p.stock} {p.unit || 'units'}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() => setDetailProduct(p)}
                              className="text-left block w-full"
                            >
                              <h3 className="text-sm font-bold text-[#15243A] dark:text-slate-100 hover:text-[#1178B9]">
                                {p.name}
                              </h3>
                            </button>
                            {p.description && <p className="text-xs text-slate-500 line-clamp-2">{p.description}</p>}
                          </div>
                        </div>

                        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <div>
                              {p.contactForPrice ? (
                                <span className="inline-block px-2 py-0.5 rounded bg-[#EAF4FF] dark:bg-[#082B59]/50 text-xs font-bold text-[#082B59] dark:text-[#EAF4FF]">
                                  Contact for Price
                                </span>
                              ) : (
                                <>
                                  <span className="text-base font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">
                                    {p.currency} {(p.price ?? 0).toFixed(2)}
                                  </span>
                                  <span className="text-[11px] text-slate-400"> / {p.unit || 'Unit'}</span>
                                </>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setDetailProduct(p)}
                              className="text-xs font-medium text-[#1178B9] hover:underline"
                            >
                              Specs & Gallery
                            </button>
                          </div>

                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={1}
                              max={p.availabilityStatus === 'preorder' ? 999 : Math.max(1, p.stock)}
                              value={q}
                              onChange={(e) =>
                                setCardQuantities((prev) => ({
                                  ...prev,
                                  [p.id]: Math.max(1, Number(e.target.value) || 1),
                                }))
                              }
                              aria-label={`Quantity for ${p.name}`}
                              className="w-16 min-h-[38px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-2 text-center text-xs font-semibold tabular-nums"
                            />
                            {p.contactForPrice ? (
                              <button
                                type="button"
                                onClick={() => openPriceInquiry(p, q)}
                                className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#082B59] hover:bg-[#1178B9] text-white text-xs font-semibold"
                              >
                                <MessageSquare className="w-3.5 h-3.5" />
                                Contact for Price
                              </button>
                            ) : (
                              <button
                                type="button"
                                disabled={!canBuy}
                                onClick={() => addProductToCart(p, q)}
                                className="flex-1 min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white text-xs font-semibold"
                              >
                                <ShoppingCart className="w-3.5 h-3.5" />
                                {canBuy ? 'Add to Cart' : 'Out of Stock'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* 3. PRODUCT CATEGORIES */}
          {tab === 'categories' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-[#15243A] dark:text-slate-100">Product Categories</h2>
                  <p className="text-xs text-slate-500">Select a category to browse real-time Seven Sunday PLC products.</p>
                </div>
              </div>
              {displayCategories.length === 0 ? (
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center text-xs text-slate-500">
                  No product categories published yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {displayCategories.map((cat) => (
                    <button
                      key={cat.name}
                      type="button"
                      onClick={() => {
                        setCatFilter(cat.name);
                        setTab('products');
                      }}
                      className="text-left rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden hover:border-[#1178B9] transition-colors flex flex-col"
                    >
                      <div className="h-36 w-full bg-[#EAF4FF] dark:bg-slate-800 overflow-hidden">
                        <img
                          src={cat.imageUrl || '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png'}
                          alt={cat.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div className="p-4 flex-1 flex flex-col justify-between gap-2">
                        <div>
                          <h3 className="text-base font-bold text-[#15243A] dark:text-slate-100">{cat.name}</h3>
                          {cat.description && <p className="text-xs text-slate-500 line-clamp-2 mt-1">{cat.description}</p>}
                        </div>
                        <div className="flex items-center justify-between text-xs font-semibold text-[#1178B9] pt-2">
                          <span className="tabular-nums">{cat.count} products</span>
                          <span className="inline-flex items-center gap-1">Browse <ArrowRight className="w-3.5 h-3.5" /></span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 4. SHOPPING CART & CHECKOUT */}
          {tab === 'cart' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-7 space-y-4">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
                  <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[#15243A] dark:text-slate-100 flex items-center gap-2">
                      <ShoppingCart className="w-4 h-4 text-[#1178B9]" /> Shopping Cart ({cartCount} items)
                    </h2>
                    {cartOrderItems.length > 0 && (
                      <button
                        type="button"
                        onClick={() => persistCart([])}
                        className="text-xs text-red-600 hover:underline font-medium"
                      >
                        Clear Cart
                      </button>
                    )}
                  </div>

                  {cartOrderItems.length === 0 ? (
                    <div className="p-10 text-center space-y-3 text-xs text-slate-500">
                      <p>Your Shopping Cart is currently empty.</p>
                      <button
                        type="button"
                        onClick={() => setTab('products')}
                        className="px-4 py-2 rounded-lg bg-[#1178B9] text-white font-medium"
                      >
                        Browse All Products
                      </button>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {cartOrderItems.map((item) => (
                        <div key={item.productId} className="p-4 flex flex-wrap items-center justify-between gap-4 text-xs">
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <img
                              src={item.imageUrl || '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png'}
                              alt={item.name}
                              referrerPolicy="no-referrer"
                              className="w-14 h-14 rounded-lg object-cover bg-[#F3F5F8] dark:bg-slate-800 shrink-0"
                            />
                            <div className="min-w-0">
                              <p className="font-semibold text-sm text-[#15243A] dark:text-slate-100 truncate">{item.name}</p>
                              <p className="text-slate-500 font-mono">SKU {item.sku} · ETB {item.unitPrice.toFixed(2)} / {item.unit || 'Unit'}</p>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950">
                              <button
                                type="button"
                                aria-label={`Decrease quantity of ${item.name}`}
                                onClick={() => updateCartItemQty(item.productId, -1)}
                                className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center hover:bg-slate-200/60"
                              >
                                <Minus className="w-3.5 h-3.5" />
                              </button>
                              <span className="w-10 text-center font-semibold tabular-nums">{item.quantity}</span>
                              <button
                                type="button"
                                aria-label={`Increase quantity of ${item.name}`}
                                onClick={() => updateCartItemQty(item.productId, 1)}
                                className="min-h-[34px] min-w-[34px] inline-flex items-center justify-center hover:bg-slate-200/60"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                            </div>
                            <span className="w-24 text-right font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">
                              ETB {(item.quantity * item.unitPrice).toFixed(2)}
                            </span>
                            <button
                              type="button"
                              aria-label={`Remove ${item.name}`}
                              onClick={() => removeCartItem(item.productId)}
                              className="p-1.5 text-red-600 hover:bg-red-50 rounded"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <form onSubmit={placeOrder} className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 h-fit">
                <h3 className="text-sm font-bold text-[#15243A] dark:text-slate-100">Delivery & Order Submission</h3>

                {savedAddresses.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Saved Delivery Addresses</label>
                    <select
                      value={selectedAddressId}
                      onChange={(e) => {
                        setSelectedAddressId(e.target.value);
                        const found = savedAddresses.find((a) => a.id === e.target.value);
                        if (found) {
                          setShippingAddress(found.streetAddress + (found.subCity ? `, ${found.subCity}` : ''));
                          setDeliveryCity(found.city);
                          setCustomerPhone(found.phone);
                        }
                      }}
                      className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                    >
                      <option value="">Enter a custom address below</option>
                      {savedAddresses.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label} — {a.city}, {a.streetAddress}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Contact Phone Number *</label>
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="+251 9..."
                      className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-slate-500 mb-1">Delivery City *</label>
                    <input
                      type="text"
                      required
                      value={deliveryCity}
                      onChange={(e) => setDeliveryCity(e.target.value)}
                      placeholder="Addis Ababa"
                      className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Delivery Address *</label>
                  <input
                    type="text"
                    required
                    value={shippingAddress}
                    onChange={(e) => setShippingAddress(e.target.value)}
                    placeholder="Sub-city, Woreda, Street, Building / Warehouse"
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Payment Method</label>
                  <select
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value as FinancialTransaction['method'])}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                  >
                    <option value="bank_transfer">Bank Transfer (CBE / Awash / Dashen)</option>
                    <option value="mobile_money">Telebirr / Mobile Money</option>
                    <option value="card">Corporate / Debit Card</option>
                    <option value="cash_on_delivery">Cash on Delivery</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Order Notes</label>
                  <textarea
                    rows={2}
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Delivery window, loading dock instructions, or special specs..."
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-1.5 text-xs">
                  <div className="flex justify-between text-slate-500 tabular-nums">
                    <span>Subtotal</span>
                    <span>ETB {cartSubtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">
                    <span>Total</span>
                    <span>ETB {cartSubtotal.toFixed(2)}</span>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={cartOrderItems.length === 0 || submittingOrder}
                  className="w-full min-h-[44px] rounded-xl bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white py-2.5 text-xs font-semibold"
                >
                  {submittingOrder ? 'Submitting Order...' : 'Submit Order'}
                </button>
              </form>
            </div>
          )}

          {/* 5. MY ORDERS & FINANCIAL RECEIPTS */}
          {tab === 'orders' && (
            <div className="space-y-6">
              {orderConfirmation && (
                <div className="rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/30 p-4 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="w-6 h-6 text-emerald-600 shrink-0" />
                    <div>
                      <p className="font-bold text-sm text-emerald-900 dark:text-emerald-200">
                        Order Confirmed in Queue — {orderConfirmation.orderNumber}
                      </p>
                      <p className="text-emerald-800 dark:text-emerald-300 tabular-nums">
                        Invoice {orderConfirmation.invoiceNumber} · Receipt {orderConfirmation.txNumber} · Total{' '}
                        {orderConfirmation.currency} {orderConfirmation.total.toFixed(2)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setTrackedOrderId(orderConfirmation.orderId);
                        setTab('tracking');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-[#082B59] text-white font-medium"
                    >
                      Track Order
                    </button>
                    <button type="button" onClick={() => setOrderConfirmation(null)} className="p-1">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}

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
                      { label: 'Ready for Delivery', value: 'ready_for_delivery' },
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
                          <span className="text-[#1178B9] font-semibold">{ORDER_STATUS_LABELS[o.status]}</span>
                          {o.isDemo && (
                            <span className="px-1.5 py-0.5 rounded bg-[#EAF4FF] text-[#082B59] text-[10px] font-semibold">DEMO</span>
                          )}
                        </p>
                        <p className="text-slate-500 tabular-nums">
                          {new Date(o.createdAt).toLocaleString()} · {o.items.length} line items · {o.currency} {o.total.toFixed(2)}
                        </p>
                        {o.shippingAddress && (
                          <p className="text-slate-400">
                            Delivery: {o.shippingAddress}{o.customerPhone ? ` · Tel ${o.customerPhone}` : ''}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setTrackedOrderId(o.id);
                            setTab('tracking');
                          }}
                          className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#EAF4FF] dark:bg-[#082B59]/50 text-[#082B59] dark:text-[#EAF4FF] font-medium"
                        >
                          <Truck className="w-3.5 h-3.5" /> Track
                        </button>
                        <button
                          type="button"
                          onClick={() => openSupportConversation(`Order ${o.orderNumber} Support`, o.id)}
                          className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] font-medium"
                        >
                          <MessageSquare className="w-3.5 h-3.5 text-[#1178B9]" /> Chat
                        </button>
                        <button
                          type="button"
                          disabled={callPhase !== 'idle'}
                          onClick={() => {
                            setTab('audio_call');
                            startCall({
                              targetUid: 'support_queue',
                              targetName: 'Seven Sunday Customer Service',
                              callType: 'audio',
                              orderId: o.id,
                              targetQueue: true,
                            });
                          }}
                          className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] disabled:opacity-40 font-medium"
                        >
                          <Phone className="w-3.5 h-3.5 text-[#1178B9]" /> Voice
                        </button>
                        <button
                          type="button"
                          disabled={callPhase !== 'idle'}
                          onClick={() => {
                            setTab('video_call');
                            startCall({
                              targetUid: 'support_queue',
                              targetName: 'Seven Sunday Customer Service',
                              callType: 'video',
                              orderId: o.id,
                              targetQueue: true,
                            });
                          }}
                          className="min-h-[38px] inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-40 text-white font-medium"
                        >
                          <Video className="w-3.5 h-3.5" /> Video
                        </button>
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

          {/* 6. ORDER TRACKING */}
          {tab === 'tracking' && profile && (
            <OrderTracking
              customerUid={profile.uid}
              selectedOrderId={trackedOrderId}
              onSelectOrder={setTrackedOrderId}
              onViewInvoice={(order) => setPreviewInvoiceOrder(order)}
              onMessageSupport={(order) => openSupportConversation(`Order ${order.orderNumber} Support`, order.id)}
              onCallSupport={(order) => {
                setTab('audio_call');
                startCall({
                  targetUid: 'support_queue',
                  targetName: 'Seven Sunday Customer Service',
                  callType: 'audio',
                  orderId: order.id,
                  targetQueue: true,
                });
              }}
              onVideoCallSupport={(order) => {
                setTab('video_call');
                startCall({
                  targetUid: 'support_queue',
                  targetName: 'Seven Sunday Customer Service',
                  callType: 'video',
                  orderId: order.id,
                  targetQueue: true,
                });
              }}
              onCancelOrder={handleCancelOrder}
              onBrowseProducts={() => setTab('products')}
              callDisabled={callPhase !== 'idle'}
            />
          )}

          {/* 7. AUDIO CALL */}
          {tab === 'audio_call' && <DirectCallPanel mode="customer" defaultCallType="audio" orders={orders} />}

          {/* 8. VIDEO CALL */}
          {tab === 'video_call' && <DirectCallPanel mode="customer" defaultCallType="video" orders={orders} />}

          {/* 9. MESSAGES */}
          {tab === 'messages' && (
            <MessagingCenter
              mode="customer_support"
              initialConversationId={selectedConvId}
              customerOrders={orders}
              onStartInstantCall={(_title, inviteeUids, _scope, callType = 'video') => {
                const target = inviteeUids.find((id) => id !== profile?.uid) || 'support_queue';
                setTab(callType === 'audio' ? 'audio_call' : 'video_call');
                startCall({
                  targetUid: target,
                  targetName: 'Seven Sunday Customer Care',
                  callType,
                  targetQueue: target === 'support_queue',
                });
              }}
            />
          )}

          {/* 10. NOTIFICATIONS */}
          {tab === 'notifications' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-slate-800 text-xs">
                  {(['all', 'product', 'order', 'call', 'message', 'support'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setNotifFilter(f)}
                      className={`min-h-[34px] px-3 py-1 rounded-md capitalize font-medium ${
                        notifFilter === f ? 'bg-[#082B59] text-white' : 'text-[#293858] dark:text-slate-300'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'granted' && (
                    <button
                      type="button"
                      onClick={() => {
                        Notification.requestPermission().then((perm) => {
                          if (perm === 'granted') {
                            setNotice('Device browser notifications enabled for new products, calls, and orders.');
                          }
                        });
                      }}
                      className="min-h-[38px] px-3.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-xs font-medium"
                    >
                      Enable Device Alerts
                    </button>
                  )}
                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        notifications
                          .filter((n) => !n.read)
                          .forEach((n) => updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {}));
                      }}
                      className="min-h-[38px] px-3.5 py-1.5 rounded-lg bg-[#1178B9] text-white text-xs font-medium"
                    >
                      Mark All Read ({unreadCount})
                    </button>
                  )}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                {filteredNotifications.length === 0 ? (
                  <p className="p-10 text-center text-xs text-slate-500">No notifications in this category yet.</p>
                ) : (
                  filteredNotifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`p-4 flex items-start justify-between gap-4 text-xs cursor-pointer hover:bg-[#F5F8FC] dark:hover:bg-slate-800/40 ${
                        n.read ? 'opacity-75' : 'bg-[#EAF4FF]/40 dark:bg-[#082B59]/25'
                      }`}
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          {!n.read && <span className="w-2 h-2 rounded-full bg-[#1178B9]" />}
                          <span className="font-bold text-sm text-[#15243A] dark:text-slate-100">{n.title}</span>
                          <span className="text-[10px] uppercase font-mono text-slate-400">{n.type}</span>
                        </div>
                        <p className="text-slate-600 dark:text-slate-300">{n.body}</p>
                        <p className="text-slate-400 tabular-nums">{new Date(n.createdAt).toLocaleString()}</p>
                      </div>
                      {!n.read && (
                        <button
                          type="button"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            updateDoc(doc(db, 'notifications', n.id), { read: true }).catch(() => {});
                          }}
                          className="px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-[11px] font-medium shrink-0"
                        >
                          Mark Read
                        </button>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* 11. MY PROFILE & SAVED DELIVERY ADDRESSES */}
          {tab === 'profile' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <form onSubmit={handleSaveProfile} className="lg:col-span-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4 h-fit">
                <h2 className="text-base font-bold text-[#15243A] dark:text-slate-100">My Customer Profile</h2>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Email Address</label>
                  <input
                    type="email"
                    disabled
                    value={profile?.email || ''}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-3 py-2 text-xs opacity-75"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Full Name / Company Contact *</label>
                  <input
                    type="text"
                    required
                    value={profName}
                    onChange={(e) => setProfName(e.target.value)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Phone Number</label>
                  <input
                    type="tel"
                    value={profPhone}
                    onChange={(e) => setProfPhone(e.target.value)}
                    placeholder="+251 9..."
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Call & Chat Availability</label>
                  <select
                    value={profAvail}
                    onChange={(e) => setProfAvail(e.target.value as AvailabilityStatus)}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                  >
                    <option value="available">Available</option>
                    <option value="busy">Busy</option>
                    <option value="away">Away</option>
                    <option value="dnd">Do Not Disturb</option>
                  </select>
                </div>
                <button type="submit" className="w-full min-h-[42px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-semibold">
                  Save Profile Changes
                </button>
              </form>

              <div className="lg:col-span-7 space-y-4">
                <form onSubmit={handleAddDeliveryAddress} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                  <h3 className="text-sm font-bold text-[#15243A] dark:text-slate-100 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-[#1178B9]" /> Add Saved Delivery Address
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <input type="text" required value={addrLabel} onChange={(e) => setAddrLabel(e.target.value)} placeholder="Label (e.g. Warehouse)" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                    <input type="text" required value={addrRecipient} onChange={(e) => setAddrRecipient(e.target.value)} placeholder="Recipient Name" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                    <input type="tel" required value={addrPhone} onChange={(e) => setAddrPhone(e.target.value)} placeholder="Phone Number" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input type="text" required value={addrCity} onChange={(e) => setAddrCity(e.target.value)} placeholder="City (e.g. Addis Ababa)" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                    <input type="text" value={addrSubCity} onChange={(e) => setAddrSubCity(e.target.value)} placeholder="Sub-City / Zone (Optional)" className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                  </div>
                  <input type="text" required value={addrStreet} onChange={(e) => setAddrStreet(e.target.value)} placeholder="Street Address / Building / Gate Instructions" className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={addrDefault} onChange={(e) => setAddrDefault(e.target.checked)} />
                      Set as default delivery address
                    </label>
                    <button type="submit" className="min-h-[40px] px-4 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-semibold">
                      Save Address
                    </button>
                  </div>
                </form>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                  <div className="px-5 py-3 text-sm font-semibold">Saved Delivery Addresses ({savedAddresses.length})</div>
                  {savedAddresses.length === 0 ? (
                    <p className="p-6 text-center text-xs text-slate-500">No saved delivery addresses yet.</p>
                  ) : (
                    savedAddresses.map((addr) => (
                      <div key={addr.id} className="p-4 flex items-center justify-between gap-3 text-xs">
                        <div>
                          <p className="font-semibold text-sm text-[#15243A] dark:text-slate-100">
                            {addr.label}{' '}
                            {addr.isDefault && <span className="text-[10px] font-bold text-[#1178B9] uppercase">· Default</span>}
                          </p>
                          <p className="text-slate-600 dark:text-slate-300">
                            {addr.streetAddress}{addr.subCity ? `, ${addr.subCity}` : ''}, {addr.city}
                          </p>
                          <p className="text-slate-400">{addr.recipientName} · {addr.phone}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteDoc(doc(db, 'deliveryAddresses', addr.id))}
                          aria-label={`Delete ${addr.label}`}
                          className="p-2 text-red-600 hover:bg-red-50 rounded"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 12. HELP AND SUPPORT */}
          {tab === 'support' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <div className="lg:col-span-5 space-y-4">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3">
                  <h2 className="text-base font-bold text-[#15243A] dark:text-slate-100">Direct Customer Care Channels</h2>
                  <p className="text-xs text-slate-500">
                    Need immediate assistance with an order, pricing, or delivery? Connect directly with authorized Seven Sunday PLC staff.
                  </p>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => setTab('audio_call')}
                      className="w-full min-h-[44px] flex items-center justify-between px-4 py-2.5 rounded-xl bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-semibold"
                    >
                      <span className="flex items-center gap-2"><Phone className="w-4 h-4" /> Start 1:1 Voice Call</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab('video_call')}
                      className="w-full min-h-[44px] flex items-center justify-between px-4 py-2.5 rounded-xl bg-[#082B59] hover:bg-[#082B59]/90 text-white text-xs font-semibold"
                    >
                      <span className="flex items-center gap-2"><Video className="w-4 h-4" /> Start 1:1 Video Call</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setTab('messages')}
                      className="w-full min-h-[44px] flex items-center justify-between px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-xs font-semibold"
                    >
                      <span className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-[#1178B9]" /> Open Support Messages</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <form onSubmit={submitFeedback} className="lg:col-span-7 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-3 h-fit">
                <h3 className="text-sm font-bold text-[#15243A] dark:text-slate-100">Submit Inquiry, Complaint, or Feedback</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select value={fbType} onChange={(e) => setFbType(e.target.value as CustomerFeedback['type'])} className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs">
                    <option value="inquiry">Product Inquiry</option>
                    <option value="complaint">Delivery / Service Complaint</option>
                    <option value="feedback">Service Feedback</option>
                  </select>
                  <select value={fbOrderId} onChange={(e) => setFbOrderId(e.target.value)} className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs">
                    <option value="">Optional Linked Order</option>
                    {orders.map((o) => <option key={o.id} value={o.id}>{o.orderNumber}</option>)}
                  </select>
                </div>
                <input type="text" required value={fbSubject} onChange={(e) => setFbSubject(e.target.value)} placeholder="Subject" className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                <textarea rows={3} required value={fbMessage} onChange={(e) => setFbMessage(e.target.value)} placeholder="Describe your question or issue..." className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs" />
                <div className="flex items-center justify-between text-xs">
                  <span>Service Rating:</span>
                  <select value={fbRating} onChange={(e) => setFbRating(Number(e.target.value))} className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1">
                    {[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{n} / 5</option>)}
                  </select>
                </div>
                <button type="submit" className="w-full min-h-[42px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white py-2 text-xs font-semibold">
                  Submit Support Ticket
                </button>

                {feedback.length > 0 && (
                  <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2 text-xs">
                    <p className="font-semibold text-slate-500">Previous Submissions ({feedback.length})</p>
                    {feedback.map((f) => (
                      <div key={f.id} className="p-3 rounded-lg bg-[#F5F8FC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                        <p className="font-semibold">{f.subject} · <span className="capitalize text-[#1178B9]">{f.status.replace('_', ' ')}</span></p>
                        <p className="text-slate-500 mt-0.5">{f.message}</p>
                      </div>
                    ))}
                  </div>
                )}
              </form>
            </div>
          )}

          {/* SECONDARY PRESERVED TABS */}
          {tab === 'community' && (
            <MessagingCenter
              mode="customer_community"
              onStartInstantCall={(_title, inviteeUids, _scope, callType = 'video') => {
                const target = inviteeUids.find((id) => id !== profile?.uid) || 'support_queue';
                setTab(callType === 'audio' ? 'audio_call' : 'video_call');
                startCall({
                  targetUid: target,
                  targetName: 'Seven Sunday Customer Care',
                  callType,
                  targetQueue: target === 'support_queue',
                });
              }}
            />
          )}
          {tab === 'meetings' && (
            <MeetingsHub
              employees={[]}
              departments={[]}
              activeMeeting={activeMeeting}
              setActiveMeeting={setActiveMeeting}
            />
          )}
          {tab === 'security' && <SyncAndSecurityCenter />}
        </main>

        <footer className="hidden lg:block bg-[#293858] text-[#EAF4FF]/80 px-6 py-3 text-xs border-t border-white/10">
          <div className="max-w-7xl mx-auto flex items-center justify-between">
            <span>Seven Sunday Manufacturing and Trading PLC — 7Sunday Ethiopia</span>
            <span>Real-Time Ordering, Delivery Tracking & Live WebRTC Support</span>
          </div>
        </footer>
      </div>

      {/* Mobile Bottom Navigation Bar (Android & iPhone thumb ergonomics) */}
      <nav
        aria-label="Mobile customer navigation"
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 pb-safe bg-[#082B59] text-white border-t border-white/15 grid grid-cols-5"
      >
        {[
          { id: 'home' as const, shortLabel: 'Home', Icon: Home },
          { id: 'products' as const, shortLabel: 'Products', Icon: ShoppingBag },
          { id: 'cart' as const, shortLabel: `Cart${cartCount ? ` (${cartCount})` : ''}`, Icon: ShoppingCart },
          { id: 'orders' as const, shortLabel: 'Orders', Icon: Package },
          { id: 'messages' as const, shortLabel: 'Messages', Icon: MessageSquare },
        ].map(({ id, shortLabel, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`min-h-[52px] flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${
              tab === id ? 'text-white bg-[#1178B9]' : 'text-[#EAF4FF]/75'
            }`}
          >
            <Icon className="w-4 h-4" />
            <span className="truncate max-w-full px-1">{shortLabel}</span>
          </button>
        ))}
      </nav>

      {/* Product Detail & Gallery Modal */}
      <ProductDetailModal
        product={detailProduct}
        onClose={() => setDetailProduct(null)}
        onAddToCart={addProductToCart}
        onContactForPrice={(prod, qty) => openPriceInquiry(prod, qty)}
        onMessageSales={(prod) => openSupportConversation(`Product Inquiry: ${prod.name} (${prod.sku})`)}
        onAudioCallSales={(prod) => {
          setTab('audio_call');
          startCall({
            targetUid: 'support_queue',
            targetName: `Sales Inquiry — ${prod.name}`,
            callType: 'audio',
            targetQueue: true,
          });
        }}
        onVideoCallSales={(prod) => {
          setTab('video_call');
          startCall({
            targetUid: 'support_queue',
            targetName: `Sales Inquiry — ${prod.name}`,
            callType: 'video',
            targetQueue: true,
          });
        }}
      />

      {/* Contact for Price / Request Quote Modal */}
      {priceInquiryProduct && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Contact for Price: ${priceInquiryProduct.name}`}
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#082B59]/70 p-4 overflow-y-auto"
        >
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden my-auto">
            <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[#1178B9]">Contact for Price</p>
                <h3 className="text-base font-bold text-[#15243A] dark:text-slate-100 truncate">
                  {priceInquiryProduct.name} ({priceInquiryProduct.sku})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPriceInquiryProduct(null)}
                aria-label="Close price inquiry"
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSubmitPriceInquiry} className="p-5 space-y-4 text-xs">
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#F5F8FC] dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
                <img
                  src={priceInquiryProduct.imageUrl || '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png'}
                  alt={priceInquiryProduct.name}
                  referrerPolicy="no-referrer"
                  className="w-12 h-12 rounded-lg object-cover bg-white shrink-0"
                />
                <div className="min-w-0">
                  <p className="font-semibold text-[#15243A] dark:text-slate-100 truncate">{priceInquiryProduct.name}</p>
                  <p className="text-slate-500">
                    {priceInquiryProduct.category} · Requested Qty: <strong className="tabular-nums">{priceInquiryQty}</strong>{' '}
                    {priceInquiryProduct.unit || 'units'}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Quantity Needed</label>
                  <input
                    type="number"
                    min={1}
                    value={priceInquiryQty}
                    onChange={(e) => setPriceInquiryQty(Math.max(1, Number(e.target.value) || 1))}
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs tabular-nums"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Contact Phone Number</label>
                  <input
                    type="tel"
                    value={priceInquiryPhone}
                    onChange={(e) => setPriceInquiryPhone(e.target.value)}
                    placeholder="+251 9..."
                    className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Inquiry / Quote Message *</label>
                <textarea
                  rows={3}
                  required
                  value={priceInquiryNote}
                  onChange={(e) => setPriceInquiryNote(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 px-3 py-2 text-xs"
                />
              </div>

              <button
                type="submit"
                disabled={sendingPriceInquiry}
                className="w-full min-h-[42px] rounded-xl bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white font-semibold"
              >
                {sendingPriceInquiry ? 'Submitting Request...' : 'Send Price Quote Request'}
              </button>

              <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                <p className="text-[11px] font-semibold text-slate-500">Or contact Seven Sunday Sales immediately:</p>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setPriceInquiryProduct(null);
                      setTab('messages');
                    }}
                    className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 font-medium"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#1178B9]" />
                    <span>Message</span>
                  </button>
                  <button
                    type="button"
                    disabled={callPhase !== 'idle'}
                    onClick={() => {
                      setPriceInquiryProduct(null);
                      setTab('audio_call');
                      startCall({
                        targetUid: 'support_queue',
                        targetName: 'Seven Sunday Sales Desk',
                        callType: 'audio',
                        targetQueue: true,
                      });
                    }}
                    className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 font-medium disabled:opacity-50"
                  >
                    <Phone className="w-3.5 h-3.5 text-[#1178B9]" />
                    <span>Voice Call</span>
                  </button>
                  <button
                    type="button"
                    disabled={callPhase !== 'idle'}
                    onClick={() => {
                      setPriceInquiryProduct(null);
                      setTab('video_call');
                      startCall({
                        targetUid: 'support_queue',
                        targetName: 'Seven Sunday Sales Desk',
                        callType: 'video',
                        targetQueue: true,
                      });
                    }}
                    className="min-h-[38px] inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 font-medium disabled:opacity-50"
                  >
                    <Video className="w-3.5 h-3.5 text-[#1178B9]" />
                    <span>Video Call</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Invoice Modal */}
      <DocumentPreviewModal
        open={Boolean(previewInvoiceOrder)}
        title={`Official Invoice ${previewInvoiceOrder?.invoiceNumber || ''}`}
        subtitle={previewInvoiceOrder ? `Order ${previewInvoiceOrder.orderNumber} · ${new Date(previewInvoiceOrder.createdAt).toLocaleString()}` : ''}
        badge={previewInvoiceOrder ? ORDER_STATUS_LABELS[previewInvoiceOrder.status].toUpperCase() : undefined}
        onClose={() => setPreviewInvoiceOrder(null)}
        onDownload={() => previewInvoiceOrder && downloadOrderInvoicePDF(previewInvoiceOrder)}
        downloadLabel="Download Invoice PDF"
        onAdd={
          previewInvoiceOrder
            ? async () => {
                const mergedMap = new Map<string, ShoppingCartItem>();
                cartItemsState.forEach((c) => mergedMap.set(c.productId, { ...c }));
                previewInvoiceOrder.items.forEach((it) => {
                  const prev = mergedMap.get(it.productId);
                  mergedMap.set(it.productId, {
                    productId: it.productId,
                    name: it.name,
                    sku: it.sku,
                    unitPrice: it.unitPrice,
                    currency: previewInvoiceOrder.currency,
                    ...(it.unit ? { unit: it.unit } : {}),
                    ...(it.imageUrl ? { imageUrl: it.imageUrl } : {}),
                    quantity: (prev?.quantity || 0) + it.quantity,
                    addedAt: prev?.addedAt || new Date().toISOString(),
                  });
                });
                await persistCart(Array.from(mergedMap.values()));
                setPreviewInvoiceOrder(null);
                setTab('cart');
                setNotice(`Added items from ${previewInvoiceOrder.orderNumber} back to your Shopping Cart.`);
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
              {previewInvoiceOrder.customerPhone && <p><strong>Phone:</strong> {previewInvoiceOrder.customerPhone}</p>}
              {previewInvoiceOrder.shippingAddress && (
                <p>
                  <strong>Delivery Address:</strong> {previewInvoiceOrder.shippingAddress}
                  {previewInvoiceOrder.deliveryCity ? `, ${previewInvoiceOrder.deliveryCity}` : ''}
                </p>
              )}
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
                    <td className="p-2 tabular-nums">
                      {item.quantity} {item.unit || ''}
                    </td>
                    <td className="p-2 text-right tabular-nums">
                      {previewInvoiceOrder.currency} {(item.quantity * item.unitPrice).toFixed(2)}
                    </td>
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
