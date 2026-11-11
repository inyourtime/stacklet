export type Bindings = {
  DB: D1Database;
  APP_ENV: "local" | "staging" | "production";
  DEV_AUTH_BYPASS?: string;
  APP_ORIGIN: string;
  ACCESS_ISSUER?: string;
  ACCESS_AUD?: string;
  OWNER_EMAIL?: string;
  IMPORT_SIGNING_SECRET?: string;
};

export type AppEnv = { Bindings: Bindings; Variables: { requestId: string } };
