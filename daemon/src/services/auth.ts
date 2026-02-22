import { OAuth2Client } from "google-auth-library";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type AuthMethod = "gemini-cli-oauth";

export interface AuthResult {
  oauth2Client: OAuth2Client;
  projectId: string;
  method: AuthMethod;
}

// Load Gemini CLI OAuth credentials from environment or config file.
// These are the public credentials embedded in Google's open-source gemini-cli.
function loadOAuthCredentials(): { clientId: string; clientSecret: string } {
  if (process.env.GEMINI_CLI_CLIENT_ID && process.env.GEMINI_CLI_CLIENT_SECRET) {
    return {
      clientId: process.env.GEMINI_CLI_CLIENT_ID,
      clientSecret: process.env.GEMINI_CLI_CLIENT_SECRET,
    };
  }

  const configPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "oauth-client.json",
  );
  try {
    const raw = readFileSync(configPath, "utf-8");
    const config = JSON.parse(raw);
    return { clientId: config.clientId, clientSecret: config.clientSecret };
  } catch {
    throw new Error(
      "Gemini CLI OAuth credentials not found. Either:\n" +
        "  1. Set GEMINI_CLI_CLIENT_ID and GEMINI_CLI_CLIENT_SECRET env vars, or\n" +
        "  2. Create daemon/oauth-client.json (see oauth-client.example.json)\n" +
        "  The credentials are public — find them in the gemini-cli source:\n" +
        "  https://github.com/google-gemini/gemini-cli",
    );
  }
}

const { clientId: GEMINI_CLI_CLIENT_ID, clientSecret: GEMINI_CLI_CLIENT_SECRET } =
  loadOAuthCredentials();

const OAUTH_CREDS_PATH = join(homedir(), ".gemini", "oauth_creds.json");

const CODE_ASSIST_BASE = "https://cloudcode-pa.googleapis.com/v1internal";

interface OAuthCreds {
  access_token: string;
  refresh_token: string;
  expiry_date: number;
  scope: string;
  token_type: string;
}

async function getAccessToken(oauth2Client: OAuth2Client): Promise<string> {
  const tokenRes = await oauth2Client.getAccessToken();
  if (!tokenRes.token) throw new Error("Failed to obtain access token");
  return tokenRes.token;
}

async function loadProjectId(oauth2Client: OAuth2Client): Promise<string> {
  const envProject =
    process.env["GOOGLE_CLOUD_PROJECT"] ??
    process.env["GOOGLE_CLOUD_PROJECT_ID"];

  const token = await getAccessToken(oauth2Client);

  const res = await fetch(`${CODE_ASSIST_BASE}:loadCodeAssist`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cloudaicompanionProject: envProject,
      metadata: {
        ideType: "IDE_UNSPECIFIED",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
        duetProject: envProject,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`loadCodeAssist failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    cloudaicompanionProject?: string;
    currentTier?: { id: number; name: string };
  };

  const projectId = data.cloudaicompanionProject ?? envProject;
  if (!projectId) {
    throw new Error(
      "Could not determine project ID. Set GOOGLE_CLOUD_PROJECT env var " +
        "or ensure your account is onboarded via `gemini auth login`.",
    );
  }

  if (data.currentTier?.name) {
    console.log(`[auth] Tier: ${data.currentTier.name}`);
  }

  return projectId;
}

export interface QuotaInfo {
  modelId: string;
  percentLeft: number;
  resetTime: string | null;
  resetDescription: string;
}

function formatResetTime(resetTime: string): string {
  const diff = new Date(resetTime).getTime() - Date.now();
  if (diff <= 0) return "Resetting...";
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 0) return `Resets in ${hours}h ${minutes}m`;
  return `Resets in ${minutes}m`;
}

export async function fetchQuota(
  oauth2Client: OAuth2Client,
  projectId: string,
): Promise<QuotaInfo[]> {
  const token = await getAccessToken(oauth2Client);
  const res = await fetch(`${CODE_ASSIST_BASE}:retrieveUserQuota`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ project: projectId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`retrieveUserQuota failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    buckets?: Array<{
      remainingFraction: number;
      resetTime?: string;
      modelId?: string;
      tokenType?: string;
    }>;
  };

  if (!data.buckets?.length) return [];

  // Group by model, keep lowest remainingFraction per model
  const byModel = new Map<
    string,
    { fraction: number; resetTime: string | null }
  >();

  for (const b of data.buckets) {
    const raw = b.modelId ?? "unknown";
    // Skip _vertex duplicates — same quota, different suffix
    if (raw.endsWith("_vertex")) continue;
    const model = raw;
    const existing = byModel.get(model);
    if (!existing || b.remainingFraction < existing.fraction) {
      byModel.set(model, {
        fraction: b.remainingFraction,
        resetTime: b.resetTime ?? null,
      });
    }
  }

  const quotas: QuotaInfo[] = [];
  for (const [modelId, info] of byModel) {
    quotas.push({
      modelId,
      percentLeft: Math.round(info.fraction * 100),
      resetTime: info.resetTime,
      resetDescription: info.resetTime
        ? formatResetTime(info.resetTime)
        : "—",
    });
  }

  // Sort by model name
  quotas.sort((a, b) => a.modelId.localeCompare(b.modelId));
  return quotas;
}

export async function resolveAuth(): Promise<AuthResult> {
  let raw: string;
  try {
    raw = await readFile(OAUTH_CREDS_PATH, "utf-8");
  } catch {
    throw new Error(
      `No OAuth credentials found at ${OAUTH_CREDS_PATH}. ` +
        "Run `gemini auth login` to authenticate.",
    );
  }

  let creds: OAuthCreds;
  try {
    creds = JSON.parse(raw);
  } catch {
    throw new Error(
      `Failed to parse ${OAUTH_CREDS_PATH}. ` +
        "Try running `gemini auth login` again.",
    );
  }

  if (!creds.refresh_token) {
    throw new Error(
      `No refresh_token in ${OAUTH_CREDS_PATH}. ` +
        "Run `gemini auth login` to re-authenticate.",
    );
  }

  const oauth2Client = new OAuth2Client(
    GEMINI_CLI_CLIENT_ID,
    GEMINI_CLI_CLIENT_SECRET,
  );

  oauth2Client.setCredentials({
    access_token: creds.access_token,
    refresh_token: creds.refresh_token,
    expiry_date: creds.expiry_date,
    token_type: creds.token_type,
  });

  // Verify we can get a valid token (triggers refresh if expired)
  try {
    await oauth2Client.getAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Failed to obtain access token: ${message}. ` +
        "Try running `gemini auth login` again.",
    );
  }

  // Get project ID from Code Assist API
  const projectId = await loadProjectId(oauth2Client);

  console.log("[auth] Using gemini-cli OAuth credentials");
  return { oauth2Client, projectId, method: "gemini-cli-oauth" };
}
