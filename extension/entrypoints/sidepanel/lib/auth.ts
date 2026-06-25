// Auth (App-level): resolves a Google ID token for Authorization: Bearer <id_token>.
//
// Resolution order:
//   1. Dev bearer (import.meta.env.WXT_DEV_BEARER) — local-E2E path for this slice,
//      since real auth needs backend Phase B audience alignment (aud=client_id).
//   2. chrome.storage.session cache (with expiry).
//   3. chrome.identity.launchWebAuthFlow — interactive Google OAuth2 id_token flow.
//
// All browser/env access is routed through `deps` so the dev-bearer and cache
// branches are unit-testable without a real browser. Defaults wire up the real
// chrome.* APIs and import.meta.env for production use.

const STORAGE_KEY = "tn_id_token";
const DEFAULT_TTL_MS = 55 * 60 * 1000; // conservative default if JWT has no/unparseable `exp`
const GOOGLE_OAUTH_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

export interface AuthEnv {
  WXT_DEV_BEARER?: string;
  WXT_OAUTH_CLIENT_ID?: string;
}

export interface SessionStorageLike {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export type LaunchWebAuthFlowFn = (options: {
  url: string;
  interactive: boolean;
}) => Promise<string | undefined>;

export interface AuthDeps {
  env: AuthEnv;
  storage: SessionStorageLike;
  launchWebAuthFlow: LaunchWebAuthFlowFn;
  getRedirectURL: () => string;
  now: () => number;
  randomNonce: () => string;
}

function readEnv(): AuthEnv {
  // import.meta.env is statically replaced by Vite/WXT at build time.
  const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {};
  return { WXT_DEV_BEARER: env.WXT_DEV_BEARER, WXT_OAUTH_CLIENT_ID: env.WXT_OAUTH_CLIENT_ID };
}

function defaultStorage(): SessionStorageLike {
  return {
    get: (key) => chrome.storage.session.get(key),
    set: (items) => chrome.storage.session.set(items),
    remove: (key) => chrome.storage.session.remove(key),
  };
}

function defaultLaunchWebAuthFlow(options: { url: string; interactive: boolean }) {
  return new Promise<string | undefined>((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(options, (redirectUrl) => {
      const err = chrome.runtime.lastError;
      if (err) {
        reject(new Error(err.message));
        return;
      }
      resolve(redirectUrl);
    });
  });
}

function defaultDeps(): AuthDeps {
  return {
    env: readEnv(),
    storage: defaultStorage(),
    launchWebAuthFlow: defaultLaunchWebAuthFlow,
    getRedirectURL: () => chrome.identity.getRedirectURL(),
    now: () => Date.now(),
    randomNonce: () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
  };
}

function buildAuthUrl(clientId: string, redirectUri: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "id_token",
    scope: "openid email",
    redirect_uri: redirectUri,
    nonce,
  });
  return `${GOOGLE_OAUTH_AUTH_ENDPOINT}?${params.toString()}`;
}

function parseIdTokenFromRedirect(redirectUrl: string | undefined): string | null {
  if (!redirectUrl) return null;
  const hashIndex = redirectUrl.indexOf("#");
  if (hashIndex === -1) return null;
  const fragment = redirectUrl.slice(hashIndex + 1);
  const params = new URLSearchParams(fragment);
  return params.get("id_token");
}

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  return atob(padded + pad);
}

/** Derives an expiry (epoch ms) from the JWT `exp` claim; falls back to a conservative default. */
function expiryFromJwt(token: string, now: number): number {
  try {
    const [, payloadSeg] = token.split(".");
    if (!payloadSeg) return now + DEFAULT_TTL_MS;
    const payload = JSON.parse(base64UrlDecode(payloadSeg)) as { exp?: number };
    if (typeof payload.exp === "number") return payload.exp * 1000;
    return now + DEFAULT_TTL_MS;
  } catch {
    return now + DEFAULT_TTL_MS;
  }
}

async function readCache(deps: Pick<AuthDeps, "storage" | "now">): Promise<string | null> {
  const result = await deps.storage.get(STORAGE_KEY);
  const cached = result[STORAGE_KEY] as CachedToken | undefined;
  if (cached && cached.expiresAt > deps.now()) return cached.token;
  return null;
}

async function writeCache(deps: Pick<AuthDeps, "storage">, token: string, expiresAt: number): Promise<void> {
  await deps.storage.set({ [STORAGE_KEY]: { token, expiresAt } satisfies CachedToken });
}

/**
 * Resolves a Google ID token for use as `Authorization: Bearer <id_token>`.
 *
 * Order: dev bearer (env) → session cache (if unexpired) → interactive
 * launchWebAuthFlow (caches the result). Returns null if no token could be
 * obtained (e.g. the user cancels the interactive flow, or no OAuth
 * client_id is configured — launchWebAuthFlow is never invoked in that
 * case, since Google would otherwise show a broken "missing client_id"
 * popup).
 *
 * `partialDeps` lets tests override env/storage/launchWebAuthFlow without a
 * real browser; production callers should call `getIdToken()` with no args.
 */
export async function getIdToken(partialDeps?: Partial<AuthDeps>): Promise<string | null> {
  const deps: AuthDeps = { ...defaultDeps(), ...partialDeps };

  if (deps.env.WXT_DEV_BEARER) return deps.env.WXT_DEV_BEARER;

  const cached = await readCache(deps);
  if (cached) return cached;

  const clientId = deps.env.WXT_OAUTH_CLIENT_ID ?? "";
  if (!clientId) return null;

  const authUrl = buildAuthUrl(clientId, deps.getRedirectURL(), deps.randomNonce());
  const redirectUrl = await deps.launchWebAuthFlow({ url: authUrl, interactive: true });
  const idToken = parseIdTokenFromRedirect(redirectUrl);
  if (!idToken) return null;

  const expiresAt = expiryFromJwt(idToken, deps.now());
  await writeCache(deps, idToken, expiresAt);
  return idToken;
}

/** Clears the cached ID token (e.g. on 401, to force re-authorization on next getIdToken()). */
export async function clearToken(partialDeps?: Partial<Pick<AuthDeps, "storage">>): Promise<void> {
  const storage = partialDeps?.storage ?? defaultStorage();
  await storage.remove(STORAGE_KEY);
}
