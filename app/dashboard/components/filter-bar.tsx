'use client';

type StatusFilter = 'all' | 'active' | 'inactive';

interface Props {
  // Campaign name search
  campaignName: string;
  onCampaignNameChange: (v: string) => void;
  // Status filter (active / inactive / all)
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  // App name dropdown
  appFilter: string;
  onAppFilterChange: (v: string) => void;
  appOptions: string[]; // unique app names
  // Account dropdown
  accountFilter: string;
  onAccountFilterChange: (v: string) => void;
  accountOptions: [string, string][]; // [account_id, account_name]
  // ROAS range
  roasMin: string; roasMax: string;
  onRoasMinChange: (v: string) => void; onRoasMaxChange: (v: string) => void;
  // Spend range
  spendMin: string; spendMax: string;
  onSpendMinChange: (v: string) => void; onSpendMaxChange: (v: string) => void;
  // Budget range
  budgetMin: string; budgetMax: string;
  onBudgetMinChange: (v: string) => void; onBudgetMaxChange: (v: string) => void;
  // Counts
  totalCount: number;
  filteredCount: number;
  onClearAll: () => void;
}

function RangeInputs({ label, min, max, onMin, onMax, step = '0.01', prefix }: {
  label: string; min: string; max: string;
  onMin: (v: string) => void; onMax: (v: string) => void;
  step?: string; prefix?: string;
}) {
  const cls = 'w-20 px-2 py-1 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs font-medium text-slate-600 whitespace-nowrap">{label}</span>
      <div className="flex items-center gap-1">
        {prefix && <span className="text-xs text-slate-400">{prefix}</span>}
        <input type="number" min="0" step={step} placeholder="Min" value={min} onChange={(e) => onMin(e.target.value)} className={cls} />
        <span className="text-slate-400 text-xs">–</span>
        <input type="number" min="0" step={step} placeholder="Max" value={max} onChange={(e) => onMax(e.target.value)} className={cls} />
      </div>
    </div>
  );
}

const selectCls = 'px-2 py-1.5 border border-slate-300 rounded-lg text-sm bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

export default function FilterBar({
  campaignName, onCampaignNameChange,
  statusFilter, onStatusFilterChange,
  appFilter, onAppFilterChange, appOptions,
  accountFilter, onAccountFilterChange, accountOptions,
  roasMin, roasMax, onRoasMinChange, onRoasMaxChange,
  spendMin, spendMax, onSpendMinChange, onSpendMaxChange,
  budgetMin, budgetMax, onBudgetMinChange, onBudgetMaxChange,
  totalCount, filteredCount, onClearAll,
}: Props) {
  const hasActiveFilters = campaignName || appFilter || accountFilter
    || roasMin || roasMax || spendMin || spendMax || budgetMin || budgetMax
    || statusFilter !== 'all';

  return (
    <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-col gap-2.5">
      {/* Row 1: text search + status filter + dropdowns */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-40">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 11A6 6 0 115 11a6 6 0 0112 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search campaign name…"
            value={campaignName}
            onChange={(e) => onCampaignNameChange(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-white border border-slate-300 rounded-lg text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>

        {/* Status toggle: All / Active / Inactive */}
        <div className="flex items-center rounded-lg border border-slate-300 overflow-hidden text-xs font-medium">
          {STATUS_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => onStatusFilterChange(value)}
              className={`px-2.5 py-1.5 transition-colors ${
                statusFilter === value
                  ? value === 'active'
                    ? 'bg-emerald-500 text-white'
                    : value === 'inactive'
                    ? 'bg-amber-500 text-white'
                    : 'bg-slate-600 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {appOptions.length > 0 && (
          <select value={appFilter} onChange={(e) => onAppFilterChange(e.target.value)} className={selectCls}>
            <option value="">All apps ({appOptions.length})</option>
            {appOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
        {accountOptions.length > 1 && (
          <select value={accountFilter} onChange={(e) => onAccountFilterChange(e.target.value)} className={selectCls}>
            <option value="">All accounts ({accountOptions.length})</option>
            {accountOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Row 2: range filters + clear + count */}
      <div className="flex flex-wrap items-center gap-3">
        <RangeInputs label="ROAS" min={roasMin} max={roasMax} onMin={onRoasMinChange} onMax={onRoasMaxChange} step="0.1" />
        <RangeInputs label="Spend" min={spendMin} max={spendMax} onMin={onSpendMinChange} onMax={onSpendMaxChange} prefix="$" />
        <RangeInputs label="Budget" min={budgetMin} max={budgetMax} onMin={onBudgetMinChange} onMax={onBudgetMaxChange} prefix="$" />
        <div className="ml-auto flex items-center gap-3">
          {hasActiveFilters && (
            <button onClick={onClearAll} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">
              Clear all
            </button>
          )}
          <span className="text-xs text-slate-400">
            {filteredCount === totalCount
              ? `${totalCount} campaigns`
              : `${filteredCount} of ${totalCount} campaigns`}
          </span>
        </div>
      </div>
    </div>
  );
}
