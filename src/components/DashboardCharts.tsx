// ================================================
// FILE: src/components/DashboardCharts.tsx
// Graphiques du Tableau de bord, chargés à part : la bibliothèque de graphiques (recharts,
// ~370 Ko) n'est plus nécessaire pour afficher les cartes, qui apparaissent tout de suite.
// ================================================
import React from 'react';
import {
  ResponsiveContainer, Tooltip as RechartsTooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, AreaChart, Area, LabelList,
} from 'recharts';
import { SavingsAccount } from '../types';
import { formatEUR } from '../lib/format';
import { useIsDark, chartTheme } from '../lib/chartTheme';

// Un point du graphique empilé : la date, puis le solde de chaque compte (clé = id du compte).
export type StackedPoint = { date: string; displayDate: string; total?: number; [accountId: string]: string | number | undefined };

interface StackedProps {
  stackedData: StackedPoint[];
  accounts: SavingsAccount[];
  getAccountColor: (id: string) => string;
  isConstrainedAccount: (type: SavingsAccount['type']) => boolean;
}

export const StackedSavingsChart: React.FC<StackedProps> = ({ stackedData, accounts, getAccountColor, isConstrainedAccount }) => {
  const t = chartTheme(useIsDark());
  return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={stackedData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              {accounts.map(acc => {
                const color = getAccountColor(acc.id);
                return (
                  <React.Fragment key={acc.id}>
                    <linearGradient id={`color-${acc.id}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={color} stopOpacity={0.8}/>
                      <stop offset="95%" stopColor={color} stopOpacity={0.1}/>
                    </linearGradient>
                    <pattern id={`stripe-${acc.id}`} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
                       <rect width="100%" height="100%" fill="white" fillOpacity="0" />
                       <path d="M 0 0 L 0 8" stroke={color} strokeWidth="3" strokeOpacity="0.5" />
                       <rect width="100%" height="100%" fill={color} fillOpacity="0.1" /> 
                    </pattern>
                  </React.Fragment>
                );
              })}
            </defs>
            <XAxis dataKey="displayDate" tick={{ fontSize: 11, fill: t.tick }} stroke={t.grid} minTickGap={30} />
            <YAxis tickFormatter={(val) => `${(val / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`} tick={{ fontSize: 11, fill: t.tick }} stroke={t.grid} width={52} />
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={t.grid} />
            <RechartsTooltip content={({ active, payload, label }) => {
              if (!active || !payload) return null;
              // Comptes à 0 € masqués, du plus gros au plus petit.
              const rows = payload.filter(p => Number(p.value) > 0.5).sort((a, b) => Number(b.value) - Number(a.value));
              const total = rows.reduce((sum, p) => sum + Number(p.value), 0);
              return (
                <div style={{ borderRadius: 12, background: t.tooltipBg, color: t.tooltipText, padding: '8px 12px', fontSize: 12, boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}>
                  <p style={{ color: t.tooltipLabel, fontWeight: 700, marginBottom: 4 }}>{label}</p>
                  {rows.map(p => (
                    <p key={String(p.dataKey)} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                      <span><span style={{ color: p.color }}>●</span> {accounts.find(a => a.id === p.dataKey)?.name || String(p.dataKey)}</span>
                      <b>{formatEUR(Number(p.value), 0)}</b>
                    </p>
                  ))}
                  {rows.length > 1 && <p style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderTop: `1px solid ${t.tooltipLabel}`, marginTop: 4, paddingTop: 4 }}><span>Total</span><b>{formatEUR(total, 0)}</b></p>}
                </div>
              );
            }} />
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} formatter={(value) => accounts.find(a => a.id === value)?.name || value} />
            {accounts.map(acc => (
              <Area
                key={acc.id}
                type="monotone"
                dataKey={acc.id}
                name={acc.id}
                stackId="1"
                stroke={getAccountColor(acc.id)}
                fill={isConstrainedAccount(acc.type) ? `url(#stripe-${acc.id})` : `url(#color-${acc.id})`}
                fillOpacity={1}
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
  );
};

export const InstitutionChart: React.FC<{ data: { name: string; value: number }[] }> = ({ data: dataByInstitution }) => {
  const t = chartTheme(useIsDark());
  return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dataByInstitution} layout="vertical" margin={{ right: 72 }}>
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12, fontWeight: 600, fill: t.tick }} stroke={t.grid} />
            <RechartsTooltip formatter={(v) => formatEUR(Number(v))} cursor={{ fill: 'transparent' }} contentStyle={{ borderRadius: '12px', border: 'none', background: t.tooltipBg, color: t.tooltipText }} />
            <Bar dataKey="value" fill={t.brand} radius={[0, 4, 4, 0]} barSize={22}>
              {/* Montant à droite de la barre : lisible même pour une petite barre. */}
              <LabelList dataKey="value" position="right" formatter={(v) => formatEUR(Number(v), 0)} style={{ fill: t.tick, fontSize: 12, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
  );
};
