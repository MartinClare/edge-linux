import { mkdir, readFile, writeFile } from "fs/promises";
import { dirname, join } from "path";

const CONFIG_PATH = join(process.cwd(), "..", "data", "cmp-runtime-config.json");

type RuntimeConfig = {
  mobilePublicBaseUrl?: string | null;
};

function normalizeBaseUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const url = new URL(trimmed);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("URL must start with http:// or https://");
  }

  return url.toString().replace(/\/$/, "");
}

async function readRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed = JSON.parse(raw) as RuntimeConfig;
    return {
      mobilePublicBaseUrl: normalizeBaseUrl(parsed.mobilePublicBaseUrl),
    };
  } catch {
    return {};
  }
}

async function writeRuntimeConfig(config: RuntimeConfig) {
  await mkdir(dirname(CONFIG_PATH), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

export async function getRuntimeConfig() {
  return readRuntimeConfig();
}

export async function setMobilePublicBaseUrl(value: string | null | undefined) {
  const config = await readRuntimeConfig();
  config.mobilePublicBaseUrl = normalizeBaseUrl(value);
  await writeRuntimeConfig(config);
  return config;
}

export async function getMobilePublicBaseUrl() {
  if (process.env.CMP_PUBLIC_BASE_URL) {
    return normalizeBaseUrl(process.env.CMP_PUBLIC_BASE_URL);
  }

  const config = await readRuntimeConfig();
  return config.mobilePublicBaseUrl ?? null;
}

export async function resolveMobilePublicBaseUrl(requestUrl: string) {
  const configured = await getMobilePublicBaseUrl();
  if (configured) return configured;
  return new URL(requestUrl).origin;
}
