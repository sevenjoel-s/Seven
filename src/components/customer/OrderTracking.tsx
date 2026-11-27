import React, { useEffect, useMemo, useState } from 'react';
import { collection, doc, onSnapshot, query, where } from 'firebase/firestore';
import {
  AlertCircle,
  Ban,
  Box,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  MapPin,
  MessageSquare,
  Package,
  PackageCheck,
  Phone,
  Search,
  ShoppingBag,
  Truck,
  Video,
} from 'lucide-react';
import { ORDER_STATUS_LABELS } from '../../lib/exportUtils';
import { db, handleFirestoreError, OperationType } from '../../lib/firebase';
import { CustomerOrder, OrderStatus, OrderStatusHistoryEntry } from '../../types/domain';

interface TimelineStageDefinition {
  status: Exclude<OrderStatus, 'cancelled'>;
  label: string;
  description: string;
  Icon: React.ElementType;
}

export const ORDER_TIMELINE_STAGES: TimelineStageDefinition[] = [
  {
    status: 'pending',
    label: 'Pending',
    description: 'Order submitted and queued for verification.',
    Icon: Clock,
  },
  {
    status: 'confirmed',
    label: 'Confirmed',
    description: 'Verified by Seven Sunday PLC and inventory allocated.',
    Icon: CheckCircle2,
  },
  {
    status: 'processing',
    label: 'Processing',
    description: 'Manufacturing, quality inspection, and packing underway.',
    Icon: Box,
  },
  {
    status: 'ready_for_delivery',
    label: 'Ready for Delivery',
    description: 'Packed, labeled, and staged at our dispatch bay.',
    Icon: PackageCheck,
  },
  {
    status: 'shipped',
    label: 'Shipped',
    description: 'Dispatched with courier or company delivery fleet.',
    Icon: Truck,
  },
  {
    status: 'delivered',
    label: 'Delivered',
    description: 'Received and signed off at your delivery destination.',
    Icon: MapPin,
  },
];

export interface OrderTrackingProps {
  customerUid: string;
  selectedOrderId?: string;
  onSelectOrder?: (orderId: string) => void;
  onViewInvoice?: (order: CustomerOrder) => void;
  onMessageSupport?: (order: CustomerOrder) => void;
  onCallSupport?: (order: CustomerOrder) => void;
  onVideoCallSupport?: (order: CustomerOrder) => void;
  onCancelOrder?: (order: CustomerOrder) => void;
  onBrowseProducts?: () => void;
  callDisabled?: boolean;
}

