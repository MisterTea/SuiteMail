import { getAccount, getAllAccounts, type DbAccount } from "../db/accounts";
import { getGmailClient } from "../gmail/tokenManager";
import { upsertContact } from "../db/contacts";
import { parseVCards } from "./vcardParser";

interface GooglePerson {
  names?: Array<{ displayName?: string }>;
  emailAddresses?: Array<{ value?: string }>;
  photos?: Array<{ url?: string }>;
}

interface GoogleConnectionsResponse {
  connections?: GooglePerson[];
  nextPageToken?: string;
}

/**
 * Synchronize contacts from Google People API for a Gmail account.
 */
export async function syncGoogleContacts(
  accountId: string,
): Promise<{ syncedCount: number }> {
  const client = await getGmailClient(accountId);
  let syncedCount = 0;
  let pageToken: string | undefined;

  do {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("personFields", "names,emailAddresses,photos");
    url.searchParams.set("pageSize", "200");
    if (pageToken) {
      url.searchParams.set("pageToken", pageToken);
    }

    try {
      const data = await client.request<GoogleConnectionsResponse>(url.toString());
      const connections = data?.connections ?? [];

      for (const person of connections) {
        const displayName = person.names?.[0]?.displayName ?? null;
        const photoUrl = person.photos?.[0]?.url ?? null;

        for (const emailObj of person.emailAddresses ?? []) {
          const email = emailObj.value?.trim();
          if (email && email.includes("@")) {
            await upsertContact(email, displayName, photoUrl);
            syncedCount++;
          }
        }
      }

      pageToken = data.nextPageToken;
    } catch (err) {
      console.error("Failed to sync Google contacts:", err);
      break;
    }
  } while (pageToken);

  return { syncedCount };
}

/**
 * Synchronize contacts from a CardDAV server (iCloud, Fastmail, Nextcloud).
 */
export async function syncCardDavContacts(
  account: DbAccount,
): Promise<{ syncedCount: number }> {
  const username = account.caldav_username ?? account.email;
  const password = account.caldav_password;
  const serverUrl = account.caldav_url;

  if (!serverUrl || !password) {
    return { syncedCount: 0 };
  }

  // CardDAV addressbook URL resolution
  let addressbookUrl = serverUrl;
  if (addressbookUrl.includes("/caldav/")) {
    addressbookUrl = addressbookUrl.replace("/caldav/", "/carddav/");
  } else if (addressbookUrl.includes("caldav.")) {
    addressbookUrl = addressbookUrl.replace("caldav.", "carddav.");
  }

  let syncedCount = 0;
  try {
    const authHeader = `Basic ${btoa(`${username}:${password}`)}`;
    const reportXml = `<?xml version="1.0" encoding="utf-8" ?>
<C:addressbook-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:carddav">
  <D:prop>
    <D:getetag/>
    <C:address-data/>
  </D:prop>
</C:addressbook-query>`;

    const res = await fetch(addressbookUrl, {
      method: "REPORT",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/xml; charset=utf-8",
        Depth: "1",
      },
      body: reportXml,
    });

    if (res.ok) {
      const xml = await res.text();
      const parsedCards = parseVCards(xml);
      for (const card of parsedCards) {
        if (card.email) {
          await upsertContact(card.email, card.fn, card.avatarUrl);
          syncedCount++;
        }
      }
    }
  } catch (err) {
    console.warn("CardDAV addressbook query error:", err);
  }

  return { syncedCount };
}

/**
 * Sync all contacts for a specific account.
 */
export async function syncContactsForAccount(
  accountId: string,
): Promise<{ syncedCount: number }> {
  const account = await getAccount(accountId);
  if (!account) return { syncedCount: 0 };

  if (account.provider === "gmail_api") {
    return syncGoogleContacts(accountId);
  }

  if (account.caldav_url || account.calendar_provider === "caldav") {
    return syncCardDavContacts(account);
  }

  return { syncedCount: 0 };
}

/**
 * Sync contacts across all accounts.
 */
export async function syncAllContacts(): Promise<{ totalSynced: number }> {
  const accounts = await getAllAccounts();
  let totalSynced = 0;

  for (const account of accounts) {
    try {
      const { syncedCount } = await syncContactsForAccount(account.id);
      totalSynced += syncedCount;
    } catch (err) {
      console.warn(`Failed contact sync for account ${account.email}:`, err);
    }
  }

  return { totalSynced };
}
