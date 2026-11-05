// Types de playwright-flaky-reporter.mjs (pour son test).
export declare const escapeData: (text: unknown) => string;
export declare const escapeProperty: (text: unknown) => string;
export default class FlakyReporter {
  constructor(options?: { write?: (line: string) => void; summaryFile?: string });
  flaky: { title: string; file: string; line: number; attempts: number }[];
  printsToStdio(): boolean;
  onTestEnd(test: unknown, result: unknown): void;
  onEnd(): void;
}
