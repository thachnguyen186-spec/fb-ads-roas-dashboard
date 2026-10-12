/** FB's -50/-20/+20/+50% quick-adjust buttons (same labels and colors as the FB budget modal). */

const PCT_BUTTONS = [
  { label: '−50%', pct: -50, cls: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-100' },
  { label: '−20%', pct: -20, cls: 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' },
  { label: '+20%', pct: 20, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' },
  { label: '+50%', pct: 50, cls: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100' },
];

export default function TiktokBudgetPctButtons({ disabled, onPct }: { disabled: boolean; onPct: (pct: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {PCT_BUTTONS.map(({ label, pct, cls }) => (
        <button
          key={pct}
          onClick={() => onPct(pct)}
          disabled={disabled}
          className={`px-2 py-1 text-xs border rounded disabled:opacity-50 transition-colors ${cls}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
