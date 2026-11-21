import { test, expect } from './fixtures';

test.skip(process.env.SUITEMAIL_ANDROID !== '1', 'Requires installed Android APK');
test('Android Gmail account selection opens app-password setup and detects Gmail servers', async ({page}) => {
  await page.goto('https://localhost');
  const chooser = page.getByRole('dialog', {name:'Add Account', exact:true});
  await expect(chooser).toBeVisible();
  const google = chooser.getByRole('button', {name:/^Google \(Gmail\)/});
  await expect(google).toBeEnabled();
  await google.tap();
  const setup = page.getByRole('dialog', {name:'Add IMAP/SMTP Account', exact:true});
  await expect(setup).toBeVisible();
  await setup.getByLabel('Email Address', {exact:true}).fill('android-test@gmail.com');
  await setup.getByLabel('Display Name (optional)', {exact:true}).tap();
  await expect(setup.getByText(/16-character App Password/)).toBeVisible();
  await expect(setup.getByLabel('Password', {exact:true})).toBeVisible();
  await expect(setup.getByRole('button',{name:'Sign in with Google',exact:true})).toHaveCount(0);
  await setup.getByLabel('Password', {exact:true}).fill('test-only-not-a-real-password');
  await setup.getByRole('button', {name:'Next',exact:true}).tap();
  await expect(setup.getByLabel('IMAP Server', {exact:true})).toHaveValue('imap.gmail.com');
  await setup.getByRole('button', {name:'Next',exact:true}).tap();
  await expect(setup.getByLabel('SMTP Server', {exact:true})).toHaveValue('smtp.gmail.com');
  // No connection attempt or account creation: these are deliberately fake credentials.
  await setup.getByRole('button',{name:'Cancel',exact:true}).tap();
});