export const OrderTracking: React.FC<OrderTrackingProps> = ({
  customerUid,
  selectedOrderId,
  onSelectOrder,
  onViewInvoice,
  onMessageSupport,
  onCallSupport,
  onVideoCallSupport,
  onCancelOrder,
  onBrowseProducts,
  callDisabled = false,
}) => {
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [showDemoData, setShowDemoData] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeOrderId, setActiveOrderId] = useState<string>(selectedOrderId || '');
  const [searchTerm, setSearchTerm] = useState('');
  const [filterGroup, setFilterGroup] = useState<'all' | 'active' | 'delivered' | 'cancelled'>('all');

  useEffect(() => {
    if (selectedOrderId) {
      setActiveOrderId(selectedOrderId);
    }
  }, [selectedOrderId]);

  useEffect(() => {
    if (!customerUid) {
      setOrders([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);

    const unsubOrders = onSnapshot(
      query(collection(db, 'orders'), where('customerUid', '==', customerUid)),
      (snap) => {
        const list = snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomerOrder, 'id'>) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setOrders(list);
        setLoading(false);
        setLoadError(null);
      },
      (err) => {
        setLoading(false);
        setLoadError('Unable to load live order tracking updates from Firestore.');
        try {
          handleFirestoreError(err, OperationType.LIST, 'orders');
        } catch {
          // Error already logged with auth & path context
        }
      }
    );

    const unsubSettings = onSnapshot(
      doc(db, 'publicConfig', 'appSettings'),
      (snap) => {
        if (snap.exists()) {
          setShowDemoData(Boolean(snap.data().showDemoData));
        }
      },
      () => {}
    );

    return () => {
      unsubOrders();
      unsubSettings();
    };
  }, [customerUid]);

  const visibleOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return orders.filter((o) => {
      if (!showDemoData && o.isDemo) return false;
      if (filterGroup === 'active' && (o.status === 'delivered' || o.status === 'cancelled')) return false;
      if (filterGroup === 'delivered' && o.status !== 'delivered') return false;
      if (filterGroup === 'cancelled' && o.status !== 'cancelled') return false;
      if (term) {
        const matchesMeta =
          o.orderNumber.toLowerCase().includes(term) ||
          o.invoiceNumber.toLowerCase().includes(term) ||
          (o.shippingAddress || '').toLowerCase().includes(term);
        const matchesItem = o.items.some(
          (it) => it.name.toLowerCase().includes(term) || it.sku.toLowerCase().includes(term)
        );
        if (!matchesMeta && !matchesItem) return false;
      }
      return true;
    });
  }, [orders, showDemoData, filterGroup, searchTerm]);

  const trackedOrder = useMemo(() => {
    if (visibleOrders.length === 0) return null;
    return (
      visibleOrders.find((o) => o.id === activeOrderId) ||
      orders.find((o) => o.id === activeOrderId && (showDemoData || !o.isDemo)) ||
      visibleOrders[0]
    );
  }, [visibleOrders, orders, activeOrderId, showDemoData]);

  const handleSelectOrder = (id: string) => {
    setActiveOrderId(id);
    onSelectOrder?.(id);
  };

  // Map each forward stage to its latest matching statusHistory entry (with fallback to createdAt for Pending)
  const stageHistoryMap = useMemo(() => {
    const map = new Map<OrderStatus, OrderStatusHistoryEntry>();
    if (!trackedOrder) return map;
    const history = Array.isArray(trackedOrder.statusHistory) ? trackedOrder.statusHistory : [];
    history.forEach((entry) => {
      map.set(entry.status, entry);
    });
    if (!map.has('pending')) {
      map.set('pending', {
        status: 'pending',
        timestamp: trackedOrder.createdAt,
        actorUid: trackedOrder.customerUid,
        note: 'Order placed',
      });
    }
    return map;
  }, [trackedOrder]);

  // Determine highest reached stage index even if the order was later cancelled
  const currentStageIndex = useMemo(() => {
    if (!trackedOrder) return -1;
    if (trackedOrder.status !== 'cancelled') {
      return ORDER_TIMELINE_STAGES.findIndex((s) => s.status === trackedOrder.status);
    }
    let highest = 0;
    ORDER_TIMELINE_STAGES.forEach((s, idx) => {
      if (stageHistoryMap.has(s.status)) {
        highest = Math.max(highest, idx);
      }
    });
    return highest;
  }, [trackedOrder, stageHistoryMap]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center space-y-2">
        <Clock className="w-6 h-6 text-[#1178B9] mx-auto animate-spin" />
        <p className="text-sm font-medium text-[#15243A] dark:text-slate-100">Loading your live order tracking...</p>
        <p className="text-xs text-slate-500">Synchronizing real-time order milestones from Firestore.</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-6 flex items-start gap-3 text-xs text-red-700 dark:text-red-300">
        <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <p className="font-semibold text-sm">Order Tracking Unavailable</p>
          <p>{loadError}</p>
        </div>
      </div>
    );
  }

  const allAllowedOrders = orders.filter((o) => showDemoData || !o.isDemo);

  if (allAllowedOrders.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-10 text-center space-y-3">
        <Truck className="w-8 h-8 text-[#1178B9] mx-auto" />
        <div className="space-y-1">
          <h2 className="text-base font-bold text-[#15243A] dark:text-slate-100">No Orders to Track Yet</h2>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Once you submit an order from the product catalog, you can monitor every milestone here in real time from Pending to Delivered.
          </p>
        </div>
        {onBrowseProducts && (
          <button
            type="button"
            onClick={onBrowseProducts}
            className="min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-semibold transition-colors"
          >
            <ShoppingBag className="w-4 h-4" /> Browse All Products
          </button>
        )}
      </div>
    );
  }

  const progressPercent =
    trackedOrder && trackedOrder.status !== 'cancelled' && currentStageIndex >= 0
      ? Math.round(((currentStageIndex + 1) / ORDER_TIMELINE_STAGES.length) * 100)
      : 0;

  return (
    <div className="space-y-6">
      {/* Search & Filter Controls */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by Order #, Invoice #, SKU, or product..."
            className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950 pl-9 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#F5F8FC] dark:bg-slate-950 rounded-lg border border-slate-200 dark:border-slate-800">
          {(
            [
              { id: 'all', label: 'All Orders' },
              { id: 'active', label: 'In Progress' },
              { id: 'delivered', label: 'Delivered' },
              { id: 'cancelled', label: 'Cancelled' },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setFilterGroup(opt.id)}
              className={`min-h-[34px] px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors ${
                filterGroup === opt.id
                  ? 'bg-white dark:bg-slate-800 text-[#082B59] dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-[#082B59] dark:hover:text-white'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {visibleOrders.length === 0 ? (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-8 text-center text-xs text-slate-500">
          No orders match your current search or status filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Order List Selector */}
          <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <h2 className="text-xs font-bold text-[#15243A] dark:text-slate-100">Your Orders</h2>
              <span className="text-xs text-slate-500 tabular-nums">{visibleOrders.length} total</span>
            </div>
            <div className="divide-y divide-slate-100 dark:divide-slate-800 max-h-[540px] overflow-y-auto">
              {visibleOrders.map((order) => {
                const isSelected = trackedOrder?.id === order.id;
                const totalUnits = order.items.reduce((sum, it) => sum + it.quantity, 0);
                return (
                  <button
                    key={order.id}
                    type="button"
                    onClick={() => handleSelectOrder(order.id)}
                    className={`w-full text-left p-4 transition-colors space-y-1.5 ${
                      isSelected
                        ? 'bg-[#EAF4FF] dark:bg-[#082B59]/50'
                        : 'hover:bg-[#F5F8FC] dark:hover:bg-slate-800/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs font-bold text-[#082B59] dark:text-[#EAF4FF]">
                        {order.orderNumber}
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          order.status === 'cancelled'
                            ? 'text-red-600 dark:text-red-400'
                            : order.status === 'delivered'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-[#1178B9] dark:text-[#7CC4FA]'
                        }`}
                      >
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                      {totalUnits} {totalUnits === 1 ? 'item' : 'items'} · {order.currency} {order.total.toFixed(2)}
                    </p>
                    <p className="text-[11px] text-slate-400 tabular-nums">
                      Placed {new Date(order.createdAt).toLocaleDateString()}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected Order Timeline & Details */}
          {trackedOrder && (
            <div className="lg:col-span-8 space-y-5">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 sm:p-6 space-y-6">
                {/* Order Summary Header */}
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-5">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="font-mono font-semibold text-[#082B59] dark:text-[#EAF4FF]">
                        Order {trackedOrder.orderNumber}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">Invoice {trackedOrder.invoiceNumber}</span>
                      {trackedOrder.isDemo && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-[#1178B9]">Demo Record</span>
                        </>
                      )}
                    </div>
                    <h2 className="text-xl font-bold text-[#15243A] dark:text-white">
                      {ORDER_STATUS_LABELS[trackedOrder.status]}
                    </h2>
                    <p className="text-xs text-slate-500 tabular-nums">
                      Placed {new Date(trackedOrder.createdAt).toLocaleString()} · Last updated{' '}
                      {new Date(trackedOrder.updatedAt).toLocaleString()}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {onViewInvoice && (
                      <button
                        type="button"
                        onClick={() => onViewInvoice(trackedOrder)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5 text-[#1178B9]" /> Invoice &amp; Print
                      </button>
                    )}
                    {onMessageSupport && (
                      <button
                        type="button"
                        onClick={() => onMessageSupport(trackedOrder)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-xs font-medium whitespace-nowrap shrink-0"
                      >
                        <MessageSquare className="w-3.5 h-3.5 text-[#1178B9]" /> Message Care
                      </button>
                    )}
                    {onCallSupport && (
                      <button
                        type="button"
                        disabled={callDisabled}
                        onClick={() => onCallSupport(trackedOrder)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap shrink-0"
                      >
                        <Phone className="w-3.5 h-3.5" /> Voice Call
                      </button>
                    )}
                    {onVideoCallSupport && (
                      <button
                        type="button"
                        disabled={callDisabled}
                        onClick={() => onVideoCallSupport(trackedOrder)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#082B59] hover:bg-[#082B59]/90 disabled:opacity-50 text-white text-xs font-medium whitespace-nowrap shrink-0"
                      >
                        <Video className="w-3.5 h-3.5" /> Video Call
                      </button>
                    )}
                    {onCancelOrder && (trackedOrder.status === 'pending' || trackedOrder.status === 'confirmed') && (
                      <button
                        type="button"
                        onClick={() => onCancelOrder(trackedOrder)}
                        className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium whitespace-nowrap shrink-0"
                      >
                        Cancel Order
                      </button>
                    )}
                  </div>
                </div>

                {/* Cancelled Banner or Overall Progress Bar */}
                {trackedOrder.status === 'cancelled' ? (
                  <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-4 flex items-start gap-3 text-xs text-red-700 dark:text-red-300">
                    <Ban className="w-5 h-5 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-bold text-sm">Order Cancelled</p>
                      <p>
                        {stageHistoryMap.get('cancelled')?.note || 'This order has been cancelled.'}{' '}
                        {stageHistoryMap.get('cancelled')?.timestamp && (
                          <span className="tabular-nums">
                            ({new Date(stageHistoryMap.get('cancelled')!.timestamp).toLocaleString()})
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#15243A] dark:text-slate-100">
                        Fulfillment Progress
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        Stage {Math.max(1, currentStageIndex + 1)} of {ORDER_TIMELINE_STAGES.length} ({progressPercent}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-300 ${
                          trackedOrder.status === 'delivered' ? 'bg-emerald-600' : 'bg-[#1178B9]'
                        }`}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Vertical Stage-by-Stage Timeline (Pending -> Delivered) */}
                <div className="space-y-1" role="list" aria-label="Order fulfillment timeline">
                  {ORDER_TIMELINE_STAGES.map((stage, idx) => {
                    const StageIcon = stage.Icon;
                    const historyEntry = stageHistoryMap.get(stage.status);
                    const isCancelled = trackedOrder.status === 'cancelled';
                    const isCompleted = !isCancelled && idx < currentStageIndex;
                    const isCurrent = !isCancelled && idx === currentStageIndex;
                    const isReachedBeforeCancel = isCancelled && (idx === 0 || Boolean(historyEntry));
                    const isDone = isCompleted || (isCurrent && stage.status === 'delivered');
                    const isLast = idx === ORDER_TIMELINE_STAGES.length - 1;

                    let stateLabel = 'Upcoming';
                    if (isCancelled) {
                      stateLabel = isReachedBeforeCancel ? 'Completed before cancellation' : 'Not reached';
                    } else if (isDone) {
                      stateLabel = 'Completed';
                    } else if (isCurrent) {
                      stateLabel = 'Current Stage';
                    }

                    return (
                      <div key={stage.status} role="listitem" className="relative flex gap-4 pb-6 last:pb-0">
                        {/* Vertical Connector Line */}
                        {!isLast && (
                          <div
                            aria-hidden="true"
                            className={`absolute left-[17px] top-9 bottom-0 w-0.5 ${
                              !isCancelled && idx < currentStageIndex
                                ? 'bg-emerald-500 dark:bg-emerald-700'
                                : 'bg-slate-200 dark:bg-slate-800'
                            }`}
                          />
                        )}

                        {/* Milestone Marker */}
                        <div
                          className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center shrink-0 border-2 ${
                            isDone
                              ? 'bg-emerald-600 border-emerald-600 text-white'
                              : isCurrent
                              ? 'bg-[#1178B9] border-[#1178B9] text-white'
                              : isReachedBeforeCancel
                              ? 'bg-slate-200 dark:bg-slate-700 border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-400'
                          }`}
                        >
                          {isDone ? <Check className="w-4 h-4" /> : <StageIcon className="w-4 h-4" />}
                        </div>

                        {/* Stage Body */}
                        <div className="flex-1 min-w-0 pt-0.5 space-y-1">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono text-slate-400 tabular-nums">0{idx + 1}.</span>
                              <h3
                                className={`text-sm font-bold ${
                                  isCurrent || isDone
                                    ? 'text-[#15243A] dark:text-white'
                                    : 'text-slate-500 dark:text-slate-400'
                                }`}
                              >
                                {stage.label}
                              </h3>
                            </div>
                            <span
                              className={`text-xs font-semibold ${
                                isDone
                                  ? 'text-emerald-700 dark:text-emerald-400'
                                  : isCurrent
                                  ? 'text-[#1178B9] dark:text-[#7CC4FA]'
                                  : 'text-slate-400'
                              }`}
                            >
                              {stateLabel}
                            </span>
                          </div>

                          <p className="text-xs text-slate-600 dark:text-slate-300">{stage.description}</p>

                          {historyEntry && (
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 tabular-nums">
                              {new Date(historyEntry.timestamp).toLocaleString()}
                              {historyEntry.note ? ` · ${historyEntry.note}` : ''}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Order Items & Delivery Context */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-[#15243A] dark:text-slate-100">Items in Order</h3>
                    <span className="font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">
                      {trackedOrder.currency} {trackedOrder.total.toFixed(2)}
                    </span>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {trackedOrder.items.map((item, idx) => (
                      <div key={`${item.productId}_${idx}`} className="py-2.5 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          {item.imageUrl ? (
                            <img
                              src={item.imageUrl}
                              alt={item.name}
                              referrerPolicy="no-referrer"
                              className="w-9 h-9 rounded-md object-cover bg-[#F3F5F8] dark:bg-slate-800 shrink-0"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-md bg-[#F3F5F8] dark:bg-slate-800 flex items-center justify-center shrink-0 text-slate-400">
                              <Package className="w-4 h-4" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <p className="font-semibold text-[#15243A] dark:text-slate-100 truncate">{item.name}</p>
                            <p className="text-[11px] text-slate-400 font-mono tabular-nums">
                              {item.sku} · {item.quantity} {item.unit || 'unit'} × {trackedOrder.currency}{' '}
                              {item.unitPrice.toFixed(2)}
                            </p>
                          </div>
                        </div>
                        <span className="font-semibold tabular-nums shrink-0">
                          {trackedOrder.currency} {(item.quantity * item.unitPrice).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 space-y-3">
                  <h3 className="font-bold text-[#15243A] dark:text-slate-100">Delivery &amp; Event Log</h3>
                  <div className="space-y-1 text-slate-600 dark:text-slate-300">
                    <p>
                      <span className="font-semibold text-[#15243A] dark:text-slate-100">Address:</span>{' '}
                      {trackedOrder.shippingAddress || 'Standard Pickup'}
                      {trackedOrder.deliveryCity ? `, ${trackedOrder.deliveryCity}` : ''}
                    </p>
                    {trackedOrder.customerPhone && (
                      <p className="tabular-nums">
                        <span className="font-semibold text-[#15243A] dark:text-slate-100">Phone:</span>{' '}
                        {trackedOrder.customerPhone}
                      </p>
                    )}
                    {trackedOrder.notes && (
                      <p>
                        <span className="font-semibold text-[#15243A] dark:text-slate-100">Order Notes:</span>{' '}
                        {trackedOrder.notes}
                      </p>
                    )}
                  </div>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-1.5">
                    <p className="font-semibold text-[#15243A] dark:text-slate-100">Recorded Status Events</p>
                    {trackedOrder.statusHistory && trackedOrder.statusHistory.length > 0 ? (
                      <div className="space-y-1.5 max-h-36 overflow-y-auto">
                        {trackedOrder.statusHistory.map((h, i) => (
                          <div key={`${h.status}_${i}`} className="flex items-center justify-between gap-2 text-slate-500 dark:text-slate-400">
                            <span className="font-medium text-[#15243A] dark:text-slate-200">
                              {ORDER_STATUS_LABELS[h.status]}
                            </span>
                            <span className="tabular-nums">{new Date(h.timestamp).toLocaleString()}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-slate-500 tabular-nums">
                        Submitted {new Date(trackedOrder.createdAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
