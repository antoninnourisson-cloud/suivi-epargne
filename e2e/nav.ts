// Aller à un endroit de l'app par les menus, comme l'utilisateur : menu latéral (ordinateur),
// barre du bas ou panneau « Plus » (téléphone), puis l'onglet de l'écran s'il en a. Les tests
// nomment l'endroit par son ancien nom d'écran (« Journal », « Abonnements »…) : seule la
// table ci-dessous suit les menus quand ils changent.
import { expect, type Page } from './fixtures';

interface Target {
  /** Entrée du menu latéral et du panneau « Plus ». */
  menu: string;
  /** Libellé dans la barre du bas, s'il y est (et diffère de `menu`). */
  bar?: string;
  /** Écran et onglet atteints (titre de l'onglet du navigateur : « Écran · Onglet »). */
  screen: string;
  tab?: string;
}

const TARGETS: Record<string, Target> = {
  'Accueil': { menu: 'Accueil', screen: 'Accueil' },
  'Actualiser les soldes': { menu: 'Actualiser les soldes', bar: 'Actualiser', screen: 'Actualiser les soldes' },
  'Mes comptes': { menu: 'Comptes', screen: 'Comptes', tab: 'Soldes' },
  'Journal': { menu: 'Comptes', screen: 'Comptes', tab: 'Mouvements' },
  'Virements': { menu: 'Comptes', screen: 'Comptes', tab: 'Mouvements' },
  'Part parentale': { menu: 'Comptes', screen: 'Comptes', tab: 'Parents' },
  'Pilotage': { menu: 'Pilotage', screen: 'Pilotage', tab: 'Ce mois' },
  'Abonnements': { menu: 'Pilotage', screen: 'Pilotage', tab: 'Abonnements' },
  'Fiches de paie': { menu: 'Pilotage', screen: 'Pilotage', tab: 'Fiches de paie' },
  'Dons et impôts': { menu: 'Impôts', screen: 'Impôts', tab: 'Dons et déclaration' },
  'Calendrier fiscal': { menu: 'Impôts', screen: 'Impôts', tab: 'Calendrier fiscal' },
  'Rendement': { menu: 'Analyses', screen: 'Analyses', tab: 'Rendement' },
  'Historique': { menu: 'Analyses', screen: 'Analyses', tab: 'Évolution' },
  'Et si…': { menu: 'Analyses', screen: 'Analyses', tab: 'Et si…' },
  'Agenda': { menu: 'Analyses', screen: 'Analyses', tab: 'Agenda' },
  'Paramètres': { menu: 'Paramètres', screen: 'Paramètres' },
};

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Titre de l'onglet du navigateur pour un endroit (« Comptes · Mouvements · Pécule »). */
export const placeTitle = (label: string): RegExp => {
  const t = TARGETS[label];
  if (!t) throw new Error(`Endroit inconnu : ${label}`);
  return new RegExp(`^${escape(t.tab ? `${t.screen} · ${t.tab}` : t.screen)} · Pécule$`);
};

export const goTo = async (page: Page, label: string, isMobile: boolean) => {
  const t = TARGETS[label];
  if (!t) throw new Error(`Endroit inconnu : ${label}`);
  if (!isMobile) {
    await page.locator('aside').getByRole('button', { name: t.menu, exact: true }).click();
  } else {
    const bar = page.getByRole('navigation', { name: 'Navigation principale' });
    const button = bar.getByRole('button', { name: t.bar ?? t.menu, exact: true });
    if (await button.count()) await button.click();
    else {
      await bar.getByRole('button', { name: 'Plus', exact: true }).click();
      await page.getByRole('dialog', { name: "Plus d'écrans" }).getByRole('button', { name: t.menu, exact: true }).click();
    }
  }
  // Un écran rouvert par le menu peut afficher son dernier onglet : on choisit le bon.
  if (t.tab) {
    const tab = page.locator('main').getByRole('tablist', { name: t.screen }).getByRole('tab', { name: t.tab, exact: true });
    if ((await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
  }
  await expect(page).toHaveTitle(placeTitle(label));
  await screenReady(page);
};

/**
 * Écran affiché et son contenu chargé : le titre de l'écran (h2) arrive avant le contenu d'un
 * onglet, chargé à la demande (squelette `aria-busy` en attendant).
 */
export const screenReady = async (page: Page) => {
  await expect(page.locator('main h2').first()).toBeAttached();
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
};
