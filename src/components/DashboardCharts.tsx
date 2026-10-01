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

interface StackedProps {
  stackedData: any[];
  accounts: SavingsAccount[];
  getAccountColor: (id: string) => string;
  isConstrainedAccount: (type: SavingsAccount['type']) => boolean;
}

export const StackedSavingsChart: React.FC<StackedProps> = ({ stackedData, accounts, getAccountColor, isConstrainedAccount }) => (
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
            <XAxis dataKey="displayDate" tick={{ fontSize: 10 }} minTickGap={30} />
            <YAxis tickFormatter={(val) => `${(val / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k€`} tick={{ fontSize: 10 }} width={52} />
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <RechartsTooltip 
              contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', background: '#0f172a', color: '#f1f5f9' }}
              itemStyle={{ fontSize: '12px', padding: 0 }}
              formatter={(value: number, name: string) => {
                const accName = accounts.find(a => a.id === name)?.name || name;
                if (name === 'total') return [formatEUR(value, 2), "TOTAL"];
                return [formatEUR(value, 2), accName];
              }}
              labelStyle={{ color: '#cbd5e1', marginBottom: '0.5rem', fontWeight: 'bold' }}
            />
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

export const InstitutionChart: React.FC<{ data: { name: string; value: number }[] }> = ({ data: dataByInstitution }) => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={dataByInstitution} layout="vertical">
            <XAxis type="number" hide />
            <YAxis dataKey="name" type="category" width={96} tick={{fontSize: 11, fontWeight: 600, fill: '#94a3b8'}} />
            <RechartsTooltip formatter={(v: number) => formatEUR(v)} cursor={{fill: 'transparent'}} />
            <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={24}>
              <LabelList dataKey="value" position="insideRight" formatter={(v: number) => formatEUR(v, 0)} style={{ fill: '#fff', fontSize: 11, fontWeight: 700 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
);
