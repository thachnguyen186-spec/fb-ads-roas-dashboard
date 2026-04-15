'use client';

interface Props {
  roasMin: string;
  roasMax: string;
  onMinChange: (v: string) => void;
  onMaxChange: (v: string) => void;
  totalCount: number;
  filteredCount: number;
}

export default function RoasFilter({
  roasMin, roasMax, onMinChange, onMaxChange, totalCount, filteredCount,
}: Props) {
  return (
    <div className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4">
      <span className="text-sm font-medium text-slate-200">Filter by ROAS</span>

      <div className="flex items-center gap-2">
        <input
          type="number"
          min="0"
          step="0.1"
          placeholder="Min"
          value={roasMin}
          onChange={(e) => onMinChange(e.target.value)}
          className="w-20 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <span className="text-slate-500 text-sm">–</span>
        <input
          type="number"
          min="0"
          step="0.1"
          placeholder="Max"
          value={roasMax}
          onChange={(e) => onMaxChange(e.target.value)}
          className="w-20 px-2 py-1 bg-slate-800 border border-slate-700 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {(roasMin || roasMax) && (
        <button
          onClick={() => { onMinChange(''); onMaxChange(''); }}
          className="text-xs text-slate-500 hover:text-slate-300"
        >
          Clear
        </button>
      )}

      <span className="ml-auto text-xs text-slate-500">
        {filteredCount === totalCount
          ? `${totalCount} campaigns`
          : `${filteredCount} of ${totalCount} campaigns`}
      </span>
    </div>
  );
}
