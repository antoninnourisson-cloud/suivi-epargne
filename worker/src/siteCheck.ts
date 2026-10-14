// Vérification du site publié, faite par le serveur lui-même. La surveillance GitHub
// (monitor.yml) ne peut pas le faire seule : la protection anti-robots de Cloudflare refuse
// (403) les requêtes venant des serveurs de GitHub. Le Worker, lui, passe : il interroge les
// pages publiques et `/status` expose le résultat, sans aucune donnée utilisateur.

export const SITE_PAGES = ['', 'presentation.html', 'confidentialite.html'] as const;
export const SITE_CHECK_KEY = 'health:site';
/** Résultat réutilisé pendant 15 min : `/status` est public, il ne doit pas servir de relais. */
export const SITE_CHECK_TTL_MS = 15 * 60 * 1000;

export interface SiteCheck {
  checkedAt: string;
  ok: boolean;
  /** Pages en échec (code HTTP ou contenu inattendu). */
  failing: string[];
  /** En-tête HSTS présent sur l'accueil (Worker d'en-têtes actif). */
  hsts: boolean;
}

export const checkSite = async (appUrl: string, fetcher: typeof fetch = fetch, now = new Date()): Promise<SiteCheck> => {
  const base = appUrl.endsWith('/') ? appUrl : `${appUrl}/`;
  const failing: string[] = [];
  let hsts = false;
  await Promise.all(SITE_PAGES.map(async page => {
    try {
      const res = await fetcher(base + page, { redirect: 'follow', headers: { 'User-Agent': 'PeculeStatus/1.0' } });
      const body = res.ok ? await res.text() : '';
      if (!res.ok || !body.includes('Pécule')) failing.push(`/${page} (${res.status})`);
      if (page === '') hsts = !!res.headers.get('strict-transport-security');
    } catch {
      failing.push(`/${page} (injoignable)`);
    }
  }));
  return { checkedAt: now.toISOString(), ok: failing.length === 0, failing: failing.sort(), hsts };
};

/** Dernier contrôle s'il a moins de 15 min, sinon un nouveau (gardé dans KV). */
export const cachedSiteCheck = async (
  store: KVNamespace, appUrl: string, fetcher: typeof fetch = fetch, now = new Date(),
): Promise<SiteCheck> => {
  const last = await store.get<SiteCheck>(SITE_CHECK_KEY, 'json');
  if (last && now.getTime() - Date.parse(last.checkedAt) < SITE_CHECK_TTL_MS) return last;
  const fresh = await checkSite(appUrl, fetcher, now);
  await store.put(SITE_CHECK_KEY, JSON.stringify(fresh));
  return fresh;
};
