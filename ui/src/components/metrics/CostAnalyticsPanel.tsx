import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DollarSign, TrendingUp, TrendingDown, Download, Filter } from "lucide-react";
import { formatCost, formatNumber } from '@/lib/utils';

interface CostByProvider {
  provider: string;
  model: string;
  cost: number;
  requests: number;
  tokens: number;
}

interface CostAnalyticsPanelProps {
  totalCost: number;
  costByProvider: CostByProvider[];
  loading?: boolean;
}

export function CostAnalyticsPanel({ totalCost, costByProvider, loading = false }: CostAnalyticsPanelProps) {
  const [sortBy, setSortBy] = useState<'cost' | 'requests' | 'tokens'>('cost');

  // Sort providers by selected metric
  const sortedProviders = [...costByProvider].sort((a, b) => {
    if (sortBy === 'cost') return b.cost - a.cost;
    if (sortBy === 'requests') return b.requests - a.requests;
    return b.tokens - a.tokens;
  });

  const handleExport = () => {
    const csvContent = [
      ['Provider', 'Model', 'Cost', 'Requests', 'Tokens'].join(','),
      ...sortedProviders.map(p => [p.provider, p.model, p.cost, p.requests, p.tokens].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cost-analytics-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-xl border-2">
        <CardHeader className="bg-gradient-to-r from-green-500 to-emerald-500 text-white">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Cost Analytics
            </CardTitle>
            <Button size="sm" variant="outline" onClick={handleExport} className="bg-white/20 text-white">
              <Download className="h-4 w-4 mr-2" />
              Export
            </Button>
          </div>
          <CardDescription className="text-green-50">Total: {formatCost(totalCost)}</CardDescription>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="flex gap-2 mb-4">
            <Filter className="h-4 w-4 text-gray-500" />
            <span className="text-sm font-medium">Sort:</span>
            {(['cost', 'requests', 'tokens'] as const).map((sort) => (
              <Button key={sort} size="sm" variant={sortBy === sort ? 'default' : 'ghost'} onClick={() => setSortBy(sort)}>
                {sort}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            {sortedProviders.map((p, i) => (
              <div key={i} className="flex justify-between p-3 border rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                <div>
                  <div className="font-bold">{p.provider}</div>
                  <div className="text-sm text-gray-500">{p.model}</div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-green-600">{formatCost(p.cost)}</div>
                  <div className="text-xs text-gray-500">{formatNumber(p.requests)} req</div>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
