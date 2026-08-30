import React from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LabelList,
} from 'recharts';
import { SEQUENTIAL, AXIS, TOOLTIP_CLASS } from './chartTheme';

/**
 * Turnaround per department, against the target. [1.62.0]
 *
 * ── What the two bars are ───────────────────────────────────────────────────────────────────
 *
 * Median and 90th percentile of the SAME measurement — payment to released report — so they share
 * a hue and differ only in lightness. Two categorical colours here would say they are independent
 * quantities, and they are two points on one distribution.
 *
 * The p90 is not decoration. A median hides its own tail by construction: a department can hold a
 * 36-minute median while one report in ten takes two hours, and it is that patient who telephones.
 * Showing only the median would let a department look healthy on precisely the days it is not.
 *
 * ── Why the target is a line and not a coloured bar ─────────────────────────────────────────
 *
 * Each department has its OWN target — 60 minutes for Laboratory, 30 for X-Ray — so a single
 * horizontal reference line across the chart would be wrong for two of the three. The target is
 * therefore plotted per category as its own dashed series, which puts each department's benchmark
 * directly above its own bars where the comparison is actually made.
 *
 * Recessive slate rather than amber or red: those are reserved in this app for states somebody has
 * to act on, and a target is a benchmark, not a problem. Where a department IS over its target,
 * the bar visibly passes the line — which is the comparison the chart exists to make, said in
 * geometry rather than in colour.
 *
 * ── Reading it without colour ───────────────────────────────────────────────────────────────
 *
 * The legend names all three, the tooltip names each value, and the median carries a direct label.
 * The chart is fully readable in greyscale, which for a green two-step palette is not optional.
 */

const ChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload || {};
  const target = row.target_minutes;
  const rate = row.within_target_rate;

  return (
    <div className={TOOLTIP_CLASS}>
      <p className="m-0 font-bold text-slate-900">{label}</p>
      <p className="m-0 text-slate-600">{row.released} report{row.released === 1 ? '' : 's'} released</p>
      <p className="m-0 mt-1 font-semibold text-slate-700">Median {row.median_turnaround_minutes} min</p>
      <p className="m-0 text-slate-500">90th percentile {row.p90_turnaround_minutes} min</p>
      {target != null && (
        <p className="m-0 mt-1 text-slate-500">
          Target {target} min
          {/* Null rather than zero when nothing could be measured — see the NULLIF in the SQL.
              "not measured" and "never hit the target" are different facts. */}
          {rate != null && <> — <span className="font-semibold text-slate-700">{rate}% within</span></>}
        </p>
      )}
    </div>
  );
};

const TurnaroundSlaChart = ({ data }) => {
  // Whether a benchmark exists at all. [1.63.0] With no `TURNAROUND_TARGETS` configured every
  // target is null, and rendering the series anyway would put "Target" in the legend pointing at
  // a line that is not drawn — a legend entry for a promise nobody made.
  const hasTargets = (data || []).some((row) => row.target_minutes != null);

  const chartData = (data || []).map((row) => ({
    ...row,
    median_turnaround_minutes: Number(row.median_turnaround_minutes) || 0,
    p90_turnaround_minutes: Number(row.p90_turnaround_minutes) || 0,
    target_minutes: row.target_minutes == null ? null : Number(row.target_minutes),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={chartData} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={AXIS.grid} />
        <XAxis
          dataKey="category_name"
          tick={{ fontSize: 11, fontWeight: 600, fill: AXIS.label }}
          axisLine={false}
          tickLine={false}
        />
        {/* ONE axis. Every series here is in minutes; a second scale would make the target line
            and the bars visually comparable while being numerically unrelated. */}
        <YAxis
          tick={{ fontSize: 10, fill: AXIS.tick }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
          width={40}
          label={{ value: 'minutes', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: AXIS.tick } }}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
        <Legend
          verticalAlign="top"
          height={28}
          iconType="circle"
          wrapperStyle={{ fontSize: 11, fontWeight: 600 }}
        />
        <Bar
          dataKey="median_turnaround_minutes"
          name="Median"
          fill={SEQUENTIAL.strong}
          radius={[4, 4, 0, 0]}
          maxBarSize={44}
        >
          {/* The median only. A number over every bar in a six-mark chart is noise; the p90 and the
              target are read off the axis and named in the tooltip. */}
          <LabelList
            dataKey="median_turnaround_minutes"
            position="top"
            style={{ fontSize: 10, fontWeight: 700, fill: AXIS.label }}
          />
        </Bar>
        <Bar
          dataKey="p90_turnaround_minutes"
          name="90th percentile"
          fill={SEQUENTIAL.soft}
          radius={[4, 4, 0, 0]}
          maxBarSize={44}
        />
        {hasTargets && (
          <Line
            dataKey="target_minutes"
            name="Target"
            stroke={AXIS.reference}
            strokeWidth={2}
            strokeDasharray="5 4"
            dot={{ r: 4, fill: AXIS.reference, strokeWidth: 0 }}
            activeDot={false}
            // A department with no target configured is a gap in the line rather than a drop to
            // zero — connectNulls would draw a benchmark nobody set.
            connectNulls={false}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  );
};

export default TurnaroundSlaChart;
