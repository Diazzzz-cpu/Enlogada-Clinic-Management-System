import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { categoryColor } from '../../lib/categories';

// Colour is keyed to the CATEGORY, not to its position in the array, and the map itself now
// lives in lib/categories so the public Services page paints the same five things the same way.
//
// Two defects that keying fixed. The list held four colours and was indexed with
// `index % length`, but test_categories has five rows — so the fifth category rendered in the
// first one's exact green, and the chart showed two different services as the same colour with
// nothing to tell them apart. And keying on array position meant colour followed rank rather
// than identity: a quiet week where one category recorded no tests dropped it from the response
// and repainted every survivor, so Laboratory was green on Monday and blue on Tuesday. A reader
// who has learned the colours is worse off than one who never trusted them.
//
// Verified with the dataviz palette validator (light surface): lightness band, chroma floor,
// contrast and CVD separation all pass, worst adjacent pair deltaE 15.0 under deuteranopia
// against a target of 8.

const ChartTooltip = ({ active, payload }) => {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  return (
    <div className="bg-surface border border-line rounded-lg shadow-float px-3 py-2 text-xs">
      <p className="font-bold text-slate-900 m-0">{point.payload.category_name}</p>
      <p className="text-gray-600 m-0">{point.value} test{point.value === 1 ? '' : 's'}</p>
    </div>
  );
};

// Categorical horizontal bar — replaces the hand-rolled single-color (indigo) progress-bar
// list in ReportsOverview.jsx, giving each category its own color instead of one flat hue.
const CategoryVolumeChart = ({ data }) => {
  const chartData = data.map((row) => ({
    category_name: row.category_name,
    test_count: parseInt(row.test_count, 10),
  }));
  const height = Math.max(140, chartData.length * 44);

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 32, left: 0, bottom: 4 }} barCategoryGap={14}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
        <XAxis type="number" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="category_name"
          tick={{ fontSize: 11, fontWeight: 600, fill: '#475569' }}
          axisLine={false}
          tickLine={false}
          width={90}
        />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f8fafc' }} />
        <Bar dataKey="test_count" radius={[0, 6, 6, 0]} maxBarSize={22}>
          {chartData.map((entry) => (
            <Cell
              key={entry.category_name}
              fill={categoryColor(entry.category_name)}
            />
          ))}
          {/* The count, at the end of its own bar. Five bars is few enough that labelling each
              is not clutter, and the exact figure was otherwise reachable only by hovering —
              which is no help at all on this screen, because it carries a Print Reports button
              and a printed chart has no hover. A reader with the sheet in their hand could see
              that Laboratory ran the most and not what "the most" was.

              Slate ink rather than the bar's colour: text wears text tokens, so the coloured
              mark carries the identity and the number stays legible against the page. */}
          <LabelList
            dataKey="test_count"
            position="right"
            offset={8}
            style={{ fontSize: 11, fontWeight: 700, fill: '#475569' }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
};

export default CategoryVolumeChart;
