import 'vitest';

// Chai exposes `.not` at runtime; the installed Vitest assertion wrapper omits
// that chain modifier from its generic type, which otherwise blocks tsc builds.
declare module 'vitest' {
  interface Assertion<R extends void | Promise<void> = void, T = unknown> {
    readonly not: Assertion<R, T>;
  }
}
