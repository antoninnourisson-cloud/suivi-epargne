// Accès au stockage local de l'appareil (localStorage) qui ne lève jamais d'erreur : en
// navigation privée, stockage bloqué ou quota plein, la lecture rend la valeur par défaut
// et l'écriture est simplement perdue (préférences, rien d'indispensable).

export const lsGet = (key: string): string | null => {
  try { return localStorage.getItem(key); } catch { return null; }
};

export const lsSet = (key: string, value: string): void => {
  try { localStorage.setItem(key, value); } catch { /* quota ou stockage bloqué */ }
};

export const lsDel = (key: string): void => {
  try { localStorage.removeItem(key); } catch { /* stockage bloqué */ }
};

/** Valeur JSON enregistrée, ou `fallback` si absente, illisible ou stockage bloqué. */
export const lsGetJSON = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch { return fallback; }
};

export const lsSetJSON = (key: string, value: unknown): void => lsSet(key, JSON.stringify(value));
