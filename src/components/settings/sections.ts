// Cartes de l'écran Paramètres : identifiants stables (liens profonds, mémoire des cartes
// ouvertes) et ouverture d'une carte depuis un autre écran.
//
// Ouvrir une carte depuis ailleurs : `openSettingsSection('tax-notice')` puis afficher
// l'écran Paramètres. Depuis une adresse : `?view=settings&section=tax-notice`.
const SETTINGS_SECTIONS = [
  'benefits', 'fiscal', 'tax-notice', 'fiscal-watch',
  'motivation', 'notifications', 'keys',
  'lock', 'data', 'account',
  'about',
] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];
export const isSettingsSection = (v: unknown): v is SettingsSection =>
  typeof v === 'string' && (SETTINGS_SECTIONS as readonly string[]).includes(v);

/** Ancre DOM d'une carte (scrollIntoView, liens). */
export const sectionAnchor = (id: SettingsSection) => `settings-${id}`;

export const OPEN_SECTION_EVENT = 'pecule:open-settings-section';
const OPEN_KEY = 'settings_open_cards';

// Carte demandée avant que l'écran Paramètres (chargé à la demande) soit monté.
let pending: SettingsSection | null = null;

/** Demande l'ouverture d'une carte : lue au montage de l'écran, ou tout de suite s'il est affiché. */
export const openSettingsSection = (id: SettingsSection) => {
  pending = id;
  window.dispatchEvent(new CustomEvent<SettingsSection>(OPEN_SECTION_EVENT, { detail: id }));
};

const urlSection = (): SettingsSection | null => {
  try {
    const s = new URLSearchParams(window.location.search).get('section');
    return isSettingsSection(s) ? s : null;
  } catch { return null; }
};

/** Carte demandée (lien interne, sinon `?section=` de l'adresse), sans la consommer. */
export const peekRequestedSection = (): SettingsSection | null => pending ?? urlSection();

/** La demande a été servie : on l'oublie (et on retire `section` de l'adresse). */
export const clearRequestedSection = () => {
  pending = null;
  try {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('section')) return;
    params.delete('section');
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash);
  } catch { /* adresse inchangée */ }
};

/** Cartes ouvertes la dernière fois (préférence de cet appareil). */
export const readOpenSections = (): SettingsSection[] => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter(isSettingsSection) : [];
  } catch { return []; }
};

export const writeOpenSections = (ids: SettingsSection[]) => {
  try { localStorage.setItem(OPEN_KEY, JSON.stringify(ids)); } catch { /* préférence non mémorisée */ }
};
