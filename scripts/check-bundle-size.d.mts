// Types de check-bundle-size.mjs (pour son test).
export declare const LIMIT_KB: number;
export declare const STARTUP_LIMIT_KB: number;
export declare const LAZY_CHUNKS: string[];
export declare const mainEntryPath: (html: string) => string | null;
export declare const preloadedPaths: (html: string) => string[];
export declare const staticImports: (code: string) => string[];
export declare const startupFiles: (dir: string, html: string) => string[];
export declare const lazyInStartup: (files: string[], lazy?: string[]) => string[];
export interface Verdict { ok: boolean; message: string }
export declare const verdict: (file: string, bytes: number, limitKb?: number) => Verdict;
export declare const startupVerdict: (count: number, bytes: number, limitKb?: number) => Verdict;
export declare const checkBuild: (dir: string, limitKb?: number, startupLimitKb?: number) => Verdict;
