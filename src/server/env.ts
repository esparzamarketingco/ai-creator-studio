import { z } from "zod";

const hex64 = z
  .string()
  .regex(/^[0-9a-f]{64}$/i, "must be 64 hex characters (openssl rand -hex 32)");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_ENCRYPTION_KEY: hex64,
  MEDIA_SIGNING_KEY: hex64,
  ALLOW_REGISTRATION: z.enum(["true", "false"]).default("true"),
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_DIR: z.string().default("./.storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("false"),
  SMTP_URL: z.string().optional(),
  EMAIL_FROM: z.string().default("AI Creator Studio <no-reply@example.com>"),
  ENABLE_MOCK_PROVIDERS: z.enum(["true", "false"]).default("true"),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(5000),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Validated server environment. Throws with a readable message if misconfigured. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  if (parsed.data.NODE_ENV === "production" && parsed.data.ENABLE_MOCK_PROVIDERS === "true") {
    // Allowed, but mock outputs are always flagged as simulated and can never be published
    // to a real destination.
    console.warn("[env] ENABLE_MOCK_PROVIDERS=true in production: simulated providers are visible.");
  }
  cached = parsed.data;
  return cached;
}

export const mockProvidersEnabled = () => env().ENABLE_MOCK_PROVIDERS === "true";
