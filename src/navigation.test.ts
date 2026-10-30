// Modèle de navigation : 7 écrans, onglets, table d'alias des anciennes clés d'écran (liens,
// notifications, `lastView` d'un ancien fichier), forme enregistrée, entrées de menu actives.
import { describe, it, expect, vi } from 'vitest';
import {
  activeNavKey, encodePlace, goToNavItem, isScreen, isView, NAV_ITEMS, parsePlace, placeIn, placeLabel, placeOf,
  SCREEN_TABS, tabsOf, VIEW_ALIASES, visiblePlace, type Place, type View,
} from './navigation';

// Les 15 clés d'écran d'avant les onglets : chacune doit garder une destination explicite.
const OLD_VIEWS = [
  'dashboard', 'update', 'accounts', 'transfers', 'journal', 'pilot', 'subscriptions', 'payslips',
  'donations', 'yield', 'history', 'simulator', 'agenda', 'parental', 'settings',
] as const;

describe('écrans et onglets', () => {
  it('7 écrans, dont 4 à onglets', () => {
    expect(['dashboard', 'update', 'accounts', 'pilot', 'analyses', 'taxes', 'settings'].every(isScreen)).toBe(true);
    expect(isScreen('journal')).toBe(false);
    expect(Object.keys(SCREEN_TABS)).toEqual(['accounts', 'pilot', 'analyses', 'taxes']);
    expect(tabsOf('accounts').map(t => t.label)).toEqual(['Soldes', 'Mouvements', 'Parents']);
    expect(tabsOf('pilot').map(t => t.label)).toEqual(['Ce mois', 'Abonnements', 'Fiches de paie']);
    expect(tabsOf('analyses').map(t => t.label)).toEqual(['Évolution', 'Rendement', 'Agenda', 'Et si…']);
    expect(tabsOf('taxes').map(t => t.label)).toEqual(['Dons et déclaration', 'Calendrier fiscal']);
    expect(tabsOf('settings')).toEqual([]);
  });

  it('clés d’onglet uniques d’un écran à l’autre', () => {
    const keys = Object.values(SCREEN_TABS).flat().map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('endroit d’un écran : onglet demandé s’il existe, sinon le premier', () => {
    expect(placeIn('pilot', 'payslips')).toEqual({ screen: 'pilot', tab: 'payslips' });
    expect(placeIn('pilot', 'agenda')).toEqual({ screen: 'pilot', tab: 'month' });
    expect(placeIn('pilot')).toEqual({ screen: 'pilot', tab: 'month' });
    expect(placeIn('settings', 'month')).toEqual({ screen: 'settings' });
  });

  it('titre : « Écran · Onglet »', () => {
    expect(placeLabel({ screen: 'accounts', tab: 'movements' })).toBe('Comptes · Mouvements');
    expect(placeLabel({ screen: 'taxes', tab: 'calendar' })).toBe('Impôts · Calendrier fiscal');
    expect(placeLabel({ screen: 'update' })).toBe('Actualiser les soldes');
  });

  it('onglet masqué (mode solo) : retombe sur l’onglet par défaut', () => {
    expect(visiblePlace({ screen: 'accounts', tab: 'parents' }, ['parents'])).toEqual({ screen: 'accounts', tab: 'balances' });
    expect(visiblePlace({ screen: 'accounts', tab: 'parents' }, [])).toEqual({ screen: 'accounts', tab: 'parents' });
  });
});

describe('table d’alias', () => {
  it('chaque ancienne clé ouvre un écran ET un onglet explicites', () => {
    for (const v of OLD_VIEWS) {
      expect(isView(v)).toBe(true);
      const p = placeOf(v);
      expect(isScreen(p.screen)).toBe(true);
      // Un écran à onglets n'est jamais ouvert sans onglet (l'onglet mémorisé n'y entre pas).
      expect(p.tab !== undefined).toBe(tabsOf(p.screen).length > 0);
    }
  });

  it('destinations', () => {
    const expected: Record<View, Place> = {
      dashboard: { screen: 'dashboard' },
      update: { screen: 'update' },
      accounts: { screen: 'accounts', tab: 'balances' },
      transfers: { screen: 'accounts', tab: 'movements' },
      journal: { screen: 'accounts', tab: 'movements' },
      parental: { screen: 'accounts', tab: 'parents' },
      pilot: { screen: 'pilot', tab: 'month' },
      subscriptions: { screen: 'pilot', tab: 'subscriptions' },
      payslips: { screen: 'pilot', tab: 'payslips' },
      donations: { screen: 'taxes', tab: 'donations' },
      taxes: { screen: 'taxes', tab: 'donations' },
      yield: { screen: 'analyses', tab: 'yield' },
      history: { screen: 'analyses', tab: 'evolution' },
      analyses: { screen: 'analyses', tab: 'evolution' },
      simulator: { screen: 'analyses', tab: 'simulator' },
      agenda: { screen: 'analyses', tab: 'agenda' },
      settings: { screen: 'settings' },
    };
    expect(VIEW_ALIASES).toEqual(expected);
  });

  it('`&tab=` choisit un autre onglet du même écran ; inconnu ou d’un autre écran, ignoré', () => {
    expect(placeOf('taxes', 'calendar')).toEqual({ screen: 'taxes', tab: 'calendar' });
    expect(placeOf('donations', 'calendar')).toEqual({ screen: 'taxes', tab: 'calendar' });
    expect(placeOf('pilot', 'agenda')).toEqual({ screen: 'pilot', tab: 'month' });
    expect(placeOf('pilot', 'inconnu')).toEqual({ screen: 'pilot', tab: 'month' });
  });

  it('clé inconnue (lien d’une version plus récente) : refusée', () => {
    expect(isView('ecran-futur')).toBe(false);
    expect(isView(undefined)).toBe(false);
  });
});

describe('`lastView` enregistré', () => {
  it('forme « écran/onglet », relue telle quelle', () => {
    const p: Place = { screen: 'analyses', tab: 'agenda' };
    expect(encodePlace(p)).toBe('analyses/agenda');
    expect(parsePlace(encodePlace(p))).toEqual(p);
    expect(encodePlace({ screen: 'dashboard' })).toBe('dashboard');
    expect(parsePlace('dashboard')).toEqual({ screen: 'dashboard' });
  });

  it('ancienne forme (fichier d’une version précédente) : par la table d’alias', () => {
    expect(parsePlace('payslips')).toEqual({ screen: 'pilot', tab: 'payslips' });
    expect(parsePlace('history')).toEqual({ screen: 'analyses', tab: 'evolution' });
    expect(parsePlace('transfers')).toEqual({ screen: 'accounts', tab: 'movements' });
  });

  it('valeur abîmée ou inconnue : rien', () => {
    for (const v of ['pilot/agenda', 'inconnu/x', 'pilot/month/x', 'ecran-futur', '', null, 42]) expect(parsePlace(v)).toBeNull();
  });
});

describe('menus', () => {
  it('une entrée qui nomme un écran rouvre son onglet mémorisé ; une ancienne entrée, son onglet', () => {
    const navigate = vi.fn();
    const openScreen = vi.fn();
    goToNavItem('pilot', navigate, openScreen);
    expect(openScreen).toHaveBeenCalledWith('pilot');
    goToNavItem('journal', navigate, openScreen);
    expect(navigate).toHaveBeenCalledWith('journal');
  });

  it('entrée active : l’endroit exact, sinon la première entrée du même écran', () => {
    const keys = NAV_ITEMS.map(i => i.key);
    expect(activeNavKey({ screen: 'pilot', tab: 'subscriptions' }, keys)).toBe('subscriptions');
    expect(activeNavKey({ screen: 'accounts', tab: 'movements' }, keys)).toBe('journal');
    expect(activeNavKey({ screen: 'taxes', tab: 'calendar' }, keys)).toBe('donations');
    expect(activeNavKey({ screen: 'pilot', tab: 'subscriptions' }, ['dashboard', 'pilot'])).toBe('pilot');
    expect(activeNavKey({ screen: 'analyses', tab: 'agenda' }, ['dashboard', 'pilot'])).toBeUndefined();
  });
});
