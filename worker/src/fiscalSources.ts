// Textes des pages officielles utilisées par la veille fiscale de l'app. Le navigateur ne
// peut pas les lire lui-même (pages d'autres sites), et la recherche Google de Gemini n'est
// pas incluse dans la clé gratuite : le serveur télécharge donc ces pages, en garde le
// texte utile, et l'app le fait lire par Gemini. Liste fixe : aucune adresse ne vient de
// l'extérieur.

export interface FiscalSource { url: string; topic: string; text: string; ok: boolean }

export const FISCAL_SOURCE_URLS: { url: string; topic: string }[] = [
  { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2365', topic: 'Livret A : taux et plafond' },
  { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2368', topic: 'LDDS : taux et plafond' },
  { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2367', topic: 'LEP : taux, plafond, plafonds de revenus' },
  { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1419', topic: "Barème de l'impôt sur le revenu" },
  { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F34328', topic: "Calcul de l'impôt et décote" },
  { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F1989', topic: 'Abattement de 10 % pour frais professionnels' },
  { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F426', topic: 'Réduction d\'impôt pour les dons' },
  { url: 'https://www.service-public.gouv.fr/particuliers/vosdroits/F2329', topic: 'Prélèvements sociaux sur les revenus du patrimoine et des placements' },
];

const MAX_CHARS = 20000;

const HTML_ENTITIES: Record<string, string> = {
  nbsp: ' ', euro: '€', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", rsquo: "'",
  eacute: 'é', egrave: 'è', agrave: 'à',
};

/** Texte lisible d'une page HTML : sans scripts, styles, menus ni pieds de page. */
export const htmlToText = (html: string, maxChars = MAX_CHARS): string => {
  let h = html;
  const main = h.match(/<main[\s\S]*?<\/main>/i);
  if (main) h = main[0];
  h = h.replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ');
  h = h.replace(/<br\s*\/?>|<\/(p|li|h[1-6]|tr|div|section)>/gi, '\n');
  h = h.replace(/<[^>]+>/g, ' ');
  // Entités décodées en UNE passe : « &amp;lt; » doit donner « &lt; », pas « < » (un
  // décodage en plusieurs remplacements successifs décodait deux fois, alerte CodeQL).
  h = h.replace(/&(#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const n = Number(e.slice(1));
      return n === 160 || n === 8239 ? ' ' : n === 39 ? "'" : String.fromCharCode(n);
    }
    return HTML_ENTITIES[e.toLowerCase()] ?? m;
  });
  return h.replace(/[ \t  ]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, maxChars);
};

/** `maxChars` : longueur gardée par page (l'app reçoit 20 000 caractères ; la veille du serveur lit la page entière puis n'en garde que les passages utiles). */
export const fetchFiscalSources = async (fetcher: typeof fetch = fetch, maxChars = MAX_CHARS): Promise<FiscalSource[]> =>
  Promise.all(FISCAL_SOURCE_URLS.map(async ({ url, topic }) => {
    try {
      const res = await fetcher(url, {
        headers: { 'User-Agent': 'Pecule/1.0 (veille fiscale personnelle)', Accept: 'text/html' },
        redirect: 'follow',
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) return { url, topic, text: '', ok: false };
      return { url, topic, text: htmlToText(await res.text(), maxChars), ok: true };
    } catch {
      return { url, topic, text: '', ok: false };
    }
  }));
