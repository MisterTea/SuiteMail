/**
 * Browser-side injection script for Playwright that provides the Electron IPC bridge
 * connecting SQLite and sync operations directly to our Fake Server.
 */
export function getElectronBridgeScript(fakeServerPort = 3333): string {
  return `
    (() => {
      const SERVER_URL = 'http://localhost:${fakeServerPort}';

      const invoke = async (cmd, args = {}) => {
        // IMAP Electron commands -> delegate to Fake Server Sync
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
            console.warn('[ElectronBridge] Sync post error:', syncErr);
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
            console.warn('[ElectronBridge] SMTP send error:', err);
          }
          return { success: true, message: 'Message sent successfully' };
        }

        if (cmd === 'smtp_test_connection') {
          return { success: true, message: 'Connected' };
        }

        console.log('[ElectronBridge] Default fallback for unhandled cmd:', cmd, args);
        return null;
      };

      window.supermail = {
        isElectron: true,
        invoke,
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
          openThreadWindow: async () => {},
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
