/**
 * Public defaults for the server-only live-preview OAuth client.
 *
 * The broker accepts this client for preview hosts. Its secret must be supplied
 * through GROK_PREVIEW_CLIENT_SECRET; deployed apps use GROK_AUTH_CLIENT_SECRET.
 * Keep credentials in the server environment, never in source control.
 */
export const PREVIEW_CLIENT_ID = "grok_preview";

/** The shared auth broker issuer (OIDC discovery lives under it). */
export const GROK_ISSUER_DEFAULT = "https://auth.grok.me";

/**
 * Host patterns whose callbacks the preview client accepts. Better Auth derives
 * the live preview's real origin from the request host and validates it against
 * this list (wildcard-matched), so the OAuth `redirect_uri` becomes the concrete
 * `https://<preview-host>/api/auth/oauth2/callback/...` the broker allows.
 */
export const PREVIEW_ALLOWED_HOSTS = ["*.grok-sandbox.com"] as const;
