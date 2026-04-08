import React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type DashboardSalesChartProps = {
  data: Array<{ name: string; sales: number }>;
};

export const DashboardSalesChart: React.FC<DashboardSalesChartProps> = ({ data }) => {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#5A5A40" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#5A5A40" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
        <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: '#5A5A40', fontSize: 12 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: '#5A5A40', fontSize: 12 }} />
        <Tooltip
          contentStyle={{ backgroundColor: '#fff', borderRadius: '16px', border: 'none', boxShadow: '0 10px 25px rgba(0,0,0,0.1)' }}
          itemStyle={{ color: '#5A5A40', fontWeight: 'bold' }}
        />
        <Area type="monotone" dataKey="sales" stroke="#5A5A40" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
      </AreaChart>
    </ResponsiveContainer>
  );
};