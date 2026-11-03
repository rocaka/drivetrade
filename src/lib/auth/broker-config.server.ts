/** Server-only broker configuration, resolved before authentication starts. */
import { GROK_ISSUER_DEFAULT, PREVIEW_CLIENT_ID } from "./preview.ts";

export function resolveBrokerAuthConfig(environment: Readonly<Record<string, string | undefined>>) {
  const env = (key: string): string | undefined => {
    const value = environment[key]?.trim();
    return value ? value : undefined;
  };

  const authDisabled = env("VITE_AUTH_ENABLED") === "false";
  const grokIssuer = env("GROK_AUTH_ISSUER") ?? GROK_ISSUER_DEFAULT;
  const grokClientId = env("GROK_AUTH_CLIENT_ID") ?? PREVIEW_CLIENT_ID;
  const grokClientSecret = env("GROK_AUTH_CLIENT_SECRET") ?? env("GROK_PREVIEW_CLIENT_SECRET");

  // Missing credentials must never turn an enabled app into the dev-user mode.
  if (!authDisabled && !grokClientSecret) {
    throw new Error(
      "Authentication is enabled but no OAuth client secret is configured. " +
        "Set GROK_AUTH_CLIENT_SECRET (deployed app) or " +
        "GROK_PREVIEW_CLIENT_SECRET (live preview), or set " +
        "VITE_AUTH_ENABLED=false to disable authentication.",
    );
  }

  return {
    authConfigured: !authDisabled,
    grokIssuer,
    grokClientId,
    grokClientSecret,
  };
}
