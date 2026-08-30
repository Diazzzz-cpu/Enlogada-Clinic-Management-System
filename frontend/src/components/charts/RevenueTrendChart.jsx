import React from 'react';
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { formatCurrency } from '../../lib/currency';
import { AXIS } from './chartTheme';

// paid_at::date comes back from pg as a native Date; over JSON that serializes to a full ISO
// datetime string. `new Date(day)` alone parses either that or a bare YYYY-MM-DD.
const formatDay = (day) => new Date(day).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

const compactCurrency = (value) => (
  value >= 1000 ? `₱${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k` : `₱${value}`
);

/**
 * Tooltip. Names the previous period's DATE as well as its figure when an overlay is present.
 *
 * Without that date the comparison is unreadable: the two series share an x position by
 * POSITION IN THE PERIOD, not by date, so the point sitting under "Aug 3" is some day in July and
 * the reader has no way to know which. A comparison whose second value cannot be located is a
 * decoration.
 */
const ChartTooltip = ({ active, payload, label, hasComparison }) => {
  if (!active || !payload?.length) return null;
  const current = payload.find((p) => p.dataKey === 'total');
  const previous = payload.find((p) => p.dataKey === 'previousTotal');
  const previousDay = previous?.payload?.previousDay;

  return (
    <div className="bg-surface border border-line rounded-lg shadow-float px-3 py-2 text-xs">
      <p className="font-bold text-slate-900 m-0">{formatDay(label)}</p>
      <p className="text-brand-600 font-semibold m-0">{formatCurrency(current?.value ?? 0)}</p>
      {hasComparison && (
        <p className="m-0 mt-0.5 text-slate-500">
          {previousDay ? formatDay(previousDay) : 'Previous'}:{' '}
          <span className="font-semibold text-slate-600">{formatCurrency(previous?.value ?? 0)}</span>
        </p>
      )}
    </div>
  );
};

/**
 * Daily takings, optionally with the previous period drawn behind. [1.62.0]
 *
 * ── The two series are aligned by POSITION, not by date ─────────────────────────────────────
 *
 * This is the one genuinely tricky decision here. The comparison a clinic wants is "the first
 * Monday of this period against the first Monday of the last one" — day 1 against day 1 — and the
 * two periods have, by construction, entirely different dates. So the previous period is zipped
 * onto the current period's x axis by index.
 *
 * That makes the x axis mean "day N of the selected period", and the previous series' real date
 * would otherwise be lost. It is therefore carried through as `previousDay` and named in the
 * tooltip, so the reader can always find out which day they are actually looking at.
 *
 * A shorter previous period simply runs out and the line stops — `connectNulls` is off, so a
 * missing day is a gap rather than a straight line drawn through data that does not exist.
 *
 * ── Why the previous period is a plain dashed line ──────────────────────────────────────────
 *
 * It is a BASELINE, not a peer. Giving it a second brand hue and its own filled area would put
 * two equal-weight series on the chart and make the current period harder to read, which is
 * backwards — the reader came to see this period. Recessive slate, dashed, no fill, no dots: it
 * recedes, and the shape comparison still works because shape is what a trend overlay is for.
 *
 * A legend appears only when the overlay does. One series needs no legend box — the panel title
 * already names it — and an always-present legend saying "Collected" alone is furniture.
 */
const RevenueTrendChart = ({ data, previous = null }) => {
  const previousRows = Array.isArray(previous) ? previous : [];
  const hasComparison = previousRows.length > 0;

  const chartData = (data || []).map((row, index) => {
    const prior = previousRows[index];
    return {
      day: row.day,
      total: parseFloat(row.total),
      // `null`, not 0, where the previous period has no matching day: a zero would draw the line
      // down to the axis and claim the clinic took nothing that day.
      previousTotal: prior ? parseFloat(prior.total) : null,
      previousDay: prior ? prior.day : null,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueTrendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#53843b" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#53843b" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
        <XAxis
          dataKey="day"
          tickFormatter={formatDay}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={{ stroke: '#e5e7eb' }}
          tickLine={false}
        />
        {/* ONE axis, always. Both series are pesos; a second scale would let a quiet period look
            identical to a busy one, which is the exact comparison this chart exists to prevent. */}
        <YAxis
          tickFormatter={compactCurrency}
          tick={{ fontSize: 10, fill: '#94a3b8' }}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          content={<ChartTooltip hasComparison={hasComparison} />}
          cursor={{ stroke: '#53843b', strokeWidth: 1, strokeDasharray: '3 3' }}
        />
        {hasComparison && (
          <Legend verticalAlign="top" height={26} iconType="plainline" wrapperStyle={{ fontSize: 11, fontWeight: 600 }} />
        )}
        {/* Drawn FIRST so the current period sits on top of it. */}
        {hasComparison && (
          <Line
            type="monotone"
            dataKey="previousTotal"
            name="Previous period"
            stroke={AXIS.reference}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={false}
            activeDot={{ r: 4 }}
            connectNulls={false}
          />
        )}
        <Area
          type="monotone"
          dataKey="total"
          name="This period"
          stroke="#53843b"
          strokeWidth={2}
          fill="url(#revenueTrendFill)"
          dot={{ r: 3, fill: '#53843b', strokeWidth: 0 }}
          activeDot={{ r: 5 }}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
};

export default RevenueTrendChart;
