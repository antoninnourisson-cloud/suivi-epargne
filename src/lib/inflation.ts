// ================================================
// FILE: src/lib/inflation.ts
// Rendement après inflation (« réel » au sens des économistes) : le taux net d'un placement
// corrigé de la hausse des prix publiée par l'INSEE. Fonctions pures, testées.
// ================================================
import { FiscalConfig } from '../types';

export interface InflationFigure { rate: number; year: number; source?: string }

/**
 * Inflation livrée avec l'app : hausse moyenne des prix à la consommation en 2025, +0,9 %
 * (INSEE, Informations rapides n° 8 du 15 janvier 2026, vérifié le 2026-10-21 :
 * https://www.insee.fr/fr/statistiques/8726461). Elle est DATÉE et affichée avec son année ;
 * la veille fiscale propose la suivante dès qu'elle est publiée (mi-janvier), et la valeur
 * enregistrée dans les paramètres fiscaux (`fiscalConfig.inflation`) prend alors le relais.
 */
export const DEFAULT_INFLATION: InflationFigure = { rate: 0.9, year: 2025, source: 'https://www.insee.fr/fr/statistiques/8726461' };

/** Page INSEE qui donne la série annuelle (relue par la veille fiscale du serveur). */
export const INSEE_INFLATION_PAGE = 'https://www.insee.fr/fr/statistiques/4268033';

/** Inflation à utiliser : celle des paramètres fiscaux si elle est plus récente, sinon celle livrée avec l'app. */
export const inflationOf = (cfg: Pick<FiscalConfig, 'inflation'>): InflationFigure =>
  cfg.inflation && cfg.inflation.year >= DEFAULT_INFLATION.year ? cfg.inflation : DEFAULT_INFLATION;

/**
 * Rendement après inflation, en % : (1 + net) / (1 + inflation) − 1. Négatif quand les prix
 * montent plus vite que le placement : le pouvoir d'achat de l'épargne baisse.
 */
export const realRate = (netPct: number, inflationPct: number): number =>
  ((1 + netPct / 100) / (1 + inflationPct / 100) - 1) * 100;

/**
 * Le chiffre a plus d'un an de retard sur la dernière année close : celui de l'année passée
 * aurait dû paraître (mi-janvier). Sert à dire « chiffre {année}, le suivant est attendu ».
 */
export const isInflationOutdated = (figure: InflationFigure, now: Date = new Date()): boolean =>
  figure.year < now.getFullYear() - 1 && (now.getMonth() > 0 || now.getDate() > 20);
