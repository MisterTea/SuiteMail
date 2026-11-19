/**
 * Browser-side injection script for Playwright that provides the Tauri IPC bridge
 * connecting SQLite and sync operations directly to our Fake Server.
 */
export function getTauriBridgeScript(fakeServerPort = 3333): string {
  return `
    (() => {
      const SERVER_URL = 'http://localhost:${fakeServerPort}';

      let callbackIdCounter = 1;
      const callbacks = new Map();

      window.__TAURI_INTERNALS__ = {
        metadata: {
          currentWindow: { label: "main" },
          currentWebview: { label: "main" }
        },
        transformCallback: (callback, once) => {
          const id = callbackIdCounter++;
          callbacks.set(id, { callback, once });
          return id;
        },
        unregisterCallback: (id) => {
          callbacks.delete(id);
        },
        invoke: async (cmd, args = {}) => {
          // SQL Plugin handling -> delegate to Fake Server SQLite
          if (cmd === 'plugin:sql|load') {
            return args.db || 'sqlite:suitemail.db';
          }
          if (cmd === 'plugin:sql|execute' || cmd === 'plugin:sql|select') {
            try {
              const res = await window.fetch(SERVER_URL + '/api/sql', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ cmd, args })
              });
              if (!res.ok) {
                const errJson = await res.json().catch(() => ({}));
                throw new Error(errJson.error || ('SQL Error on server: ' + res.status));
              }
              return await res.json();
            } catch (err) {
              console.error('[TauriBridge] SQL error during ' + cmd, err);
              throw err;
            }
          }

          // IMAP Tauri commands -> delegate to Fake Server Sync
          if (cmd === 'imap_append_message') {
            try {
              await window.fetch(SERVER_URL + '/api/sync/filters', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  folder: args.folder,
                  rawMessage: args.rawMessage,
                  flags: args.flags
                })
              });
            } catch (syncErr) {
              console.warn('[TauriBridge] Sync post error:', syncErr);
            }
            return undefined;
          }

          if (cmd === 'imap_list_folders') {
            return [
              {
                path: 'INBOX',
                raw_path: 'INBOX',
                name: 'INBOX',
                delimiter: '/',
                special_use: '\\\\Inbox',
                exists: 3,
                unseen: 3
              }
            ];
          }

          if (cmd === 'imap_search_all_uids') {
            return [];
          }

          if (cmd === 'imap_search_folder') {
            return {
              uids: [],
              folder_status: { uidvalidity: 1, uidnext: 2, exists: 0, unseen: 0, highest_modseq: null }
            };
          }

          if (cmd === 'imap_create_folder' || cmd === 'imap_delete_messages' || cmd === 'imap_set_flags' || cmd === 'imap_move_messages') {
            return undefined;
          }

          if (cmd === 'imap_fetch_messages') {
            return {
              messages: [],
              folder_status: { uidvalidity: 1, uidnext: 2, exists: 0, unseen: 0, highest_modseq: null }
            };
          }

          if (cmd === 'imap_get_folder_status') {
            return { uidvalidity: 1, uidnext: 2, exists: 0, unseen: 0, highest_modseq: null };
          }

          if (cmd === 'smtp_send_email') {
            try {
              await window.fetch(SERVER_URL + '/api/smtp/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args)
              });
            } catch (err) {
              console.warn('[TauriBridge] SMTP send error:', err);
            }
            return { success: true, message: 'Message sent successfully' };
          }

          if (cmd === 'smtp_test_connection') {
            return { success: true, message: 'Connected' };
          }

          if (cmd.startsWith('plugin:http|')) {
            throw new TypeError('Tauri plugin:http invoke not available, use browser fetch');
          }

          // App lifecycle & window stubs
          if (cmd === 'close_splashscreen') return null;
          if (cmd === 'set_tray_tooltip') return null;
          if (cmd.startsWith('plugin:window|')) {
            if (cmd === 'plugin:window|is_maximized') return false;
            return null;
          }
          if (cmd.startsWith('plugin:updater|')) return null;
          if (cmd.startsWith('plugin:global-shortcut|')) return false;
          if (cmd.startsWith('plugin:event|')) return 1;
          if (cmd.startsWith('plugin:notification|')) return true;
          if (cmd.startsWith('plugin:dialog|')) return null;
          if (cmd.startsWith('plugin:opener|')) return null;

          console.log('[TauriBridge] Default fallback for unhandled cmd:', cmd, args);
          return null;
        }
      };

      // Ensure global __TAURI__ and window.supermail are available
      window.__TAURI__ = {
        core: {
          invoke: window.__TAURI_INTERNALS__.invoke
        }
      };

      window.supermail = {
        isElectron: true,
        invoke: window.__TAURI_INTERNALS__.invoke,
        db: {
          select: async (query, params = []) => {
            const res = await window.fetch(SERVER_URL + '/api/sql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cmd: 'plugin:sql|select', args: { query, values: params } })
            });
            return await res.json();
          },
          execute: async (query, params = []) => {
            const res = await window.fetch(SERVER_URL + '/api/sql', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cmd: 'plugin:sql|execute', args: { query, values: params } })
            });
            return await res.json();
          },
        },
        fs: {
          readFile: async () => new Uint8Array(),
          writeFile: async () => {},
          readTextFile: async () => '',
          writeTextFile: async () => {},
          exists: async () => true,
          mkdir: async () => {},
          remove: async () => {},
        },
        dialog: {
          save: async () => null,
          open: async () => null,
        },
        openUrl: async () => {},
        window: {
          minimize: async () => {},
          toggleMaximize: async () => {},
          isMaximized: async () => false,
          close: async () => {},
          createThreadWindow: async () => {},
          closeSplashscreen: async () => {},
          setBadgeCount: async () => {},
          setTrayTooltip: async () => {},
          setTrayIcon: async () => {},
        },
        on: () => () => {},
      };
    })();
  `;
}
