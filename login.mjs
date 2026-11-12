// Run on the SERVER, for platforms that sign in with a link sent by mail (web mode).
// Usage: node login.mjs --user <id> --request        asks the platform to mail a login link
//        node login.mjs --user <id> --link "<url>"   opens that link in the bot's browser profile
// Copy the link from the mail without clicking it: it may only work once.
import { selectOneUser } from './users.mjs';
import { findLatestLesson, isLoginPage, openProfile } from './find-lesson.mjs';

const argv = process.argv.slice(2);
const user = selectOneUser(argv);
const link = argv.includes('--link') ? argv[argv.indexOf('--link') + 1] : null;

const context = await openProfile(user);
try {
  const page = context.pages()[0] || await context.newPage();
  if (argv.includes('--request')) {
    if (!user.loginRequestUrl || !user.email) throw new Error('Set loginRequestUrl and email in config.json.');
    await page.goto(user.loginRequestUrl, { waitUntil: 'networkidle' });
    await page.locator('input[type=email], input[name*=mail]').first().fill(user.email);
    await Promise.all([
      page.waitForLoadState('networkidle'),
      page.locator('form button[type=submit], form input[type=submit]').first().click(),
    ]);
    console.log(`[${user.id}] Login link requested for ${user.email}:`);
    console.log((await page.evaluate(() => document.body.innerText)).trim().split('\n').slice(0, 3).join('\n'));
  } else if (link) {
    const u = new URL(link);
    const domain = user.quizDomain.toLowerCase();
    if (u.protocol !== 'https:' || (u.hostname !== domain && !u.hostname.endsWith('.' + domain))) {
      throw new Error(`The link must be https and point to ${user.quizDomain}.`);
    }
    await page.goto(link, { waitUntil: 'networkidle', timeout: 60000 });
    if (isLoginPage(page, user)) throw new Error('Still on the sign-in page: the link is expired or already used. Run --request again.');
    console.log(`[${user.id}] Signed in (${page.url().split('?')[0]}).`);
    console.log(`[${user.id}] Newest lesson found:`, await findLatestLesson(user, context));
  } else {
    throw new Error('Add --request or --link "<url>".');
  }
} finally {
  await context.close();
}
