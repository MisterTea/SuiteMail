import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, splitStatements } from "../src/services/db/migrations";

export interface FakeServerState {
  aiRequests: Array<{ url: string; body: unknown; timestamp: number }>;
  syncedFilters: Array<{
    folder: string;
    rawMessage: string;
    decodedEmail: string;
    payload: unknown;
    timestamp: number;
  }>;
}

export class FakeServer {
  private server: http.Server | null = null;
  public port: number;
  public db: DatabaseSync;
  public state: FakeServerState = {
    aiRequests: [],
    syncedFilters: [],
  };

  constructor(port = 3333) {
    this.port = port;
    this.db = new DatabaseSync(":memory:");
    this.initializeSchema();
    this.seedInitialData();
  }

  private initializeSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS _migrations (
        version INTEGER PRIMARY KEY,
        description TEXT,
        applied_at INTEGER DEFAULT (unixepoch())
      );
    `);

    for (const migration of MIGRATIONS) {
      const statements = splitStatements(migration.sql);
      try {
        this.db.exec("BEGIN");
        for (const statement of statements) {
          try {
            this.db.exec(statement);
          } catch (err: any) {
            if (err.message.includes("duplicate column")) {
              // ignore duplicate column
            } else {
              throw err;
            }
          }
        }
        const escapedDesc = migration.description.replace(/'/g, "''");
        this.db.exec(
          `INSERT OR IGNORE INTO _migrations (version, description) VALUES (${migration.version}, '${escapedDesc}');`,
        );
        this.db.exec("COMMIT");
      } catch (err) {
        try {
          this.db.exec("ROLLBACK");
        } catch {
          // ignore
        }
        console.error(`[FakeServer] Failed migration v${migration.version}:`, err);
        throw err;
      }
    }
  }

  public seedInitialData() {
    // 1. Account
    this.db.exec(`
      INSERT OR REPLACE INTO accounts (id, email, display_name, provider, imap_host, imap_port, is_active)
      VALUES ('acc-test-1', 'user@test.com', 'Test User', 'imap', 'imap.test.com', 993, 1);
    `);

    // 2. Settings
    this.db.exec(`
      INSERT OR REPLACE INTO settings (key, value) VALUES ('pi_server_url', 'http://localhost:${this.port}');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('pi_model', 'gemma-4-e4b');
      INSERT OR REPLACE INTO settings (key, value) VALUES ('active_account_id', 'acc-test-1');
    `);

    // 3. System Labels
    this.db.exec(`
      INSERT OR REPLACE INTO labels (id, account_id, name, type) VALUES ('INBOX', 'acc-test-1', 'Inbox', 'system');
      INSERT OR REPLACE INTO labels (id, account_id, name, type) VALUES ('SENT', 'acc-test-1', 'Sent', 'system');
      INSERT OR REPLACE INTO labels (id, account_id, name, type) VALUES ('TRASH', 'acc-test-1', 'Trash', 'system');
    `);

    // 4. Threads & Messages
    // Thread 1: Tech Weekly #101 (Unread, in INBOX)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-tw-1', 'acc-test-1', 'Tech Weekly #101: AI Agents & Innovations', 'Welcome to issue 101 of Tech Weekly!', 1700000100, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, date, is_read)
      VALUES ('m-tw-1', 'acc-test-1', 't-tw-1', 'newsletter@techweekly.com', 'Tech Weekly', 'user@test.com', 'Tech Weekly #101: AI Agents & Innovations', 'Welcome to issue 101 of Tech Weekly!', 1700000100, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-tw-1', 'acc-test-1', 'INBOX');
    `);

    // Thread 2: Tech Weekly #102 (Unread, in INBOX)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-tw-2', 'acc-test-1', 'Tech Weekly #102: Deep Dive into Gemma 4', 'Here is the latest scoop on local LLMs...', 1700000200, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, date, is_read)
      VALUES ('m-tw-2', 'acc-test-1', 't-tw-2', 'newsletter@techweekly.com', 'Tech Weekly', 'user@test.com', 'Tech Weekly #102: Deep Dive into Gemma 4', 'Here is the latest scoop on local LLMs...', 1700000200, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-tw-2', 'acc-test-1', 'INBOX');
    `);

    // Thread 3: Colleague message (Unread, in INBOX - should NOT match Tech Weekly filter)
    this.db.exec(`
      INSERT OR REPLACE INTO threads (id, account_id, subject, snippet, last_message_at, message_count, is_read, is_filtered)
      VALUES ('t-work-3', 'acc-test-1', 'Sprint Retrospective Notes', 'Here are the action items from our retrospective.', 1700000300, 1, 0, 1);

      INSERT OR REPLACE INTO messages (id, account_id, thread_id, from_address, from_name, to_addresses, subject, snippet, date, is_read)
      VALUES ('m-work-3', 'acc-test-1', 't-work-3', 'sarah@workplace.org', 'Sarah Miller', 'user@test.com', 'Sprint Retrospective Notes', 'Here are the action items from our retrospective.', 1700000300, 0);

      INSERT OR REPLACE INTO thread_labels (thread_id, account_id, label_id) VALUES ('t-work-3', 'acc-test-1', 'INBOX');
    `);
  }

  public reset() {
    this.state.aiRequests = [];
    this.state.syncedFilters = [];
    try {
      this.db.exec(`
        DELETE FROM thread_labels;
        DELETE FROM messages;
        DELETE FROM threads;
        DELETE FROM filter_rules;
        DELETE FROM labels WHERE type != 'system';
      `);
    } catch {
      // ignore
    }
    this.seedInitialData();
  }

  public async start(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // CORS Headers
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "*");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = req.url || "/";

        // Read request body
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(chunk);
        }
        const rawBody = Buffer.concat(chunks).toString("utf8");
        let parsedBody: any = null;
        if (rawBody.trim()) {
          try {
            parsedBody = JSON.parse(rawBody);
          } catch {
            parsedBody = rawBody;
          }
        }

        // 1. AI completions endpoint: POST /v1/chat/completions
        if (url.startsWith("/v1/chat/completions") && req.method === "POST") {
          this.state.aiRequests.push({
            url,
            body: parsedBody,
            timestamp: Date.now(),
          });

          // Return OpenAI format tool call invoking suggest_filter
          const responsePayload = {
            id: `chatcmpl-${Date.now()}`,
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "gemma-4-e4b",
            choices: [
              {
                index: 0,
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [
                    {
                      id: "call_suggest_filter_001",
                      type: "function",
                      function: {
                        name: "suggest_filter",
                        arguments: JSON.stringify({
                          name: "Tech Weekly Newsletters",
                          newFolder: "Newsletters",
                          criteria: {
                            from: "newsletter@techweekly.com",
                          },
                          actions: {
                            archive: true,
                            markRead: true,
                            applyLabel: "Newsletters",
                          },
                          explanation:
                            "Moves Tech Weekly emails into Newsletters folder, marks them as read, and archives them from inbox.",
                        }),
                      },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          };

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(responsePayload));
          return;
        }

        // 2. Settings Sync endpoint: POST /api/sync/filters
        if (url === "/api/sync/filters" && req.method === "POST") {
          let decodedEmail = "";
          let filterPayload = null;

          try {
            const base64Url = parsedBody.rawMessage || "";
            const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
            const buf = Buffer.from(base64, "base64");
            decodedEmail = buf.toString("utf8");

            const jsonStart = decodedEmail.indexOf("\r\n\r\n");
            const rawJson = jsonStart !== -1 ? decodedEmail.slice(jsonStart).trim() : decodedEmail;
            filterPayload = JSON.parse(rawJson);
          } catch (err) {
            console.warn("[FakeServer] Error parsing raw sync email:", err);
          }

          this.state.syncedFilters.push({
            folder: parsedBody.folder,
            rawMessage: parsedBody.rawMessage,
            decodedEmail,
            payload: filterPayload,
            timestamp: Date.now(),
          });

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, count: this.state.syncedFilters.length }));
          return;
        }

        // 3. Query synced filters: GET /api/sync/filters
        if (url === "/api/sync/filters" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(this.state.syncedFilters));
          return;
        }

        // 4. Query AI requests: GET /api/ai/requests
        if (url === "/api/ai/requests" && req.method === "GET") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify(this.state.aiRequests));
          return;
        }

        // 5. Database execution endpoint: POST /api/sql
        if (url === "/api/sql" && req.method === "POST") {
          const { cmd, args } = parsedBody;
          const { query = "", values = [] } = args || {};

          try {
            const trimmed = query.trim();
            const upper = trimmed.toUpperCase();

            // Handle transaction commands safely
            if (upper === "BEGIN" || upper === "BEGIN TRANSACTION") {
              try {
                this.db.exec("BEGIN");
              } catch (txErr: any) {
                // If transaction already active, ignore
                if (!txErr.message.includes("cannot start a transaction")) {
                  throw txErr;
                }
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify([0, 0]));
              return;
            }

            if (upper === "COMMIT") {
              try {
                this.db.exec("COMMIT");
              } catch (txErr: any) {
                if (!txErr.message.includes("cannot commit")) {
                  throw txErr;
                }
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify([0, 0]));
              return;
            }

            if (upper === "ROLLBACK") {
              try {
                this.db.exec("ROLLBACK");
              } catch {
                // ignore
              }
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify([0, 0]));
              return;
            }

            if (cmd === "plugin:sql|execute") {
              if (values.length === 0) {
                this.db.exec(trimmed);
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify([0, 0]));
                return;
              }
              const normalized = trimmed.replace(/\$(\d+)/g, "?$1");
              const stmt = this.db.prepare(normalized);
              const result = stmt.run(...values);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify([Number(result.changes), Number(result.lastInsertRowid)]));
              return;
            }

            if (cmd === "plugin:sql|select") {
              if (values.length === 0) {
                const stmt = this.db.prepare(trimmed);
                const rows = stmt.all();
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify(rows));
                return;
              }
              const normalized = trimmed.replace(/\$(\d+)/g, "?$1");
              const stmt = this.db.prepare(normalized);
              const rows = stmt.all(...values);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify(rows));
              return;
            }

            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: `Unknown SQL cmd: ${cmd}` }));
          } catch (sqlErr: any) {
            console.error("[FakeServer] SQL Error:", sqlErr.message, "Query:", query);
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: sqlErr.message }));
          }
          return;
        }

        // 6. Status check
        if (url === "/api/status") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ status: "ok", port: this.port }));
          return;
        }

        res.writeHead(404);
        res.end("Not Found");
      });

      this.server.listen(this.port, () => {
        resolve(`http://localhost:${this.port}`);
      });

      this.server.on("error", (err) => {
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }
}
