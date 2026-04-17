import React, { useEffect, useRef, useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';

type DashboardSalesChartProps = {
  data: Array<{ name: string; sales: number }>;
};

export const DashboardSalesChart: React.FC<DashboardSalesChartProps> = ({ data }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chartSize, setChartSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const element = containerRef.current;
    if (!element) {
      return;
    }

    const updateSize = () => {
      const nextWidth = Math.floor(element.clientWidth);
      const nextHeight = Math.floor(element.clientHeight);
      setChartSize((prev) => {
        if (prev.width === nextWidth && prev.height === nextHeight) {
          return prev;
        }
        return { width: nextWidth, height: nextHeight };
      });
    };

    updateSize();

    const resizeObserver = new ResizeObserver(() => {
      updateSize();
    });
    resizeObserver.observe(element);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  const canRenderChart = chartSize.width > 0 && chartSize.height > 0;

  return (
    <div ref={containerRef} className="h-full w-full">
      {canRenderChart && (
        <AreaChart width={chartSize.width} height={chartSize.height} data={data}>
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
            formatter={(val: number) => [val.toFixed(2), 'sales']}
          />
          <Area type="monotone" dataKey="sales" stroke="#5A5A40" strokeWidth={3} fillOpacity={1} fill="url(#colorSales)" />
        </AreaChart>
      )}
    </div>
  );
};