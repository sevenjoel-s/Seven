import React, { useState } from 'react';
import { Download, Smartphone, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../../hooks/usePWAInstall';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className="min-h-[40px] inline-flex items-center gap-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] px-3 py-1.5 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0"
      >
        <Download className="w-3.5 h-3.5" />
        {compact ? 'Install' : 'Install App'}
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-[#EAF4FF] dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-[#082B59] dark:text-slate-100 hover:bg-[#d8ebff] dark:hover:bg-slate-700 transition-colors whitespace-nowrap shrink-0"
        >
          <Smartphone className="w-3.5 h-3.5 text-[#1178B9]" />
          Install on iPhone / iPad
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#082B59]/70 p-4">
            <div className="w-full max-w-sm rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <img
                    src="/assets/aistudio/seven_sunday_app_icon_crcle-removebg-preview_d14ccd7b.png"
                    alt="7Sunday Meet"
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full object-contain"
                  />
                  <h3 className="text-base font-semibold text-[#15243A] dark:text-slate-100">
                    Install 7Sunday Meet
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-2 text-slate-500 hover:text-[#15243A] dark:hover:text-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="text-sm text-[#293858] dark:text-slate-300 space-y-2 list-decimal list-inside">
                <li>Tap the Share icon in your iPhone or iPad Safari bar.</li>
                <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
                <li>Tap <strong>Add</strong> to launch 7Sunday Meet full-screen.</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white py-2 text-sm font-medium"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="no-print fixed bottom-20 lg:bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-[#082B59] border border-[#087CEB] px-3.5 py-2 text-xs font-medium text-white shadow-lg"
    >
      <WifiOff className="w-4 h-4 shrink-0 text-[#087CEB]" />
      <span>Offline Mode — Cached workspace data active</span>
    </div>
  );
};
