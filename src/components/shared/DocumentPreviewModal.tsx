import React from 'react';
import { Download, Plus, Printer, Trash2, X } from 'lucide-react';

interface DocumentPreviewModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  badge?: string;
  children: React.ReactNode;
  onClose: () => void;
  onPrint?: () => void;
  onDownload?: () => void;
  downloadLabel?: string;
  onDownloadSecondary?: () => void;
  downloadSecondaryLabel?: string;
  onAdd?: () => void;
  addLabel?: string;
  onRemove?: () => void;
  removeLabel?: string;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  open,
  title,
  subtitle,
  badge,
  children,
  onClose,
  onPrint,
  onDownload,
  downloadLabel = 'Download PDF',
  onDownloadSecondary,
  downloadSecondaryLabel = 'Download Excel',
  onAdd,
  addLabel = 'Add Document',
  onRemove,
  removeLabel = 'Remove',
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#082B59]/70 backdrop-blur-xs p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="printable-document w-full max-w-3xl rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden my-auto">
        {/* Document Header */}
        <div className="px-5 py-4 bg-[#082B59] text-white flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
              alt="Seven Sunday Connect"
              referrerPolicy="no-referrer"
              className="w-8 h-8 rounded-full bg-white object-contain p-0.5 shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-base truncate">{title}</h3>
                {badge && (
                  <span className="px-2 py-0.5 rounded bg-[#087CEB] text-[10px] font-semibold uppercase tracking-wider">
                    {badge}
                  </span>
                )}
              </div>
              {subtitle && <p className="text-xs text-[#EAF4FF]/80 truncate">{subtitle}</p>}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close document preview"
            className="no-print min-h-[44px] min-w-[44px] inline-flex items-center justify-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-2 text-xs font-medium text-white transition-colors"
          >
            <X className="w-4 h-4" />
            <span>Close</span>
          </button>
        </div>

        {/* Document Action Bar */}
        <div className="no-print px-5 py-3 border-b border-slate-200 dark:border-slate-800 bg-[#F5F8FC] dark:bg-slate-950 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onPrint || (() => window.print())}
              className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium transition-colors"
            >
              <Printer className="w-4 h-4" />
              <span>Print Document</span>
            </button>
            {onDownload && (
              <button
                type="button"
                onClick={onDownload}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#293858] dark:text-slate-100 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-xs font-medium transition-colors"
              >
                <Download className="w-4 h-4 text-[#1178B9]" />
                <span>{downloadLabel}</span>
              </button>
            )}
            {onDownloadSecondary && (
              <button
                type="button"
                onClick={onDownloadSecondary}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-[#293858] dark:text-slate-100 hover:bg-[#EAF4FF] dark:hover:bg-slate-800 text-xs font-medium transition-colors"
              >
                <Download className="w-4 h-4 text-[#1178B9]" />
                <span>{downloadSecondaryLabel}</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onAdd && (
              <button
                type="button"
                onClick={onAdd}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-[#1178B9] text-[#1178B9] hover:bg-[#EAF4FF] text-xs font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                <span>{addLabel}</span>
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                onClick={onRemove}
                className="min-h-[44px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-xs font-medium transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                <span>{removeLabel}</span>
              </button>
            )}
          </div>
        </div>

        {/* Printable Document Body */}
        <div className="p-5 sm:p-6 max-h-[70vh] overflow-y-auto text-sm text-[#293858] dark:text-slate-200">
          {children}
        </div>
      </div>
    </div>
  );
};
