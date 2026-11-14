import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Activity, Info, RefreshCw, TrendingUp } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { apiFetch } from '../lib/api';

export function AiInsightsView() {
  const { token } = useAuth();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const loadInsights = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await apiFetch('/api/admin/ai-insights', { token });
      setData(res);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInsights();
  }, [token]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 bg-slate-200 rounded animate-pulse" />
        <div className="h-64 bg-white rounded-xl border border-slate-200 animate-pulse" />
      </div>
    );
  }

  const recorded = data?.recordedFacts || {};
  const predictions = data?.aiPredictions || {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-[#0F172A]">
            AI Intelligence & Predictive Insights
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Distinguishes verified PostgreSQL telemetry from AI-generated pattern detection and forecasts.
          </p>
        </div>
        <button
          type="button"
          onClick={loadInsights}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-[#0F172A]"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Regenerate AI Insights
        </button>
      </div>

      {predictions.isDemoMode && (
        <div className="p-4 rounded-xl border border-[#FDE68A] bg-[#FFFBEB] flex items-start gap-3">
          <Info className="w-4 h-4 text-[#D97706] shrink-0 mt-0.5" />
          <div className="text-xs text-[#92400E]">
            <span className="font-semibold">Demo Mode Insights:</span> GEMINI_API_KEY is not configured; rule-based analytical projections are shown alongside real recorded counts.
          </div>
        </div>
      )}

      {/* SECTION 1: RECORDED DATABASE TELEMETRY */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-[#0F172A]">
          <Activity className="w-4 h-4 text-[#16A34A]" />
          Verified Recorded Telemetry (PostgreSQL Facts)
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl border border-slate-200 bg-white">
            <div className="text-xs text-slate-500">Total Recorded Complaints</div>
            <div className="mt-1.5 font-mono text-2xl font-bold text-[#0F172A] tabular-nums">
              {recorded.totalComplaints ?? 0}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 bg-white">
            <div className="text-xs text-slate-500">Top Category</div>
            <div className="mt-1.5 text-base font-bold text-[#0F172A] truncate">
              {recorded.topCategories?.[0]?.name || 'None yet'}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 bg-white">
            <div className="text-xs text-slate-500">AI Decisions Logged</div>
            <div className="mt-1.5 font-mono text-2xl font-bold text-[#2563EB] tabular-nums">
              {recorded.aiDecisionsLogged ?? 0}
            </div>
          </div>
          <div className="p-4 rounded-xl border border-slate-200 bg-white">
            <div className="text-xs text-slate-500">Admin Overrides</div>
            <div className="mt-1.5 font-mono text-2xl font-bold text-[#D97706] tabular-nums">
              {recorded.adminOverrides ?? 0}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="p-6 rounded-xl border border-slate-200 bg-white">
            <h3 className="text-sm font-semibold text-[#0F172A] mb-4">Recorded Sentiment Distribution</h3>
            {recorded.sentimentBreakdown?.length > 0 ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={recorded.sentimentBreakdown}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                    <XAxis dataKey="sentiment" tick={{ fontSize: 11, fill: '#475569' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#0F172A" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="h-56 flex items-center justify-center text-xs text-slate-500">
                No sentiment telemetry recorded yet.
              </div>
            )}
          </div>

          <div className="p-6 rounded-xl border border-slate-200 bg-white">
            <h3 className="text-sm font-semibold text-[#0F172A] mb-4">Most Common Categories (Recorded)</h3>
            {recorded.topCategories?.length > 0 ? (
              <div className="space-y-3">
                {recorded.topCategories.slice(0, 6).map((cat: any) => (
                  <div key={cat.name} className="flex items-center justify-between text-xs border-b border-slate-100 pb-2">
                    <span className="font-medium text-[#0F172A]">{cat.name}</span>
                    <span className="font-mono font-semibold text-[#2563EB] tabular-nums">{cat.count}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-56 flex items-center justify-center text-xs text-slate-500">
                No category counts recorded yet.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* SECTION 2: AI-GENERATED PREDICTIONS & RECOMMENDATIONS */}
      <div className="space-y-4 pt-2 border-t border-slate-200">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#2563EB]">
            <TrendingUp className="w-4 h-4" />
            AI-Generated Predictions & Operational Guidance ({predictions.modelUsed})
          </div>
          <span className="text-[11px] text-slate-500">
            Advisory model output — clearly separated from recorded telemetry
          </span>
        </div>

        <div className="p-5 rounded-xl border border-slate-200 bg-white text-sm text-[#0F172A]">
          <div className="text-xs font-semibold text-slate-500 mb-1">Sentiment Trend Synthesis</div>
          <p>{predictions.sentimentSummary}</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-3">
            <h3 className="text-sm font-semibold text-[#0F172A]">Recurring Issue Clusters</h3>
            <ul className="list-disc pl-4 space-y-2 text-xs text-slate-700 leading-relaxed">
              {(predictions.recurringPatterns || []).map((item: string, i: number) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="p-6 rounded-xl border border-slate-200 bg-white space-y-3">
            <h3 className="text-sm font-semibold text-[#0F172A]">Predicted Complaint Trends</h3>
            <ul className="list-disc pl-4 space-y-2 text-xs text-slate-700 leading-relaxed">
              {(predictions.predictedTrends || []).map((item: string, i: number) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="p-6 rounded-xl border border-slate-200 bg-[#0F172A] text-white space-y-3">
            <h3 className="text-sm font-semibold">Suggested Operational Improvements</h3>
            <ul className="list-disc pl-4 space-y-2 text-xs text-slate-300 leading-relaxed">
              {(predictions.operationalRecommendations || []).map((item: string, i: number) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
