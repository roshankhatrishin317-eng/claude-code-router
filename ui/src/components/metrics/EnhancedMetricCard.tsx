import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, TrendingUp, TrendingDown, Info } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
    label?: string;
  };
  color?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple' | 'orange';
  loading?: boolean;
  className?: string;
  badge?: {
    text: string;
    variant: 'default' | 'success' | 'warning' | 'error';
  };
  tooltip?: string;
  onClick?: () => void;
  size?: 'sm' | 'md' | 'lg';
}

const colorSchemes = {
  default: {
    bg: 'bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-50 dark:from-slate-900 dark:via-gray-900 dark:to-zinc-900',
    border: 'border-slate-200/50 dark:border-slate-700/50',
    shadow: 'shadow-slate-100/50 dark:shadow-slate-800/50',
    icon: 'text-slate-600 bg-slate-100/80 dark:text-slate-400 dark:bg-slate-800/80',
    text: 'text-slate-900 dark:text-slate-100',
  },
  success: {
    bg: 'bg-gradient-to-br from-emerald-50 via-green-50 to-teal-50 dark:from-emerald-950 dark:via-green-950 dark:to-teal-950',
    border: 'border-emerald-200/50 dark:border-emerald-800/50',
    shadow: 'shadow-emerald-100/50 dark:shadow-emerald-900/50',
    icon: 'text-emerald-600 bg-emerald-100/80 dark:text-emerald-400 dark:bg-emerald-900/80',
    text: 'text-emerald-900 dark:text-emerald-100',
  },
  warning: {
    bg: 'bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-50 dark:from-amber-950 dark:via-yellow-950 dark:to-orange-950',
    border: 'border-amber-200/50 dark:border-amber-800/50',
    shadow: 'shadow-amber-100/50 dark:shadow-amber-900/50',
    icon: 'text-amber-600 bg-amber-100/80 dark:text-amber-400 dark:bg-amber-900/80',
    text: 'text-amber-900 dark:text-amber-100',
  },
  error: {
    bg: 'bg-gradient-to-br from-rose-50 via-red-50 to-pink-50 dark:from-rose-950 dark:via-red-950 dark:to-pink-950',
    border: 'border-rose-200/50 dark:border-rose-800/50',
    shadow: 'shadow-rose-100/50 dark:shadow-rose-900/50',
    icon: 'text-rose-600 bg-rose-100/80 dark:text-rose-400 dark:bg-rose-900/80',
    text: 'text-rose-900 dark:text-rose-100',
  },
  info: {
    bg: 'bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-50 dark:from-sky-950 dark:via-blue-950 dark:to-indigo-950',
    border: 'border-sky-200/50 dark:border-sky-800/50',
    shadow: 'shadow-sky-100/50 dark:shadow-sky-900/50',
    icon: 'text-sky-600 bg-sky-100/80 dark:text-sky-400 dark:bg-sky-900/80',
    text: 'text-sky-900 dark:text-sky-100',
  },
  purple: {
    bg: 'bg-gradient-to-br from-purple-50 via-violet-50 to-fuchsia-50 dark:from-purple-950 dark:via-violet-950 dark:to-fuchsia-950',
    border: 'border-purple-200/50 dark:border-purple-800/50',
    shadow: 'shadow-purple-100/50 dark:shadow-purple-900/50',
    icon: 'text-purple-600 bg-purple-100/80 dark:text-purple-400 dark:bg-purple-900/80',
    text: 'text-purple-900 dark:text-purple-100',
  },
  orange: {
    bg: 'bg-gradient-to-br from-orange-50 via-red-50 to-pink-50 dark:from-orange-950 dark:via-red-950 dark:to-pink-950',
    border: 'border-orange-200/50 dark:border-orange-800/50',
    shadow: 'shadow-orange-100/50 dark:shadow-orange-900/50',
    icon: 'text-orange-600 bg-orange-100/80 dark:text-orange-400 dark:bg-orange-900/80',
    text: 'text-orange-900 dark:text-orange-100',
  },
};

const sizeClasses = {
  sm: {
    card: 'p-3',
    icon: 'h-4 w-4 p-1.5',
    title: 'text-xs',
    value: 'text-xl',
    subtitle: 'text-xs',
  },
  md: {
    card: 'p-4',
    icon: 'h-5 w-5 p-2',
    title: 'text-sm',
    value: 'text-3xl',
    subtitle: 'text-xs',
  },
  lg: {
    card: 'p-6',
    icon: 'h-6 w-6 p-2.5',
    title: 'text-base',
    value: 'text-4xl',
    subtitle: 'text-sm',
  },
};

