import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { SERIES, AXIS, STACK_GAP, TOOLTIP_CLASS } from './chartTheme';

/**
 * When patients actually arrive, split walk-in against booked. [1.62.0]
 *
 * ── What it is for ──────────────────────────────────────────────────────────────────────────
 *
 * The clinic staffs the front desk evenly across the day and has never had a picture of when
 * people actually turn up. A queue that forms at 09:00 and clears by 11:00 is a rota problem, and
 * a rota problem is completely invisible in any figure aggregated to the day — which, until this
 * chart, was every figure the clinic had.
 *
 * The split matters as much as the total. Walk-ins are the half the clinic cannot move; bookings
 * are the half it can. A 12:00 peak made of bookings is a schedule to change, and the same peak
 * made of walk-ins is a desk to staff, and those are opposite responses to an identical bar.
 *
 * ── Stacked, and the empty hours are kept ───────────────────────────────────────────────────
 *
 * Stacked rather than grouped because the total per hour is the primary reading — "how busy was
 * 10am" — with the composition second. The SQL supplies every operating hour via generate_series,
 * so an hour with nobody in it draws as a zero rather than vanishing. That distinction is the
 * whole point of the chart: a gap at 11:00 and a quiet 11:00 look identical once the row is simply
 * absent, and only one of them is worth doing anything about.
 *
 * ── The seam between segments ───────────────────────────────────────────────────────────────
 *
 * A hairline in the surface colour separates the two segments, so a bar reads as two marks rather
 * than one bar that changes colour partway up. It is `var(--color-surface)` and not white because
 * the panel is near-black in dark mode, where a white seam would be a bright line ruled across
 * every bar.
 */

const HOUR_LABEL = (hour) => {
  const h = Number(hour);
  if (!Number.isFinite(h)) return '';
  const suffix = h < 12 ? 'am' : 'pm';
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${suffix}`;
};

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const total = Number(row.total) || 0;

  return (
    <div className={TOOLTIP_CLASS}>
      <p className="m-0 font-bold text-slate-900">{HOUR_LABEL(label)}</p>
      {total === 0 ? (
        // Said explicitly. An empty tooltip on a zero bar reads as a broken chart.
        <p className="m-0 text-slate-500">No arrivals this hour</p>
      ) : (
        <>
          <p className="m-0 font-semibold text-slate-700">
            {total} patient{total === 1 ? '' : 's'}
          </p>
          {/* Both series named in text, so identity never rests on colour alone — which matters
              for a green/blue pair, whose weakest separation axis is tritan. */}
          <p className="m-0 flex items-center gap-1.5 text-slate-600">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES.primary }} />
            Walk-in {row.walk_in}
          </p>
          <p className="m-0 flex items-center gap-1.5 text-slate-600">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: SERIES.secondary }} />
            Booked {row.online}
          </p>
        </>
      )}
    </div>
  );
};

const PeakHoursArrivalChart = ({ data }) => {
  const chartData = (data || []).map((row) => ({
    hour: Number(row.hour),
    walk_in: Number(row.walk_in) || 0,
    online: Number(row.online) || 0,
    total: Number(row.total) || 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={AXIS.grid} />
        <XAxis
          dataKey="hour"
          tickFormatter={HOUR_LABEL}
          tick={{ fontSize: 10, fontWeight: 600, fill: AXIS.label }}
          axisLine={false}
          tickLine={false}
          interval={0}
        />
        <YAxis
          tick={{ fontSize: 10, fill: AXIS.tick }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={32}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
        <Legend
          verticalAlign="top"
          height={26}
          iconType="circle"
          wrapperStyle={{ fontSize: 11, fontWeight: 600 }}
        />
        <Bar
          dataKey="walk_in"
          name="Walk-in"
          stackId="arrivals"
          fill={SERIES.primary}
          stroke={STACK_GAP.stroke}
          strokeWidth={STACK_GAP.strokeWidth}
          maxBarSize={38}
        />
        {/* Rounded ends on the TOP segment only — the corner belongs to the bar, not to the
            series, and rounding both would put a curve in the middle of a stack. */}
        <Bar
          dataKey="online"
          name="Booked"
          stackId="arrivals"
          fill={SERIES.secondary}
          stroke={STACK_GAP.stroke}
          strokeWidth={STACK_GAP.strokeWidth}
          radius={[4, 4, 0, 0]}
          maxBarSize={38}
        />
      </BarChart>
    </ResponsiveContainer>
  );
};

export default PeakHoursArrivalChart;
