// Run on the SERVER: loads session-<id>.json (made by export-session.mjs) into that user's
// persistent browser profile, then deletes it.
// Usage: node import-session.mjs [--user <id>]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { root, selectOneUser } from './users.mjs';

const user = selectOneUser(process.argv.slice(2));
const sessionPath = path.join(root, `session-${user.id}.json`);
const session = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

fs.mkdirSync(user.dir, { recursive: true });
const context = await chromium.launchPersistentContext(path.join(user.dir, 'browser-profile'), {
  channel: user.browser,
  headless: user.headless,
  args: user.noSandbox ? ['--no-sandbox'] : [],
});
await context.addCookies(session.cookies);

// Local storage can only be written from a page of the matching origin.
for (const { origin, localStorage } of session.origins || []) {
  if (!localStorage.length) continue;
  const page = await context.newPage();
  try {
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    await page.evaluate((items) => {
      for (const { name, value } of items) window.localStorage.setItem(name, value);
    }, localStorage);
  } catch (e) {
    console.warn(`Local storage non importe pour ${origin}: ${e.message}`);
  }
  await page.close();
}

await context.close();
fs.rmSync(sessionPath);
console.log(`[${user.id}] Session importee (${session.cookies.length} cookies), ${path.basename(sessionPath)} supprime.`);
