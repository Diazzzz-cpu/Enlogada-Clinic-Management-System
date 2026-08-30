import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

// Shared Prev/Next pagination footer — UI/UX Phase 2 (Findability). Deliberately minimal
// (no page-number buttons) since every current consumer has few enough pages that a numbered
// strip would be over-engineering; revisit if a future table needs jump-to-page.
//
// Pass `total` and `pageSize` and this shows the RANGE — "Showing 1–15 of 42". Several screens
// put the count in their PageHeader as well, so a footer reading "42 total" was the same number
// twice within one screenful, saying nothing the header had not. The range is the thing only the
// footer knows: which slice of the list you are actually looking at.
//
// `totalLabel` stays for callers with nothing better to say, and for lists whose total is not a
// simple row count.
const Pagination = ({ page, totalPages, onPageChange, totalLabel, total, pageSize, className = '' }) => {
  const hasRange = Number.isFinite(total) && Number.isFinite(pageSize) && total > 0;
  const first = hasRange ? (page - 1) * pageSize + 1 : 0;
  const last = hasRange ? Math.min(page * pageSize, total) : 0;
  const label = hasRange
    // No range when it is the whole list: "Showing 1–2 of 2" is a longer way of writing "2".
    ? (total <= pageSize ? `${total} total` : `Showing ${first}–${last} of ${total}`)
    : totalLabel;

  if (totalPages <= 1 && !label) return null;

  return (
    <div className={`flex items-center justify-between px-4 py-3 border-t border-line ${className}`}>
      <span className="text-fine font-semibold text-gray-400">{label}</span>
      <div className="flex items-center space-x-2">
        <button
          type="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent cursor-pointer transition-colors"
          aria-label="Previous page"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
        <span className="text-fine font-bold text-gray-600 whitespace-nowrap">
          Page {page} of {totalPages || 1}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages}
          className="p-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-slate-900 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent cursor-pointer transition-colors"
          aria-label="Next page"
        >
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
};

export default Pagination;
