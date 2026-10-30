// Types de check-backend.mjs (pour son test).
export declare const APP_ORIGIN: string;
export interface Verdict { ok: boolean; message: string }
export declare const backendOriginFrom: (envText: string) => string | null;
export declare const statusVerdict: (
  origin: string,
  res: { status: number; allowOrigin: string | null; body: unknown },
  appOrigin?: string,
) => Verdict;
export declare const checkBackend: (
  envText: string,
  opts?: { fetchImpl?: typeof fetch; attempts?: number; delayMs?: number; timeoutMs?: number; appOrigin?: string },
) => Promise<Verdict>;
