import { GraphQLClient } from "graphql-request";
import { DocumentNode } from "graphql";
import { HttpsProxyAgent } from "https-proxy-agent";
import { HttpProxyAgent } from "http-proxy-agent";
import type { Agent } from "http";
import {
  QueryResponse,
  Variables,
  SearchRentalsInput,
  SearchRentalsResponse,
  RentalListingDetailsResponse,
  RentalListingDetailsVariables,
} from "./types";
import {
  buildSearchRentalsQuery,
  RENTAL_LISTING_DETAILS_QUERY,
} from "./queries";
import { v4 as uuidv4 } from "uuid";

export interface StreetEasyConfig {
  endpoint?: string;
  /**
   * Optional HTTP/HTTPS proxy to route all requests through, e.g.
   * `"http://user:pass@host:port"`. When omitted, the client falls back to the
   * `STREETEASY_PROXY`, `HTTPS_PROXY`/`https_proxy`, or `ALL_PROXY`/`all_proxy`
   * environment variables (in that order). Pass an empty string (`""`) to
   * force a direct connection and ignore those environment variables.
   *
   * StreetEasy blocks datacenter/cloud IPs (PerimeterX), so a residential proxy
   * is what lets a hosted deployment reach the API.
   */
  proxy?: string;
  /**
   * How many times to retry a request that comes back as a PerimeterX bot
   * challenge (HTTP 403). Rotating residential proxies hand out a fresh IP per
   * connection, so a retry usually lands on a clean IP. Only applied when a
   * proxy is configured; defaults to 3 in that case, 0 otherwise.
   */
  maxRetries?: number;
}

/** Detect StreetEasy's PerimeterX bot-challenge responses (worth retrying). */
function isBotChallenge(message: string): boolean {
  return /Code:\s*403|PerimeterX|px-cloud\.net|captcha|_px/i.test(message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Resolve a proxy URL from the environment, mirroring the precedence used by
 * curl and most HTTP clients.
 */
function resolveEnvProxy(): string | undefined {
  return (
    process.env.STREETEASY_PROXY ||
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy ||
    undefined
  );
}

/**
 * Build a `node-fetch` `agent` selector that tunnels requests through the given
 * proxy. HTTPS targets are tunnelled via an HTTP `CONNECT` (`HttpsProxyAgent`);
 * plain HTTP targets use `HttpProxyAgent`. The agents are created once and
 * reused for every request.
 */
function createProxyAgent(proxyUrl: string): (parsedUrl: URL) => Agent {
  const httpsAgent = new HttpsProxyAgent(proxyUrl);
  const httpAgent = new HttpProxyAgent(proxyUrl);
  return (parsedUrl: URL): Agent =>
    parsedUrl.protocol === "http:" ? httpAgent : httpsAgent;
}

// `graphql-request` does not re-export `RequestConfig`, so derive it from the
// `GraphQLClient` constructor signature. `agent` is a `node-fetch` option that
// is not part of the DOM `RequestInit` the type is built from, so add it here.
type GraphQLRequestConfig = NonNullable<
  ConstructorParameters<typeof GraphQLClient>[1]
> & {
  agent?: (parsedUrl: URL) => Agent;
};

export class StreetEasyClient {
  private readonly client: GraphQLClient;
  private readonly endpoint: string = "https://api-v6.streeteasy.com/";
  /** The proxy URL in effect for this client, if any. */
  public readonly proxy?: string;
  private readonly maxRetries: number;

  constructor(config: StreetEasyConfig = {}) {
    this.proxy = config.proxy ?? resolveEnvProxy();
    // Retrying only helps when a rotating proxy gives us a fresh IP each try.
    this.maxRetries = config.maxRetries ?? (this.proxy ? 3 : 0);

    const requestConfig: GraphQLRequestConfig = {
      headers: {
        Host: "api-v6.streeteasy.com",
        Connection: "keep-alive",
        "Sec-Ch-Ua-Platform": '"macOS"',
        "X-Forwarded-Proto": "https",
        "Sec-Ch-Ua": '"Chromium";v="133", "Not(A:Brand";v="99"',
        "Sec-Ch-Ua-Mobile": "?0",
        "App-Version": "1.0.0",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Apollographql-Client-Version":
          "version  50bef71ef923e981bdcb7c781851c3bfdb12a0c1",
        "Apollographql-Client-Name": "srp-frontend-service",
        Os: "web",
        Dnt: "1",
        Origin: "https://streeteasy.com",
        "Sec-Fetch-Site": "same-site",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
        Referer: "https://streeteasy.com/",
        "Accept-Language": "en-US,en;q=0.9",
        "Content-Type": "application/json",
      },
    };

    // `graphql-request` spreads any extra request-config keys straight into the
    // `node-fetch` init, and `node-fetch` honours the `agent` option — so this
    // is all that's needed to route GraphQL traffic through the proxy.
    if (this.proxy) {
      requestConfig.agent = createProxyAgent(this.proxy);
    }

    this.client = new GraphQLClient(
      config.endpoint || this.endpoint,
      requestConfig,
    );
  }

  /**
   * Execute a GraphQL query
   * @param document The GraphQL query or mutation
   * @param variables Optional variables for the query
   * @returns The query result
   */
  public async request<TData>(
    document: string | DocumentNode,
    variables?: Variables,
  ): Promise<TData> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.client.request<TData>(document, variables);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        // A PerimeterX 403 is IP-reputation based, so retry through the
        // (rotating) proxy for a fresh exit IP before giving up.
        if (attempt < this.maxRetries && isBotChallenge(message)) {
          await sleep(250 * (attempt + 1));
          continue;
        }
        throw new Error(`StreetEasy GraphQL Error: ${message}`);
      }
    }
  }

  /**
   * Search for rental listings.
   *
   * Note on implementation: the StreetEasy GraphQL server rejects enum values
   * sent as JSON strings in query variables (e.g. `sorting.attribute`,
   * `rentalStatus`, `adStrategy`). We therefore build the query with all enum
   * values inlined as bare GraphQL tokens via `buildSearchRentalsQuery`, and
   * issue the request without variables. This mirrors how the StreetEasy
   * frontend calls the same endpoint.
   *
   * @param input Search parameters
   * @returns Search results
   */
  public async searchRentals(
    input: SearchRentalsInput,
  ): Promise<SearchRentalsResponse> {
    const inputWithDefaults = {
      ...input,
      adStrategy: input.adStrategy || "NONE",
      userSearchToken: input.userSearchToken || uuidv4(),
    };

    const query = buildSearchRentalsQuery(inputWithDefaults);
    return this.request<SearchRentalsResponse>(query);
  }

  /**
   * Get detailed information about a specific rental listing
   * @param listingID The ID of the rental listing to fetch
   * @returns Detailed rental listing information
   */
  public async getRentalListingDetails(
    listingID: string,
  ): Promise<RentalListingDetailsResponse> {
    return this.request<RentalListingDetailsResponse>(
      RENTAL_LISTING_DETAILS_QUERY,
      { listingID },
    );
  }
}

/** Resolve the proxy URL the client would use from the environment, if any. */
export function resolveProxyFromEnv(): string | undefined {
  return resolveEnvProxy();
}

/** Mask any credentials in a proxy URL so it is safe to log. */
export function redactProxyUrl(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    if (u.username) u.username = "***";
    if (u.password) u.password = "***";
    return u.toString();
  } catch {
    return proxyUrl;
  }
}

// Export types and constants for external use
export * from "./types";
export * from "./constants";
