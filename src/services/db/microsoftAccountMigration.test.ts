import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MIGRATIONS, runMigrations, splitStatements } from "./migrations";

let sqlite: DatabaseSync;
vi.mock("./connection", () => ({
  getDb: async () => ({
    execute: async (sql: string, params: any[] = []) => sqlite.prepare(sql.replace(/\$\d+/g, "?")).run(...params),
    select: async (sql: string, params: any[] = []) => sqlite.prepare(sql.replace(/\$\d+/g, "?")).all(...params),
  }),
}));
afterEach(() => sqlite?.close());

describe("Microsoft account schema upgrade", () => {
  for (const existingTenant of [false, true]) {
    it(`upgrades existing accounts when tenant column already exists: ${existingTenant}`, async () => {
      sqlite = new DatabaseSync(":memory:");
      for (const migration of MIGRATIONS.filter((m) => m.version < 32)) {
        for (const sql of splitStatements(migration.sql)) sqlite.exec(sql);
        sqlite.prepare("INSERT OR IGNORE INTO _migrations (version) VALUES (?)").run(migration.version);
      }
      sqlite.exec("INSERT INTO accounts (id, email) VALUES ('existing', 'existing@example.com')");
      if (existingTenant) sqlite.exec("ALTER TABLE accounts ADD COLUMN oauth_tenant TEXT");
      await runMigrations();
      await runMigrations();
      sqlite.exec(`INSERT INTO accounts (id, email, provider, oauth_tenant, oauth_redirect_uri)
        VALUES ('ews', 'ews@example.com', 'ews', 'example.com', 'https://login.microsoftonline.com/common/oauth2/nativeclient')`);
      expect(sqlite.prepare("SELECT oauth_tenant FROM accounts WHERE id = 'ews'").get()?.oauth_tenant).toBe("example.com");
      expect(sqlite.prepare("SELECT email FROM accounts WHERE id = 'existing'").get()?.email).toBe("existing@example.com");
    });
  }
});
