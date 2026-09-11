import { randomUUID } from "node:crypto";
import type { Response } from "express";
import type {
  OAuthServerProvider,
  AuthorizationParams,
} from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidRequestError,
  InvalidGrantError,
  InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour

interface StoredCode {
  client: OAuthClientInformationFull;
  params: AuthorizationParams;
}

interface StoredToken {
  clientId: string;
  scopes: string[];
  expiresAtMs: number;
  resource?: URL;
}

/** In-memory client registry — backs Dynamic Client Registration (RFC 7591). */
class InMemoryClientsStore implements OAuthRegisteredClientsStore {
  private readonly clients = new Map<string, OAuthClientInformationFull>();

  async getClient(
    clientId: string,
  ): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }

  // The SDK's registration handler generates the client_id/secret and passes
  // the full record here; we just persist it.
  async registerClient(
    client: OAuthClientInformationFull,
  ): Promise<OAuthClientInformationFull> {
    this.clients.set(client.client_id, client);
    return client;
  }
}

/**
 * A self-contained OAuth 2.1 provider that auto-approves authorization.
 *
 * This MCP server wraps public rental data — there is no per-user resource to
 * protect. The OAuth layer exists only so that MCP clients which require the
 * authorization flow (with Dynamic Client Registration) can connect. So:
 * registration accepts any client, the authorization step issues a code with no
 * human consent screen, and the issued bearer tokens simply gate `/mcp`.
 * PKCE is still enforced by the SDK's token handler via
 * {@link challengeForAuthorizationCode}.
 *
 * Tokens live in memory (the service runs a single replica). A restart drops
 * them; clients transparently re-run the flow on their next request.
 */
export class StreetEasyAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new InMemoryClientsStore();
  private readonly codes = new Map<string, StoredCode>();
  private readonly accessTokens = new Map<string, StoredToken>();
  private readonly refreshTokens = new Map<string, StoredToken>();

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    if (!client.redirect_uris.includes(params.redirectUri)) {
      throw new InvalidRequestError("Unregistered redirect_uri");
    }

    const code = randomUUID();
    this.codes.set(code, { client, params });

    // No consent screen — there is no user to authenticate. Redirect straight
    // back to the client with the authorization code (and state, if given).
    const search = new URLSearchParams({ code });
    if (params.state !== undefined) search.set("state", params.state);
    const target = new URL(params.redirectUri);
    target.search = search.toString();
    res.redirect(target.toString());
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const data = this.codes.get(authorizationCode);
    if (!data) throw new InvalidGrantError("Invalid authorization code");
    return data.params.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<OAuthTokens> {
    const data = this.codes.get(authorizationCode);
    if (!data) throw new InvalidGrantError("Invalid authorization code");
    if (data.client.client_id !== client.client_id) {
      throw new InvalidGrantError(
        "Authorization code was not issued to this client",
      );
    }
    this.codes.delete(authorizationCode);
    return this.issueTokens(
      client.client_id,
      data.params.scopes ?? [],
      data.params.resource,
    );
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
  ): Promise<OAuthTokens> {
    const data = this.refreshTokens.get(refreshToken);
    if (!data || data.clientId !== client.client_id) {
      throw new InvalidGrantError("Invalid refresh token");
    }
    // Rotate: a refresh token is single-use.
    this.refreshTokens.delete(refreshToken);
    return this.issueTokens(
      client.client_id,
      scopes && scopes.length > 0 ? scopes : data.scopes,
      data.resource,
    );
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const data = this.accessTokens.get(token);
    if (!data || data.expiresAtMs < Date.now()) {
      throw new InvalidTokenError("Token is invalid or expired");
    }
    return {
      token,
      clientId: data.clientId,
      scopes: data.scopes,
      expiresAt: Math.floor(data.expiresAtMs / 1000),
      resource: data.resource,
    };
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    this.accessTokens.delete(request.token);
    this.refreshTokens.delete(request.token);
  }

  private issueTokens(
    clientId: string,
    scopes: string[],
    resource?: URL,
  ): OAuthTokens {
    const accessToken = randomUUID();
    const refreshToken = randomUUID();
    this.accessTokens.set(accessToken, {
      clientId,
      scopes,
      resource,
      expiresAtMs: Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000,
    });
    this.refreshTokens.set(refreshToken, {
      clientId,
      scopes,
      resource,
      expiresAtMs: Number.MAX_SAFE_INTEGER, // refresh tokens don't expire here
    });
    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      scope: scopes.join(" "),
      refresh_token: refreshToken,
    };
  }
}
