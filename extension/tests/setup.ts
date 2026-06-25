import "@testing-library/jest-dom/vitest";

// WXT injects `defineBackground` as a compile-time global in entrypoints/*
// via its build pipeline; it's not present under vitest. Stub it with the
// same trivial wrapper WXT itself uses (wxt/dist/utils/define-background)
// so background.ts can be imported directly in tests.
(globalThis as unknown as { defineBackground?: <T>(arg: T) => T }).defineBackground = (arg) => arg;
