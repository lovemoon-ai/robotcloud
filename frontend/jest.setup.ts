import "@testing-library/jest-dom";

const runtimeConfig = { publicRuntimeConfig: {} as Record<string, unknown> };

jest.mock("next/config", () => () => runtimeConfig);

(globalThis as { __NEXT_RUNTIME_CONFIG__?: typeof runtimeConfig }).__NEXT_RUNTIME_CONFIG__ = runtimeConfig;
