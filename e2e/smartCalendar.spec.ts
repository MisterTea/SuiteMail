import { test, expect } from './fixtures';
import { FakeServer } from './fakeServer';
import { getElectronBridgeScript } from './electronBridge';

let server: FakeServer;
test.beforeAll(async () => { server = new FakeServer(3334); await server.start(); });
test.afterAll(async () => { await server.stop(); });

test.beforeEach(async ({ page }) => {
  server.reset();
  server.db.exec(`
    DELETE FROM ai_cache;
    DELETE FROM calendar_events;
    DELETE FROM calendars;
    INSERT OR REPLACE INTO accounts (id, email, display_name, provider, is_active) VALUES ('calendar-account', 'organizer@example.com', 'Work calendar', 'ews', 1);
    INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_provider', 'aicore');
    INSERT OR REPLACE INTO settings (key, value) VALUES ('ai_enabled', 'true');
    UPDATE threads SET subject = 'Planning: design review' WHERE id = 't-welcome-1';
    UPDATE messages SET subject = 'Planning: design review', from_address = 'bob@example.com', from_name = 'Bob',
      body_text = 'Design review on January 2, 2030 at 3pm Chicago time. Please invite bob@example.com. Team lunch sometime next week.',
      body_html = '<p>Design review on January 2, 2030 at 3pm Chicago time. Please invite bob@example.com. Team lunch sometime next week.</p>'
      WHERE id = 'm-welcome-1';
  `);
  await page.addInitScript(`${getElectronBridgeScript(3334)}
    (() => {
      const invoke = window.supermail.invoke;
      window.supermail.invoke = async (cmd, args = {}) => {
        if (cmd === 'aicore_is_available') return { available: true, supported_models: ['full'] };
        if (cmd === 'aicore_generate') {
          if (args.systemPrompt.includes('Extract calendar suggestions')) {
            localStorage.setItem('fixtureCalendarAnalysis', String(Number(localStorage.getItem('fixtureCalendarAnalysis') || '0') + 1));
            return JSON.stringify({events: [
              { title: 'Design review', startTime: '2030-01-02T15:00:00-06:00', endTime: '2030-01-02T16:00:00-06:00', timeZone: 'America/Chicago',
                timeZoneExplicit: true, isAllDay: false, attendees: ['bob@example.com'], evidence: 'Design review on January 2, 2030 at 3pm Chicago time.', location: 'Conference room', description: 'Review the design', missingDetails: [] },
              { title: 'Team lunch', startTime: null, endTime: null, timeZone: null, isAllDay: false, attendees: [],
                evidence: 'Team lunch sometime next week.', location: '', description: '', missingDetails: ['Confirm lunch date and time'] }
            ]});
          }
          return '[]';
        }
        if (cmd === 'ews_calendar') {
          if (args.operation === 'list') return [{ remoteId: 'primary', displayName: 'Work calendar', color: null, isPrimary: true, canCreate: true }];
          if (args.operation === 'fetch') return JSON.parse(localStorage.getItem('fixtureCalendarEvents') || '[]');
          if (args.operation === 'create') {
            const events = JSON.parse(localStorage.getItem('fixtureCalendarEvents') || '[]');
            const event = { remoteEventId: 'created-' + (events.length + 1), uid: 'fixture', etag: '1', summary: args.event.summary,
              description: args.event.description || null, location: args.event.location || null,
              startTime: Date.parse(args.event.startTime) / 1000, endTime: Date.parse(args.event.endTime) / 1000,
              isAllDay: args.event.isAllDay || false, status: 'confirmed', organizerEmail: args.anchor,
              attendeesJson: JSON.stringify(args.event.attendees || []), htmlLink: null, icalData: null };
            events.push(event); localStorage.setItem('fixtureCalendarEvents', JSON.stringify(events));
            return event;
          }
        }
        return invoke(cmd, args);
      };
    })();`);
  await page.goto('http://localhost:1420/#/mail/inbox');
  await page.getByRole('button', { name: /Planning: design review/ }).first().tap();
});

test('AI calendar suggestions review, invite and survive reopening without duplicates', async ({ page }) => {
  test.setTimeout(90_000);
  const actions = page.getByRole('button', { name: 'Add to calendar', exact: true });
  await expect(actions).toHaveCount(2);
  expect(server.db.prepare('SELECT count(*) AS count FROM calendar_events').get()?.count).toBe(0);
  await actions.first().tap();
  const dialog = page.getByRole('dialog', { name: 'Create Event' });
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Design review');
  await expect(dialog.getByLabel('Invitees')).toHaveValue('bob@example.com');
  await expect(dialog.getByLabel('Calendar')).toContainText('organizer@example.com');
  expect(server.db.prepare('SELECT count(*) AS count FROM calendar_events').get()?.count).toBe(0);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
  await actions.first().tap();
  await dialog.getByLabel('Title', { exact: true }).fill('Design review with Bob');
  await dialog.getByRole('button', { name: 'Create & send invitations' }).tap();
  await expect(page.getByRole('button', { name: 'View event', exact: true })).toBeVisible();
  const saved = server.db.prepare('SELECT * FROM calendar_events').get();
  expect(saved?.account_id).toBe('calendar-account');
  expect(saved?.summary).toBe('Design review with Bob');
  expect(saved?.start_time).toBe(Date.parse('2030-01-02T21:00:00Z') / 1000);
  expect(JSON.parse(saved?.attendees_json as string)).toEqual([{ email: 'bob@example.com' }]);
  await page.reload();
  await expect(page.getByRole('button', { name: 'View event', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fixtureCalendarEvents') || '[]').length)).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('fixtureCalendarAnalysis'))).toBe('1');
  await page.getByRole('button', { name: 'View event', exact: true }).tap();
  await expect(page.getByRole('dialog')).toContainText('Design review with Bob');
});

test('AI suggestions with missing times require review and cancellation creates nothing', async ({ page }) => {
  const actions = page.getByRole('button', { name: 'Add to calendar', exact: true });
  await expect(actions).toHaveCount(2);
  await actions.nth(1).tap();
  const dialog = page.getByRole('dialog', { name: 'Create Event' });
  await expect(dialog.getByLabel('Title', { exact: true })).toHaveValue('Team lunch');
  await expect(dialog.getByLabel('Start', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: 'Create event', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).tap();
  expect(server.db.prepare('SELECT count(*) AS count FROM calendar_events').get()?.count).toBe(0);
});

test('ordinary calendar creation still saves through the shared provider path', async ({ page }) => {
  // Switch to the connected calendar account without selecting a suggestion.
  server.db.prepare("UPDATE settings SET value = 'calendar-account' WHERE key = 'active_account_id'").run();
  await page.goto('http://localhost:1420/#/calendar');
  await page.reload();
  await page.getByRole('button', { name: 'Create event', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: 'Create Event' });
  await dialog.getByLabel('Title', { exact: true }).fill('Personal planning');
  await dialog.getByLabel('Start', { exact: true }).fill('2030-01-03T09:00');
  await dialog.getByLabel('End', { exact: true }).fill('2030-01-03T10:00');
  await dialog.getByRole('button', { name: 'Create event', exact: true }).tap();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => server.db.prepare("SELECT summary FROM calendar_events WHERE remote_event_id = 'created-1'").get()?.summary).toBe('Personal planning');
});
