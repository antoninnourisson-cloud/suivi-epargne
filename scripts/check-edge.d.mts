// Types de check-edge.mjs (pour son test).
export declare const SITE_URL: string;
export interface Verdict { ok: boolean; message: string }
export declare const edgeVerdict: (url: string, res: { status: number; csp: string | null }) => Verdict;
export declare const checkEdge: (
  url?: string,
  opts?: { fetchImpl?: typeof fetch; attempts?: number; delayMs?: number; timeoutMs?: number },
) => Promise<Verdict>;
