import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, BarChart3, Activity, DollarSign } from "lucide-react";

interface ChartDataPoint {
  label: string;
  value: number;
  color?: string;
}

interface LineChartProps {
  title: string;
  description?: string;
  data: ChartDataPoint[];
  color?: string;
  height?: number;
}

export function MiniLineChart({ title, description, data, color = 'blue', height = 100 }: LineChartProps) {
  const maxValue = Math.max(...data.map(d => d.value), 1);
  const minValue = Math.min(...data.map(d => d.value), 0);
  const range = maxValue - minValue || 1;

  // Generate SVG path
  const points = data.map((point, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 100 - ((point.value - minValue) / range) * 100;
    return `${x},${y}`;
  });

  const pathData = `M ${points.join(' L ')}`;

  // Fill area under the curve
  const fillPath = `${pathData} L 100,100 L 0,100 Z`;

  const colorClasses = {
    blue: 'stroke-blue-500 fill-blue-500/20',
    green: 'stroke-green-500 fill-green-500/20',
    purple: 'stroke-purple-500 fill-purple-500/20',
    orange: 'stroke-orange-500 fill-orange-500/20',
    red: 'stroke-red-500 fill-red-500/20',
  };

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <TrendingUp className="h-4 w-4 text-green-500" />
        </div>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="relative" style={{ height: `${height}px` }}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="w-full h-full"
          >
            {/* Grid lines */}
            <line x1="0" y1="25" x2="100" y2="25" stroke="currentColor" strokeWidth="0.2" opacity="0.2" />
            <line x1="0" y1="50" x2="100" y2="50" stroke="currentColor" strokeWidth="0.2" opacity="0.2" />
            <line x1="0" y1="75" x2="100" y2="75" stroke="currentColor" strokeWidth="0.2" opacity="0.2" />

            {/* Area fill */}
            <path
              d={fillPath}
              className={colorClasses[color as keyof typeof colorClasses] || colorClasses.blue}
            />

            {/* Line */}
            <path
              d={pathData}
              fill="none"
              className={colorClasses[color as keyof typeof colorClasses]?.split(' ')[0]}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Data points */}
            {points.map((point, index) => {
              const [x, y] = point.split(',').map(Number);
              return (
                <circle
                  key={index}
                  cx={x}
                  cy={y}
                  r="2"
                  className={colorClasses[color as keyof typeof colorClasses]?.split(' ')[0]}
                  fill="currentColor"
                />
              );
            })}
          </svg>

          {/* Current value overlay */}
          {data.length > 0 && (
            <div className="absolute top-2 right-2 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm px-2 py-1 rounded text-xs font-bold border border-gray-200 dark:border-gray-700">
              {data[data.length - 1].value.toLocaleString()}
            </div>
          )}
        </div>

        {/* Stats row */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
          <div className="text-center p-2 bg-gray-50 dark:bg-gray-800 rounded">
            <div className="text-gray-500 dark:text-gray-400 font-medium">Max</div>
            <div className="font-bold">{maxValue.toLocaleString()}</div>
          </div>
          <div className="text-center p-2 bg-gray-50 dark:bg-gray-800 rounded">
            <div className="text-gray-500 dark:text-gray-400 font-medium">Avg</div>
            <div className="font-bold">
              {(data.reduce((sum, d) => sum + d.value, 0) / data.length).toFixed(0)}
            </div>
          </div>
          <div className="text-center p-2 bg-gray-50 dark:bg-gray-800 rounded">
            <div className="text-gray-500 dark:text-gray-400 font-medium">Min</div>
            <div className="font-bold">{minValue.toLocaleString()}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface BarChartProps {
  title: string;
  description?: string;
  data: ChartDataPoint[];
  height?: number;
  showValues?: boolean;
}

export function MiniBarChart({ title, description, data, height = 200, showValues = true }: BarChartProps) {
  const maxValue = Math.max(...data.map(d => d.value), 1);

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <BarChart3 className="h-4 w-4 text-blue-500" />
        </div>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="space-y-2" style={{ height: `${height}px`, overflowY: 'auto' }}>
          {data.map((item, index) => {
            const percentage = (item.value / maxValue) * 100;
            const colors = [
              'bg-blue-500',
              'bg-green-500',
              'bg-purple-500',
              'bg-orange-500',
              'bg-pink-500',
              'bg-teal-500',
              'bg-indigo-500',
              'bg-red-500',
            ];
            const color = item.color || colors[index % colors.length];

            return (
              <div key={index} className="group">
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-medium truncate flex-1 mr-2">{item.label}</span>
                  {showValues && (
                    <span className="font-bold text-gray-700 dark:text-gray-300">
                      {item.value.toLocaleString()}
                    </span>
                  )}
                </div>
                <div className="relative h-6 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${color} transition-all duration-500 rounded-full group-hover:opacity-90`}
                    style={{ width: `${percentage}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2">
                    <span className="text-xs font-bold text-white mix-blend-difference">
                      {percentage.toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface DonutChartProps {
  title: string;
  description?: string;
  data: ChartDataPoint[];
  centerLabel?: string;
  centerValue?: string;
}

export function DonutChart({ title, description, data, centerLabel, centerValue }: DonutChartProps) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  
  // Calculate segments
  let currentAngle = -90; // Start from top
  const segments = data.map((item) => {
    const percentage = (item.value / total) * 100;
    const angle = (percentage / 100) * 360;
    const startAngle = currentAngle;
    currentAngle += angle;

    return {
      ...item,
      percentage,
      startAngle,
      endAngle: currentAngle,
      angle,
    };
  });

  const colors = [
    'text-blue-500',
    'text-green-500',
    'text-purple-500',
    'text-orange-500',
    'text-pink-500',
    'text-teal-500',
  ];

  // SVG path calculation for donut segment
  const createArc = (startAngle: number, endAngle: number, innerRadius: number, outerRadius: number) => {
    const start = polarToCartesian(50, 50, outerRadius, endAngle);
    const end = polarToCartesian(50, 50, outerRadius, startAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';

    const innerStart = polarToCartesian(50, 50, innerRadius, endAngle);
    const innerEnd = polarToCartesian(50, 50, innerRadius, startAngle);

    return [
      'M', start.x, start.y,
      'A', outerRadius, outerRadius, 0, largeArcFlag, 0, end.x, end.y,
      'L', innerEnd.x, innerEnd.y,
      'A', innerRadius, innerRadius, 0, largeArcFlag, 1, innerStart.x, innerStart.y,
      'Z'
    ].join(' ');
  };

  const polarToCartesian = (centerX: number, centerY: number, radius: number, angleInDegrees: number) => {
    const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180.0;
    return {
      x: centerX + radius * Math.cos(angleInRadians),
      y: centerY + radius * Math.sin(angleInRadians),
    };
  };

  return (
    <Card className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">{title}</CardTitle>
          <Activity className="h-4 w-4 text-purple-500" />
        </div>
        {description && (
          <CardDescription className="text-xs">{description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <div className="relative w-full aspect-square max-w-[200px] mx-auto">
          <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
            {segments.map((segment, index) => (
              <path
                key={index}
                d={createArc(segment.startAngle, segment.endAngle, 30, 45)}
                className={`${segment.color || colors[index % colors.length]} fill-current hover:opacity-80 transition-opacity cursor-pointer`}
                strokeWidth="0.5"
                stroke="white"
              />
            ))}
          </svg>

          {/* Center label */}
          {(centerLabel || centerValue) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {centerValue && (
                <div className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                  {centerValue}
                </div>
              )}
              {centerLabel && (
                <div className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                  {centerLabel}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-4 space-y-1">
          {segments.map((segment, index) => (
            <div key={index} className="flex items-center justify-between text-xs group cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 p-1 rounded transition-colors">
              <div className="flex items-center gap-2 flex-1">
                <div className={`w-3 h-3 rounded-full ${segment.color || colors[index % colors.length]} bg-current`} />
                <span className="font-medium truncate">{segment.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-700 dark:text-gray-300">
                  {segment.percentage.toFixed(1)}%
                </span>
                <span className="text-gray-500 dark:text-gray-400">
                  ({segment.value.toLocaleString()})
                </span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface SparklineProps {
  data: number[];
  color?: string;
  height?: number;
  showLastValue?: boolean;
}

export function Sparkline({ data, color = 'blue', height = 40, showLastValue = true }: SparklineProps) {
  if (data.length === 0) return null;

  const maxValue = Math.max(...data, 1);
  const minValue = Math.min(...data, 0);
  const range = maxValue - minValue || 1;

  const points = data.map((value, index) => {
    const x = (index / (data.length - 1)) * 100;
    const y = 100 - ((value - minValue) / range) * 100;
    return `${x},${y}`;
  });

  const pathData = `M ${points.join(' L ')}`;
  const lastValue = data[data.length - 1];
  const trend = data.length > 1 ? lastValue - data[data.length - 2] : 0;

  const colorClasses = {
    blue: 'stroke-blue-500',
    green: 'stroke-green-500',
    red: 'stroke-red-500',
    purple: 'stroke-purple-500',
    orange: 'stroke-orange-500',
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="inline-block"
        style={{ width: '80px', height: `${height}px` }}
      >
        <path
          d={pathData}
          fill="none"
          className={colorClasses[color as keyof typeof colorClasses] || colorClasses.blue}
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {showLastValue && (
        <div className="text-sm font-bold flex items-center gap-1">
          <span>{lastValue.toLocaleString()}</span>
          {trend !== 0 && (
            <span className={trend > 0 ? 'text-green-500' : 'text-red-500'}>
              {trend > 0 ? '↑' : '↓'}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export { Activity, BarChart3, DollarSign, TrendingUp };
