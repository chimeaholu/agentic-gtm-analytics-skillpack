/** Server configuration, read once at startup. No tool ever receives a credential. */

export type AuthFlow = 'jwt' | 'client_credentials' | 'refresh_token';

export interface Config {
  loginUrl: string;
  apiVersion: string;
  authFlow: AuthFlow;
  clientId: string;
  clientSecret?: string;
  username?: string;
  privateKeyPem?: string;
  refreshToken?: string;
  enableWrites: boolean;
  writeFolderAllowlist: string[] | null;
  largeExtractRows: number;
  maxSyncRunsPerHour: number;
  maxAsyncRequestsPerHour: number;
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required for this auth flow. See .env.example.`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const authFlow = (env.SF_AUTH_FLOW ?? 'jwt') as AuthFlow;
  if (!['jwt', 'client_credentials', 'refresh_token'].includes(authFlow)) {
    throw new Error(`SF_AUTH_FLOW must be jwt, client_credentials or refresh_token (got "${authFlow}")`);
  }

  // The private key is base64-encoded on purpose: newlines in a PEM pasted into an
  // environment variable arrive as the two characters \ and n, and the resulting
  // signature failure names neither newlines nor the variable.
  let privateKeyPem: string | undefined;
  if (authFlow === 'jwt') {
    const b64 = req('SF_PRIVATE_KEY_B64');
    privateKeyPem = Buffer.from(b64, 'base64').toString('utf8');
    if (!privateKeyPem.includes('-----BEGIN')) {
      throw new Error(
        'SF_PRIVATE_KEY_B64 did not decode to a PEM private key. ' +
        'Encode the whole .key file: base64 -w0 server.key',
      );
    }
  }

  const allowlist = env.SF_WRITE_FOLDER_ALLOWLIST?.split(',').map(s => s.trim()).filter(Boolean);

  return {
    loginUrl: (env.SF_LOGIN_URL ?? 'https://login.salesforce.com').replace(/\/+$/, ''),
    apiVersion: env.SF_API_VERSION ?? 'v60.0',
    authFlow,
    clientId: req('SF_CLIENT_ID'),
    clientSecret: env.SF_CLIENT_SECRET,
    username: authFlow === 'jwt' ? req('SF_USERNAME') : env.SF_USERNAME,
    privateKeyPem,
    refreshToken: authFlow === 'refresh_token' ? req('SF_REFRESH_TOKEN') : env.SF_REFRESH_TOKEN,
    // Writes are off unless the string is exactly "true". Anything else — unset,
    // "1", "yes", "TRUE " — is off, because a write gate that guesses is not a gate.
    enableWrites: env.SF_ENABLE_REPORT_WRITES === 'true',
    writeFolderAllowlist: allowlist && allowlist.length ? allowlist : null,
    largeExtractRows: Number(env.SF_LARGE_EXTRACT_ROWS ?? 250_000),
    maxSyncRunsPerHour: Number(env.SF_MAX_SYNC_RUNS_PER_HOUR ?? 450),
    maxAsyncRequestsPerHour: Number(env.SF_MAX_ASYNC_REQUESTS_PER_HOUR ?? 1000),
  };
}
