import React from 'react';
import { ArrowDownUp, Search } from 'lucide-react';

interface SelectFilter {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ label: string; value: string }>;
}

interface SearchFilterSortBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: SelectFilter[];
  sortOptions?: Array<{ label: string; value: string }>;
  sortBy?: string;
  onSortByChange?: (value: string) => void;
  sortDir?: 'asc' | 'desc';
  onToggleSortDir?: () => void;
  resultCount?: number;
}

export const SearchFilterSortBar: React.FC<SearchFilterSortBarProps> = ({
  search,
  onSearchChange,
  searchPlaceholder = 'Search records...',
  filters = [],
  sortOptions = [],
  sortBy,
  onSortByChange,
  sortDir = 'desc',
  onToggleSortDir,
  resultCount,
}) => {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-[#F3F5F8] dark:bg-slate-900/70 p-3">
      <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[220px]">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="w-full min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 pl-9 pr-3 py-1.5 text-xs text-[#293858] dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-[#1178B9]"
          />
        </div>

        {filters.map((f) => (
          <select
            key={f.label}
            aria-label={f.label}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
            className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-[#293858] dark:text-slate-100"
          >
            {f.options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {sortOptions.length > 0 && onSortByChange && (
          <select
            aria-label="Sort field"
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value)}
            className="min-h-[40px] rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs text-[#293858] dark:text-slate-100"
          >
            {sortOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                Sort: {opt.label}
              </option>
            ))}
          </select>
        )}

        {onToggleSortDir && (
          <button
            type="button"
            onClick={onToggleSortDir}
            className="min-h-[40px] inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1.5 text-xs font-medium text-[#293858] dark:text-slate-100 hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
          >
            <ArrowDownUp className="w-3.5 h-3.5 text-[#1178B9]" />
            <span>{sortDir === 'asc' ? 'Asc' : 'Desc'}</span>
          </button>
        )}

        {typeof resultCount === 'number' && (
          <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums px-1">
            {resultCount} {resultCount === 1 ? 'record' : 'records'}
          </span>
        )}
      </div>
    </div>
  );
};
