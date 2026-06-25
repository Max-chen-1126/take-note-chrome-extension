import { describe, it, expect, vi, beforeEach } from "vitest";
import { getIdToken, clearToken } from "../../entrypoints/sidepanel/lib/auth";
import type { LaunchWebAuthFlowFn } from "../../entrypoints/sidepanel/lib/auth";

// A minimal valid-looking JWT: header.payload.signature (base64url), payload carries `exp`.
function fakeJwt(expSecondsFromNow: number): string {
  const b64url = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const header = b64url({ alg: "RS256", typ: "JWT" });
  const payload = b64url({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow, sub: "x" });
  return `${header}.${payload}.sig`;
}

const testHarnessDeps = {
  getRedirectURL: () => "https://abc123.chromiumapp.org/",
  randomNonce: () => "fixed-nonce",
};

function makeStorage(initial: Record<string, unknown> = {}) {
  const store: Record<string, unknown> = { ...initial };
  return {
    get: vi.fn(async (key: string) => ({ [key]: store[key] })),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(store, items);
    }),
    remove: vi.fn(async (key: string) => {
      delete store[key];
    }),
    _store: store,
  };
}

describe("getIdToken", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the dev bearer when env.WXT_DEV_BEARER is set, without touching storage or launchWebAuthFlow", async () => {
    const storage = makeStorage();
    const launchWebAuthFlow = vi.fn();

    const token = await getIdToken({
      env: { WXT_DEV_BEARER: "dev-token-123", WXT_OAUTH_CLIENT_ID: "client-abc" },
      storage,
      launchWebAuthFlow,
    });

    expect(token).toBe("dev-token-123");
    expect(launchWebAuthFlow).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
  });

  it("returns a cached token from storage.session when present and not expired", async () => {
    const futureExpiry = Date.now() + 60_000;
    const storage = makeStorage({
      tn_id_token: { token: "cached-token", expiresAt: futureExpiry },
    });
    const launchWebAuthFlow = vi.fn();

    const token = await getIdToken({
      env: { WXT_DEV_BEARER: "", WXT_OAUTH_CLIENT_ID: "client-abc" },
      storage,
      launchWebAuthFlow,
    });

    expect(token).toBe("cached-token");
    expect(launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it("falls through to launchWebAuthFlow when cache is absent, caching the resulting id_token", async () => {
    const storage = makeStorage();
    const jwt = fakeJwt(3600);
    const launchWebAuthFlow = vi.fn<LaunchWebAuthFlowFn>(async () => `https://redirect.example/#id_token=${jwt}&state=xyz`);

    const token = await getIdToken({
      env: { WXT_DEV_BEARER: "", WXT_OAUTH_CLIENT_ID: "client-abc" },
      storage,
      launchWebAuthFlow,
      ...testHarnessDeps,
    });

    expect(token).toBe(jwt);
    expect(launchWebAuthFlow).toHaveBeenCalledTimes(1);
    const [calledWith] = launchWebAuthFlow.mock.calls[0]!;
    expect(calledWith.interactive).toBe(true);
    expect(calledWith.url).toContain("client_id=client-abc");
    expect(calledWith.url).toContain("response_type=id_token");
    expect(calledWith.url).toContain("scope=openid");
    expect(storage.set).toHaveBeenCalledTimes(1);
    const [[setArg]] = storage.set.mock.calls;
    const cached = (setArg as Record<string, { token: string; expiresAt: number }>).tn_id_token;
    expect(cached.token).toBe(jwt);
    expect(cached.expiresAt).toBeGreaterThan(Date.now());
  });

  it("falls through to launchWebAuthFlow when the cached token is expired", async () => {
    const storage = makeStorage({
      tn_id_token: { token: "stale-token", expiresAt: Date.now() - 1000 },
    });
    const jwt = fakeJwt(3600);
    const launchWebAuthFlow = vi.fn<LaunchWebAuthFlowFn>(async () => `https://redirect.example/#id_token=${jwt}`);

    const token = await getIdToken({
      env: { WXT_DEV_BEARER: "", WXT_OAUTH_CLIENT_ID: "client-abc" },
      storage,
      launchWebAuthFlow,
      ...testHarnessDeps,
    });

    expect(token).toBe(jwt);
    expect(launchWebAuthFlow).toHaveBeenCalledTimes(1);
  });

  it("returns null when launchWebAuthFlow yields no id_token (e.g. user cancels)", async () => {
    const storage = makeStorage();
    const launchWebAuthFlow = vi.fn<LaunchWebAuthFlowFn>(async () => undefined);

    const token = await getIdToken({
      env: { WXT_DEV_BEARER: "", WXT_OAUTH_CLIENT_ID: "client-abc" },
      storage,
      launchWebAuthFlow,
      ...testHarnessDeps,
    });

    expect(token).toBeNull();
    expect(storage.set).not.toHaveBeenCalled();
  });

  it("returns null without launching the interactive flow when WXT_OAUTH_CLIENT_ID is empty/unset", async () => {
    const storage = makeStorage();
    const launchWebAuthFlow = vi.fn<LaunchWebAuthFlowFn>(async () => undefined);

    const token = await getIdToken({
      env: { WXT_DEV_BEARER: "", WXT_OAUTH_CLIENT_ID: "" },
      storage,
      launchWebAuthFlow,
      ...testHarnessDeps,
    });

    expect(token).toBeNull();
    expect(launchWebAuthFlow).not.toHaveBeenCalled();
  });

  it("returns null without launching the interactive flow when WXT_OAUTH_CLIENT_ID is undefined", async () => {
    const storage = makeStorage();
    const launchWebAuthFlow = vi.fn<LaunchWebAuthFlowFn>(async () => undefined);

    const token = await getIdToken({
      env: { WXT_DEV_BEARER: "" },
      storage,
      launchWebAuthFlow,
      ...testHarnessDeps,
    });

    expect(token).toBeNull();
    expect(launchWebAuthFlow).not.toHaveBeenCalled();
  });
});

describe("clearToken", () => {
  it("removes the cached token from storage.session", async () => {
    const storage = makeStorage({ tn_id_token: { token: "x", expiresAt: Date.now() + 1000 } });

    await clearToken({ storage });

    expect(storage.remove).toHaveBeenCalledWith("tn_id_token");
  });
});
