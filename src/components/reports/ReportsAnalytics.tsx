import React, { useMemo, useState } from 'react';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell } from 'recharts';
import { Download, Printer } from 'lucide-react';
import { exportDataToExcel, exportReportToPDF } from '../../lib/exportUtils';
import {
  CustomerFeedback,
  CustomerOrder,
  Department,
  FinancialTransaction,
  Meeting,
  UserAccount,
} from '../../types/domain';
import { DocumentPreviewModal } from '../shared/DocumentPreviewModal';
import { SearchFilterSortBar } from '../shared/SearchFilterSortBar';

interface ReportsAnalyticsProps {
  users: UserAccount[];
  meetings: Meeting[];
  orders: CustomerOrder[];
  feedback: CustomerFeedback[];
  departments: Department[];
  transactions?: FinancialTransaction[];
  onlineCount: number;
  showDemoDataDefault?: boolean;
}

const CHART_COLORS = ['#082B59', '#1178B9', '#087CEB', '#293858', '#d97706', '#64748b'];

export const ReportsAnalytics: React.FC<ReportsAnalyticsProps> = ({
  users,
  meetings,
  orders,
  feedback,
  departments,
  transactions = [],
  onlineCount,
  showDemoDataDefault = false,
}) => {
  const [range, setRange] = useState<'7d' | '30d' | 'all'>('30d');
  const [includeDemo, setIncludeDemo] = useState(showDemoDataDefault);
  const [showReportModal, setShowReportModal] = useState(false);

  const [metricSearch, setMetricSearch] = useState('');
  const [metricCatFilter, setMetricCatFilter] = useState('all');
  const [metricSortDir, setMetricSortDir] = useState<'asc' | 'desc'>('asc');

  const cutoffMs = useMemo(() => {
    if (range === 'all') return 0;
    const days = range === '7d' ? 7 : 30;
    return Date.now() - days * 24 * 3600_000;
  }, [range]);

  const filteredMeetings = useMemo(
    () => meetings.filter((m) => (includeDemo || !m.isDemo) && new Date(m.createdAt).getTime() >= cutoffMs),
    [meetings, includeDemo, cutoffMs]
  );

  const filteredOrders = useMemo(
    () => orders.filter((o) => (includeDemo || !o.isDemo) && new Date(o.createdAt).getTime() >= cutoffMs),
    [orders, includeDemo, cutoffMs]
  );

  const filteredTransactions = useMemo(
    () => transactions.filter((t) => (includeDemo || !t.isDemo) && new Date(t.createdAt).getTime() >= cutoffMs),
    [transactions, includeDemo, cutoffMs]
  );

  const filteredFeedback = useMemo(
    () => feedback.filter((f) => includeDemo || !f.isDemo),
    [feedback, includeDemo]
  );

  const filteredDepartments = useMemo(
    () => departments.filter((d) => includeDemo || !d.isDemo),
    [departments, includeDemo]
  );

  const totalRevenue = useMemo(
    () => filteredOrders.filter((o) => o.status !== 'cancelled').reduce((sum, o) => sum + o.total, 0),
    [filteredOrders]
  );

  const completedLedgerTotal = useMemo(
    () =>
      filteredTransactions
        .filter((t) => t.status === 'completed' && t.type !== 'refund')
        .reduce((sum, t) => sum + t.amount, 0),
    [filteredTransactions]
  );

  const meetingStatusData = useMemo(() => {
    const counts: Record<string, number> = { scheduled: 0, live: 0, ended: 0, cancelled: 0 };
    filteredMeetings.forEach((m) => {
      counts[m.status] = (counts[m.status] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [filteredMeetings]);

  const deptPerformanceData = useMemo(() => {
    return filteredDepartments.map((d) => ({
      name: d.code || d.name.slice(0, 12),
      employees: users.filter((u) => u.departmentId === d.id).length,
      meetings: filteredMeetings.filter((m) => m.departmentId === d.id).length,
    }));
  }, [filteredDepartments, users, filteredMeetings]);

  const userBreakdownData = useMemo(() => {
    const emp = users.filter((u) => u.accountType === 'employee').length;
    const cust = users.filter((u) => u.accountType === 'customer').length;
    const guest = users.filter((u) => u.accountType === 'external_guest').length;
    return [
      { name: 'Employees', value: emp },
      { name: 'Customers', value: cust },
      { name: 'External Guests', value: guest },
    ].filter((x) => x.value > 0);
  }, [users]);

  const metricRows = useMemo(() => {
    const all = [
      { metric: 'Total Registered Users', category: 'Identity', value: String(users.length) },
      { metric: 'Active Accounts', category: 'Identity', value: String(users.filter((u) => u.status === 'active').length) },
      { metric: 'Online Now (WebSocket)', category: 'Collaboration', value: String(onlineCount) },
      { metric: 'Meetings in Period', category: 'Collaboration', value: String(filteredMeetings.length) },
      { metric: 'Completed Meetings', category: 'Collaboration', value: String(filteredMeetings.filter((m) => m.status === 'ended').length) },
      { metric: 'Departments', category: 'Organization', value: String(filteredDepartments.length) },
      { metric: 'Customer Orders in Period', category: 'Commerce', value: String(filteredOrders.length) },
      { metric: 'Order Revenue Total (ETB)', category: 'Finance', value: totalRevenue.toFixed(2) },
      { metric: 'Completed Ledger Transactions', category: 'Finance', value: String(filteredTransactions.filter((t) => t.status === 'completed').length) },
      { metric: 'Settled Ledger Volume (ETB)', category: 'Finance', value: completedLedgerTotal.toFixed(2) },
      { metric: 'Open Support Feedback', category: 'Support', value: String(filteredFeedback.filter((f) => f.status !== 'resolved').length) },
    ];
    const term = metricSearch.trim().toLowerCase();
    return all
      .filter((r) => {
        if (metricCatFilter !== 'all' && r.category !== metricCatFilter) return false;
        if (term && !r.metric.toLowerCase().includes(term) && !r.category.toLowerCase().includes(term)) return false;
        return true;
      })
      .sort((a, b) =>
        metricSortDir === 'asc' ? a.metric.localeCompare(b.metric) : b.metric.localeCompare(a.metric)
      );
  }, [
    users,
    onlineCount,
    filteredMeetings,
    filteredDepartments,
    filteredOrders,
    totalRevenue,
    filteredTransactions,
    completedLedgerTotal,
    filteredFeedback,
    metricSearch,
    metricCatFilter,
    metricSortDir,
  ]);

  const handleExportPDF = () => {
    exportReportToPDF(
      'Enterprise Platform Analytics Report',
      `Filter Window: ${range.toUpperCase()} · Demo Data: ${includeDemo ? 'Included' : 'Excluded (Real Data Only)'}`,
      ['Metric', 'Category', 'Value'],
      metricRows.map((r) => [r.metric, r.category, r.value]),
      '7sunday-analytics-report.pdf'
    );
  };

  const handleExportExcel = () => {
    exportDataToExcel(
      'Analytics Summary',
      metricRows.map((r) => ({ Metric: r.metric, Category: r.category, Value: r.value })),
      '7sunday-analytics.xlsx'
    );
  };

  return (
    <div className="space-y-6">
      {/* Header, Demo Isolation Toggle & Exports */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-[#F3F5F8] dark:bg-slate-800">
            {(['7d', '30d', 'all'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`min-h-[36px] px-3 py-1.5 rounded-md text-xs font-medium ${
                  range === r ? 'bg-[#082B59] text-white shadow-sm' : 'text-[#293858] dark:text-slate-300'
                }`}
              >
                {r === '7d' ? 'Last 7 Days' : r === '30d' ? 'Last 30 Days' : 'All Time'}
              </button>
            ))}
          </div>

          <label className="inline-flex items-center gap-2 text-xs font-medium text-[#293858] dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={includeDemo}
              onChange={(e) => setIncludeDemo(e.target.checked)}
            />
            <span>Include Optional Demo Data</span>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowReportModal(true)}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
          >
            <Printer className="w-3.5 h-3.5 text-[#1178B9]" /> Print & Preview Report
          </button>
          <button
            type="button"
            onClick={handleExportPDF}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-medium hover:bg-[#EAF4FF] dark:hover:bg-slate-800"
          >
            <Download className="w-3.5 h-3.5 text-[#1178B9]" /> Export PDF
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            className="min-h-[40px] inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-[#1178B9] hover:bg-[#0D6096] text-white text-xs font-medium"
          >
            <Download className="w-3.5 h-3.5" /> Export Excel
          </button>
        </div>
      </div>

      {/* Live Database KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Total Users', value: users.length, sub: `${onlineCount} online now` },
          { label: 'Meetings', value: filteredMeetings.length, sub: `${filteredMeetings.filter((m) => m.status === 'ended').length} completed` },
          { label: 'Orders & Revenue', value: filteredOrders.length, sub: `ETB ${totalRevenue.toFixed(2)}` },
          { label: 'Ledger Volume', value: filteredTransactions.length, sub: `Settled ETB ${completedLedgerTotal.toFixed(2)}` },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">{kpi.label}</p>
            <p className="text-2xl font-bold text-[#082B59] dark:text-[#EAF4FF] tabular-nums">{kpi.value}</p>
            <p className="text-xs text-slate-500 tabular-nums">{kpi.sub}</p>
          </div>
        ))}
      </div>

      {/* Interactive Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Meetings by Status</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={meetingStatusData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" fill="#1178B9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Account Distribution</h3>
          <div className="h-64">
            {userBreakdownData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-400">No user records yet</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={userBreakdownData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label>
                    {userBreakdownData.map((entry, idx) => (
                      <Cell key={entry.name} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {deptPerformanceData.length > 0 && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 space-y-4">
          <h3 className="text-sm font-semibold text-[#15243A] dark:text-slate-100">Department Staffing & Meeting Volume</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={deptPerformanceData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="employees" name="Employees" fill="#082B59" radius={[4, 4, 0, 0]} />
                <Bar dataKey="meetings" name="Meetings" fill="#087CEB" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Searchable, Filterable, Sortable Metrics Summary Table */}
      <div className="space-y-3">
        <SearchFilterSortBar
          search={metricSearch}
          onSearchChange={setMetricSearch}
          searchPlaceholder="Search KPI metrics..."
          filters={[
            {
              label: 'Metric category filter',
              value: metricCatFilter,
              onChange: setMetricCatFilter,
              options: [
                { label: 'All Categories', value: 'all' },
                { label: 'Identity', value: 'Identity' },
                { label: 'Collaboration', value: 'Collaboration' },
                { label: 'Organization', value: 'Organization' },
                { label: 'Commerce', value: 'Commerce' },
                { label: 'Finance', value: 'Finance' },
                { label: 'Support', value: 'Support' },
              ],
            },
          ]}
          sortDir={metricSortDir}
          onToggleSortDir={() => setMetricSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
          resultCount={metricRows.length}
        />

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 dark:border-slate-800 bg-[#EAF4FF] dark:bg-slate-950 text-[#082B59] dark:text-slate-300">
              <tr>
                <th className="px-4 py-2.5 font-semibold">Metric</th>
                <th className="px-4 py-2.5 font-semibold">Category</th>
                <th className="px-4 py-2.5 font-semibold text-right">Real Database Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {metricRows.map((row) => (
                <tr key={row.metric} className="hover:bg-[#F5F8FC] dark:hover:bg-slate-800/40">
                  <td className="px-4 py-2.5 font-medium">{row.metric}</td>
                  <td className="px-4 py-2.5 text-slate-500">{row.category}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Printable Analytics Report Document Modal */}
      <DocumentPreviewModal
        open={showReportModal}
        title="Enterprise Platform Analytics Report"
        subtitle={`Window: ${range.toUpperCase()} · Generated ${new Date().toLocaleString()}`}
        badge={includeDemo ? 'INCLUDES DEMO' : 'LIVE DATA'}
        onClose={() => setShowReportModal(false)}
        onDownload={handleExportPDF}
        downloadLabel="Download PDF"
        onDownloadSecondary={handleExportExcel}
        downloadSecondaryLabel="Download Excel"
      >
        <table className="w-full text-left text-xs border border-slate-200 dark:border-slate-700">
          <thead className="bg-[#EAF4FF] dark:bg-slate-800 text-[#082B59] dark:text-slate-200">
            <tr>
              <th className="p-2.5">Metric</th>
              <th className="p-2.5">Category</th>
              <th className="p-2.5 text-right">Value</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {metricRows.map((row) => (
              <tr key={row.metric}>
                <td className="p-2.5 font-medium">{row.metric}</td>
                <td className="p-2.5">{row.category}</td>
                <td className="p-2.5 text-right font-semibold tabular-nums">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DocumentPreviewModal>
    </div>
  );
};