export function EnhancedMetricCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  color = 'default',
  loading = false,
  className,
  badge,
  tooltip,
  onClick,
  size = 'md',
}: MetricCardProps) {
  const scheme = colorSchemes[color];
  const sizeClass = sizeClasses[size];

  return (
    <Card
      className={cn(
        "group relative overflow-hidden transition-all duration-500 hover:shadow-2xl hover:scale-[1.02] hover:-translate-y-1",
        scheme.bg,
        scheme.border,
        scheme.shadow,
        "border backdrop-blur-sm animate-fade-in cursor-pointer",
        onClick && "cursor-pointer",
        className
      )}
      onClick={onClick}
      title={tooltip}
    >
      {/* Animated gradient overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-white/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 dark:from-white/10" />
      
      {/* Shimmer effect */}
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000 bg-gradient-to-r from-transparent via-white/30 to-transparent dark:via-white/10" />
      
      <CardHeader className={cn("relative flex flex-row items-center justify-between space-y-0 pb-2", sizeClass.card)}>
        <div className="flex items-center gap-2 flex-1">
          <div className={cn(
            "rounded-xl transition-all duration-300 group-hover:scale-110 group-hover:rotate-6 shadow-lg",
            scheme.icon,
            sizeClass.icon
          )}>
            {icon}
          </div>
          <div className="flex-1">
            <CardTitle className={cn("font-semibold tracking-tight", scheme.text, sizeClass.title)}>
              {title}
            </CardTitle>
            {badge && (
              <span className={cn(
                "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold mt-1",
                badge.variant === 'success' && "bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300",
                badge.variant === 'warning' && "bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300",
                badge.variant === 'error' && "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300",
                badge.variant === 'default' && "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300"
              )}>
                {badge.text}
              </span>
            )}
          </div>
        </div>
        {loading ? (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
            <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Loading</span>
          </div>
        ) : trend ? (
          <div className={cn(
            "flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full",
            trend.isPositive
              ? 'bg-green-100 text-green-700 border border-green-200 dark:bg-green-900 dark:text-green-300 dark:border-green-800'
              : 'bg-red-100 text-red-700 border border-red-200 dark:bg-red-900 dark:text-red-300 dark:border-red-800'
          )}>
            {trend.isPositive ? (
              <TrendingUp className="h-3.5 w-3.5" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5" />
            )}
            {Math.abs(trend.value)}%
          </div>
        ) : tooltip ? (
          <Info className="h-4 w-4 text-gray-400 dark:text-gray-600" />
        ) : null}
      </CardHeader>
      
      <CardContent className="relative">
        {loading ? (
          <div className="space-y-2 animate-pulse">
            <div className="h-7 w-24 rounded-md bg-gray-300/60 dark:bg-gray-700/60" />
            {subtitle && <div className="h-3 w-40 rounded-md bg-gray-200/60 dark:bg-gray-800/60" />}
          </div>
        ) : (
          <>
            <div className={cn(
              "font-bold mb-1 tracking-tight bg-gradient-to-br from-gray-900 to-gray-600 dark:from-gray-100 dark:to-gray-400 bg-clip-text text-transparent",
              sizeClass.value
            )}>
              {value}
            </div>
            {subtitle && (
              <p className={cn("opacity-70 font-medium", scheme.text, sizeClass.subtitle)}>
                {subtitle}
              </p>
            )}
            {trend?.label && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-medium">
                {trend.label}
              </p>
            )}
          </>
        )}
      </CardContent>
      
      {/* Decorative gradient orbs */}
      <div className="absolute -top-10 -right-10 w-32 h-32 bg-gradient-to-br from-white/30 to-transparent rounded-full blur-2xl opacity-50 group-hover:opacity-70 transition-opacity duration-500 dark:from-white/10" />
      <div className="absolute -bottom-10 -left-10 w-32 h-32 bg-gradient-to-tr from-white/20 to-transparent rounded-full blur-2xl opacity-30 group-hover:opacity-50 transition-opacity duration-500 dark:from-white/10" />
    </Card>
  );
}
