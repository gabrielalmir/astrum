import fs from "node:fs";

function isTruthy(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export interface HttpsRuntimeConfig {
  enabled: boolean;
  https?: {
    key: Buffer;
    cert: Buffer;
    ca?: Buffer;
  };
  protocol: "http" | "https";
}

export function buildHttpsRuntimeConfig(): HttpsRuntimeConfig {
  const httpsEnabled = isTruthy(process.env.HTTPS_ENABLED);

  if (!httpsEnabled) {
    return {
      enabled: false,
      protocol: "http",
    };
  }

  const keyPath = process.env.HTTPS_KEY_PATH;
  const certPath = process.env.HTTPS_CERT_PATH;

  if (!keyPath || !certPath) {
    throw new Error(
      "HTTPS_ENABLED is true, but HTTPS_KEY_PATH or HTTPS_CERT_PATH is missing.",
    );
  }

  const caPath = process.env.HTTPS_CA_PATH;
  const https = {
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
    ...(caPath ? { ca: fs.readFileSync(caPath) } : {}),
  };

  return {
    enabled: true,
    protocol: "https",
    https,
  };
}
