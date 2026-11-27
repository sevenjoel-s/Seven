import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, MessageSquare, Minus, Package, Phone, Plus, ShoppingCart, Video, X } from 'lucide-react';
import { Product } from '../../types/domain';

interface ProductDetailModalProps {
  product: Product | null;
  onClose: () => void;
  onAddToCart: (product: Product, quantity: number) => void;
  onContactForPrice?: (product: Product, quantity: number) => void;
  onMessageSales?: (product: Product) => void;
  onAudioCallSales?: (product: Product) => void;
  onVideoCallSales?: (product: Product) => void;
}

const AVAILABILITY_META: Record<NonNullable<Product['availabilityStatus']>, { label: string; cls: string }> = {
  in_stock: { label: 'In Stock', cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40' },
  low_stock: { label: 'Low Stock', cls: 'text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40' },
  out_of_stock: { label: 'Out of Stock', cls: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40' },
  preorder: { label: 'Pre-Order Available', cls: 'text-[#1178B9] bg-[#EAF4FF] dark:bg-[#082B59]/50' },
};

export const ProductDetailModal: React.FC<ProductDetailModalProps> = ({
  product,
  onClose,
  onAddToCart,
  onContactForPrice,
  onMessageSales,
  onAudioCallSales,
  onVideoCallSales,
}) => {
  const [activeImageIdx, setActiveImageIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [addedFeedback, setAddedFeedback] = useState(false);

  useEffect(() => {
    setActiveImageIdx(0);
    setQty(1);
    setAddedFeedback(false);
  }, [product?.id]);

  const images = useMemo(() => {
    if (!product) return [];
    const list = [
      product.imageUrl || '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png',
      ...(product.galleryImages || []),
    ].filter(Boolean);
    return Array.from(new Set(list));
  }, [product]);

  if (!product) return null;

  const statusKey: NonNullable<Product['availabilityStatus']> =
    product.availabilityStatus ||
    (product.stock <= 0 ? 'out_of_stock' : product.stock <= 5 ? 'low_stock' : 'in_stock');
  const statusInfo = AVAILABILITY_META[statusKey];
  const canOrder = statusKey !== 'out_of_stock' && (product.stock > 0 || statusKey === 'preorder');
  const maxSelectable = statusKey === 'preorder' ? 999 : Math.max(1, product.stock);

  const handleAdd = () => {
    if (!canOrder) return;
    onAddToCart(product, qty);
    setAddedFeedback(true);
    window.setTimeout(() => setAddedFeedback(false), 1800);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Product details for ${product.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#082B59]/70 p-3 sm:p-5 overflow-y-auto"
    >
      <div className="w-full max-w-4xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500 font-mono">
              {product.category} · SKU {product.sku}
            </p>
            <h2 className="text-lg font-bold text-[#15243A] dark:text-slate-100 truncate">{product.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close product details"
            className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 sm:p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-12 gap-6">
          {/* Interactive Gallery */}
          <div className="md:col-span-6 space-y-3">
            <div className="relative rounded-xl border border-slate-200 dark:border-slate-800 bg-[#F5F8FC] dark:bg-slate-950 aspect-[4/3] overflow-hidden flex items-center justify-center">
              <img
                src={images[activeImageIdx] || images[0]}
                alt={`${product.name} image ${activeImageIdx + 1}`}
                referrerPolicy="no-referrer"
                onError={(e) => {
                  (e.currentTarget as HTMLImageElement).src =
                    '/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png';
                }}
                className="w-full h-full object-contain"
              />
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    aria-label="Previous product image"
                    onClick={() => setActiveImageIdx((i) => (i - 1 + images.length) % images.length)}
                    className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Next product image"
                    onClick={() => setActiveImageIdx((i) => (i + 1) % images.length)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/90 dark:bg-slate-900/90 border border-slate-200 dark:border-slate-700 flex items-center justify-center shadow"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {images.length > 1 && (
              <div className="grid grid-cols-5 gap-2">
                {images.map((url, idx) => (
                  <button
                    key={`${url}_${idx}`}
                    type="button"
                    onClick={() => setActiveImageIdx(idx)}
                    className={`rounded-lg overflow-hidden border aspect-square bg-[#F5F8FC] dark:bg-slate-950 ${
                      idx === activeImageIdx
                        ? 'border-[#1178B9] ring-2 ring-[#1178B9]/40'
                        : 'border-slate-200 dark:border-slate-700 opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img
                      src={url}
                      alt={`${product.name} thumbnail ${idx + 1}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info & Specs */}
          <div className="md:col-span-6 space-y-5">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <div>
                <p className="text-2xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">
                  {product.contactForPrice ? 'Contact for Price' : `${product.currency} ${(product.price ?? 0).toFixed(2)}`}
                </p>
                <p className="text-xs text-slate-500">
                  Per {product.unit || 'Unit'} · Available Stock:{' '}
                  <span className="font-semibold text-[#15243A] dark:text-slate-200 tabular-nums">
                    {product.stock} {product.unit || 'units'}
                  </span>
                </p>
              </div>
              <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${statusInfo.cls}`}>
                {statusInfo.label}
              </span>
            </div>

            {product.description && (
              <div className="text-xs sm:text-sm text-[#293858] dark:text-slate-300 leading-relaxed whitespace-pre-line">
                {product.description}
              </div>
            )}

            {product.specifications && product.specifications.length > 0 && (
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="px-3.5 py-2 bg-[#F5F8FC] dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 text-xs font-semibold text-[#082B59] dark:text-[#EAF4FF] flex items-center gap-1.5">
                  <Package className="w-3.5 h-3.5 text-[#1178B9]" />
                  Product Specifications
                </div>
                <dl className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                  {product.specifications.map((spec, i) => (
                    <div key={`${spec.key}_${i}`} className="px-3.5 py-2 grid grid-cols-2 gap-3">
                      <dt className="text-slate-500 font-medium">{spec.key}</dt>
                      <dd className="text-[#15243A] dark:text-slate-100 font-semibold">{spec.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}

            {/* Quantity & Add to Cart */}
            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center gap-3">
              <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-[#F5F8FC] dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  aria-label="Decrease quantity"
                  className="min-h-[42px] min-w-[40px] inline-flex items-center justify-center hover:bg-slate-200/60 dark:hover:bg-slate-800"
                >
                  <Minus className="w-3.5 h-3.5" />
                </button>
                <input
                  type="number"
                  min={1}
                  max={maxSelectable}
                  value={qty}
                  onChange={(e) => {
                    const n = Math.max(1, Math.min(maxSelectable, Number(e.target.value) || 1));
                    setQty(n);
                  }}
                  aria-label="Quantity"
                  className="w-14 text-center bg-transparent text-sm font-semibold tabular-nums focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.min(maxSelectable, q + 1))}
                  aria-label="Increase quantity"
                  className="min-h-[42px] min-w-[40px] inline-flex items-center justify-center hover:bg-slate-200/60 dark:hover:bg-slate-800"
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              </div>

              {product.contactForPrice ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onContactForPrice?.(product, qty);
                  }}
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#082B59] hover:bg-[#1178B9] text-white text-sm font-semibold"
                >
                  <MessageSquare className="w-4 h-4" />
                  Contact for Price
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canOrder}
                  onClick={handleAdd}
                  className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#1178B9] hover:bg-[#0D6096] disabled:opacity-50 text-white text-sm font-semibold"
                >
                  {addedFeedback ? <Check className="w-4 h-4" /> : <ShoppingCart className="w-4 h-4" />}
                  {addedFeedback
                    ? 'Added to Shopping Cart'
                    : canOrder
                    ? `Add to Cart · ${product.currency} ${((product.price ?? 0) * qty).toFixed(2)}`
                    : 'Out of Stock'}
                </button>
              )}
            </div>

            {(onMessageSales || onAudioCallSales || onVideoCallSales) && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500 font-medium mr-1">Ask Sales:</span>
                {onMessageSales && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onMessageSales(product);
                    }}
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 font-medium"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#1178B9]" /> Chat
                  </button>
                )}
                {onAudioCallSales && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onAudioCallSales(product);
                    }}
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 font-medium"
                  >
                    <Phone className="w-3.5 h-3.5 text-[#1178B9]" /> Voice Call
                  </button>
                )}
                {onVideoCallSales && (
                  <button
                    type="button"
                    onClick={() => {
                      onClose();
                      onVideoCallSales(product);
                    }}
                    className="min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#082B59] hover:bg-[#1178B9] text-white font-medium"
                  >
                    <Video className="w-3.5 h-3.5" /> Video Call
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
