// Types de check-bundle-size.mjs (pour son test).
export declare const LIMIT_KB: number;
export declare const mainEntryPath: (html: string) => string | null;
export interface Verdict { ok: boolean; message: string }
export declare const verdict: (file: string, bytes: number, limitKb?: number) => Verdict;
export declare const checkBuild: (dir: string, limitKb?: number) => Verdict;
