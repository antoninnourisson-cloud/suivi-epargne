// ================================================
// FILE: src/lib/mailTemplates.ts
// E-mails envoyés aux parents (HTML). Toute donnée interpolée passe par `esc` : un nom de
// compte ou un fichier importé ne doit jamais pouvoir injecter de lien ou de formulaire
// dans un e-mail parti de la boîte Gmail de l'utilisateur.
// ================================================
import { AccountType, SavingsAccount } from '../types';

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Montant en euros ; une valeur non numérique (fichier importé) s'affiche 0 €, jamais telle quelle. */
export const eurHtml = (n: unknown): string => {
  const v = Number(n);
  return esc((Number.isFinite(v) ? v : 0).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' }));
};

const stamp = (now: Date) =>
  `Généré automatiquement le ${now.toLocaleDateString('fr-FR')} à ${now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

const NOTIFIED_TYPES: string[] = [AccountType.LIVRET_A, AccountType.LEP];

/**
 * Récapitulatif d'une opération sur le Livret A ou le LEP (les comptes qui portent le
 * capital des parents). `null` si aucun de ces comptes n'a changé.
 */
export const buildAccountsUpdateMail = (
  before: SavingsAccount[],
  updates: { account: SavingsAccount }[],
  now: Date = new Date()
): string | null => {
  const rows: string[] = [];
  for (const upd of updates) {
    const old = before.find(a => a.id === upd.account.id);
    if (!old || !NOTIFIED_TYPES.includes(old.type)) continue;
    const diff = Number(upd.account.totalAmount) - Number(old.totalAmount);
    if (!(Math.abs(diff) > 0.001)) continue;
    const color = diff > 0 ? '#15803d' : '#b91c1c';
    rows.push(`
      <tr style="border-bottom: 1px solid #e7e5e4;">
        <td style="padding: 10px; vertical-align: top;"><b>${esc(old.type)}</b></td>
        <td style="padding: 10px; vertical-align: top;"><b>${eurHtml(old.totalAmount)}</b><br/>
          <small style="color: #57534e;">Parents : ${eurHtml(old.parentalCapital)}</small><br/>
          <small style="color: #57534e;">Moi : ${eurHtml(old.ownedAmount)}</small></td>
        <td style="padding: 10px; vertical-align: top;"><b>${eurHtml(upd.account.totalAmount)}</b><br/>
          <small style="color: #57534e;">Parents : ${eurHtml(upd.account.parentalCapital)}</small><br/>
          <small style="color: #57534e;">Moi : ${eurHtml(upd.account.ownedAmount)}</small></td>
        <td style="padding: 10px; vertical-align: top; color: ${color}; font-weight: bold;">${diff > 0 ? '+' : ''}${eurHtml(diff)}</td>
      </tr>`);
  }
  if (rows.length === 0) return null;
  return `
    <div style="font-family: Arial, sans-serif; color: #1c1917;">
      <h2 style="color: #14532d; border-bottom: 2px solid #e7e5e4; padding-bottom: 10px;">Mise à jour des comptes</h2>
      <p>Une opération a été enregistrée sur les livrets :</p>
      <table style="width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 14px; border: 1px solid #e7e5e4;">
        <tr style="background-color: #f5f5f4; text-align: left;">
          <th style="padding: 10px;">Compte</th><th style="padding: 10px;">Avant</th><th style="padding: 10px;">Après</th><th style="padding: 10px;">Écart</th>
        </tr>${rows.join('')}
      </table>
      <p style="font-size: 11px; color: #78716c; margin-top: 20px;">${stamp(now)}</p>
    </div>`;
};

/** Récapitulatif de la restitution du capital des parents. */
export const buildRestitutionMail = (
  dateLabel: string,
  rows: { name: string; amount: number }[],
  total: number,
  interestsOffered: number,
  now: Date = new Date()
): string => `
  <div style="font-family: Arial, sans-serif; color: #1c1917;">
    <h2 style="color: #14532d;">Restitution de votre capital</h2>
    <p>Le ${esc(dateLabel)}, votre capital a été retiré des comptes suivants :</p>
    <table style="border-collapse: collapse; font-size: 14px;">
      ${rows.map(r => `<tr><td style="padding:4px 12px 4px 0">${esc(r.name)}</td><td style="padding:4px 0;text-align:right">${eurHtml(r.amount)}</td></tr>`).join('')}
      <tr><td style="padding:8px 12px 4px 0;border-top:1px solid #e7e5e4">Total</td><td style="padding:8px 0 4px;text-align:right;border-top:1px solid #e7e5e4"><b>${eurHtml(total)}</b></td></tr>
    </table>
    ${interestsOffered > 0 ? `<p>Merci pour les ${eurHtml(interestsOffered)} d'intérêts que ce capital a produits et que vous m'avez laissés.</p>` : ''}
    <p style="font-size: 11px; color: #78716c; margin-top: 20px;">${stamp(now)}</p>
  </div>`;
