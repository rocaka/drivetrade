import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveBrokerAuthConfig } from "./broker-config.server.ts";
import { GROK_ISSUER_DEFAULT, PREVIEW_CLIENT_ID } from "./preview.ts";

describe("broker authentication configuration", () => {
  it("keeps explicitly disabled authentication usable without credentials", () => {
    const config = resolveBrokerAuthConfig({ VITE_AUTH_ENABLED: " false " });
    assert.equal(config.authConfigured, false);
    assert.equal(config.grokClientSecret, undefined);
    assert.equal(config.grokIssuer, GROK_ISSUER_DEFAULT);
    assert.equal(config.grokClientId, PREVIEW_CLIENT_ID);
  });

  it("rejects missing credentials when authentication is enabled or unset", () => {
    for (const flag of ["true", undefined]) {
      assert.throws(
        () => resolveBrokerAuthConfig({ VITE_AUTH_ENABLED: flag }),
        /Authentication is enabled.*GROK_AUTH_CLIENT_SECRET.*GROK_PREVIEW_CLIENT_SECRET/,
      );
    }
  });

  it("rejects whitespace credentials instead of falling back to dev identity", () => {
    assert.throws(
      () =>
        resolveBrokerAuthConfig({
          VITE_AUTH_ENABLED: "true",
          GROK_AUTH_CLIENT_SECRET: "   ",
          GROK_PREVIEW_CLIENT_SECRET: "\t",
        }),
      /no OAuth client secret is configured/,
    );
  });

  it("prefers the deployed app configuration over preview credentials", () => {
    const config = resolveBrokerAuthConfig({
      VITE_AUTH_ENABLED: "true",
      GROK_AUTH_ISSUER: " https://auth.example.invalid ",
      GROK_AUTH_CLIENT_ID: " deployed-client ",
      GROK_AUTH_CLIENT_SECRET: " deployment-test-value ",
      GROK_PREVIEW_CLIENT_SECRET: "preview-test-value",
    });
    assert.equal(config.authConfigured, true);
    assert.equal(config.grokIssuer, "https://auth.example.invalid");
    assert.equal(config.grokClientId, "deployed-client");
    assert.equal(config.grokClientSecret, "deployment-test-value");
  });

  it("accepts environment-only preview credentials with the public defaults", () => {
    const config = resolveBrokerAuthConfig({
      VITE_AUTH_ENABLED: "true",
      GROK_AUTH_CLIENT_SECRET: " ",
      GROK_PREVIEW_CLIENT_SECRET: " preview-test-value ",
    });
    assert.equal(config.authConfigured, true);
    assert.equal(config.grokIssuer, GROK_ISSUER_DEFAULT);
    assert.equal(config.grokClientId, PREVIEW_CLIENT_ID);
    assert.equal(config.grokClientSecret, "preview-test-value");
  });
});
