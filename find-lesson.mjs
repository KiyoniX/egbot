// "Web" mode, for platforms whose lessons are listed in the user's space: finds the newest
// lesson link without Claude (no usage consumed), with the user's persistent browser profile.
// Also signs a user in from a login link received by mail.
// Usage (on the server):
//   node login.mjs ...  -> see login.mjs
//   node find-lesson.mjs --user <id>   shows what the bot would pick
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function openProfile(user) {
  const { chromium } = await import('playwright');
  fs.mkdirSync(user.dir, { recursive: true });
  return chromium.launchPersistentContext(path.join(user.dir, 'browser-profile'), {
    channel: user.browser,
    headless: user.headless,
    locale: 'fr-FR',
    args: user.noSandbox ? ['--no-sandbox'] : [],
  });
}

// True when the platform sent us to its sign-in page.
export function isLoginPage(page, user) {
  return new RegExp(user.loginUrlPattern || '/login').test(new URL(page.url()).pathname);
}

// Returns { loginRequired: true } or { id, url } for the newest lesson, or {} if none listed.
export async function findLatestLesson(user, context) {
  const own = !context;
  context ||= await openProfile(user);
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(user.lessonListUrl, { waitUntil: 'networkidle', timeout: 60000 });
    if (isLoginPage(page, user) && user.loginLink) {
      // Session expired: sign in again with the saved link, then reload the list.
      await page.goto(user.loginLink, { waitUntil: 'networkidle', timeout: 60000 });
      await page.goto(user.lessonListUrl, { waitUntil: 'networkidle', timeout: 60000 });
    }
    if (isLoginPage(page, user)) return { loginRequired: true };
    const pattern = new RegExp(user.lessonLinkPattern || '/show-lesson/(\\d+)/');
    const hrefs = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.href));
    let best = {};
    for (const href of hrefs) {
      const m = href.match(pattern);
      if (!m) continue;
      const u = new URL(href);
      const host = u.hostname.toLowerCase();
      const domain = user.quizDomain.toLowerCase();
      if (u.protocol !== 'https:' || (host !== domain && !host.endsWith('.' + domain))) continue;
      const id = Number(m[1]);
      if (!best.id || id > best.id) best = { id, url: href };
    }
    return best;
  } finally {
    if (own) await context.close();
  }
}

// Gymglish only counts a lesson as finished (and unlocks the next one) after the "Terminer" button
// of its correction page. Clicks it and waits for the end page. Returns a short status text.
export async function finishLesson(user, lessonUrl) {
  if (!user.finishButton) return null;
  const correctionUrl = lessonUrl.replace(/\/L(\?|$)/, '/F$1');
  const context = await openProfile(user);
  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(correctionUrl, { waitUntil: 'networkidle', timeout: 60000 });
    if (isLoginPage(page, user)) return 'sign-in page, not finished';
    const button = page.locator(user.finishButton).first();
    if (!(await button.count())) return 'no finish button on the correction page';
    await button.scrollIntoViewIfNeeded();
    await Promise.all([
      page.waitForURL(new RegExp(user.finishUrlPattern || '/workbook/end'), { timeout: 60000 }),
      button.click(),
    ]);
    await page.waitForLoadState('networkidle').catch(() => {});
    const text = await page.evaluate(() => document.body.innerText);
    const done = text.match(/Tu as terminé l'épisode \d+/i);
    let status = done ? done[0] : `finish page reached (${new URL(page.url()).pathname})`;

    // The end page has a "Prochain épisode" form: it asks the platform for the next episode now.
    const next = user.nextEpisodeButton ? page.locator(user.nextEpisodeButton).first() : null;
    if (next && await next.count()) {
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {}),
        next.click(),
      ]);
      const m = page.url().match(new RegExp(user.lessonLinkPattern || '/show-lesson/(\\d+)/'));
      status += m ? `; next episode requested (${m[1]})` : `; next episode requested (${new URL(page.url()).pathname})`;
    }
    return status;
  } finally {
    await context.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { selectOneUser } = await import('./users.mjs');
  const user = selectOneUser(process.argv.slice(2));
  console.log(`[${user.id}]`, await findLatestLesson(user));
}
