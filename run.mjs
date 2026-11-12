// Daily quiz bot (server version). For each user: gates on the 24h unlock, reads the quiz link
// from the mailbox or the platform, then lets an AI agent (agents.mjs: Claude, Codex or Gemini)
// drive the browser.
// Usage: node --env-file=.env run.mjs                 normal run, all users (respects the delays)
//        node --env-file=.env run.mjs --user <id>     only this user
//        node --env-file=.env run.mjs --force         ignore the delays
//        node --env-file=.env run.mjs --user <id> --url <link>   skip the mailbox and use this link
//        node --env-file=.env run.mjs --test-discord  send a test message to Discord and exit
import fs from 'node:fs';
import path from 'node:path';
import { runAgent } from './agents.mjs';
import { findQuizLink } from './fetch-link.mjs';
import { findLatestLesson, finishLesson } from './find-lesson.mjs';
import { pathToFileURL } from 'node:url';
import { loadUsers, root, selectUsers } from './users.mjs';

// Optional local extensions, not part of the repository: extensions/index.mjs (docs/extensions.md).
const extPath = path.join(root, 'extensions', 'index.mjs');
const ext = fs.existsSync(extPath) ? await import(pathToFileURL(extPath).href) : {};

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const urlArg = argv.includes('--url') ? argv[argv.indexOf('--url') + 1] : null;

const logDir = path.join(root, 'logs');
fs.mkdirSync(logDir, { recursive: true });
const logFile = path.join(logDir, `${new Date().toISOString().slice(0, 10)}.log`);

function log(msg) {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  fs.appendFileSync(logFile, line + '\n');
  console.log(line);
}

// Posts to the Discord webhook, if one is configured. Never fails the run.
async function notifyDiscord(mention, text) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url) return;
  const content = [mention, text].filter(Boolean).join(' ').slice(0, 1900);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) log(`Discord error: HTTP ${res.status}`);
  } catch (e) {
    log(`Discord error: ${e.message}`);
  }
}

const RESULT_LABELS = {
  DONE: '✅ Leçon du jour terminée',
  ALREADY_DONE: '☑️ Leçon déjà faite, rien à faire',
  LOCKED: '🔒 Leçon encore verrouillée',
  LOGIN_REQUIRED: '🔑 La plateforme demande une reconnexion, la session est à refaire',
  ERROR: '❌ La leçon a échoué, voir le log du jour',
};

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

async function runUser(user) {
  const tag = `[${user.id}]`;
  // Web mode: no mailbox, the lesson is found in the user's space on the platform.
  const webMode = Boolean(user.lessonListUrl && !user.imap?.host);
  if (!user.quizDomain || (!urlArg && !webMode && !(user.imap?.host && user.imap?.user && user.imapPassword))) {
    log(`${tag} Configuration incomplete: quizDomain, and either lessonListUrl or imap.host / imap.user in config.json (plus the IMAP password in .env).`);
    return;
  }

  fs.mkdirSync(user.dir, { recursive: true });
  const statePath = path.join(user.dir, 'state.json');
  const saveState = () => fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  const state = { lastCompleted: null, lastAttempt: null, lastResult: null, lastLessonId: null };
  if (fs.existsSync(statePath)) Object.assign(state, JSON.parse(fs.readFileSync(statePath, 'utf8')));

  const now = new Date();
  const lastCompleted = state.lastCompleted ? new Date(state.lastCompleted) : null;
  const lastAttempt = state.lastAttempt ? new Date(state.lastAttempt) : null;

  if (!force && !urlArg) {
    if (lastCompleted && now - lastCompleted < user.unlockHours * 3600 * 1000) return;
    if (lastAttempt && now - lastAttempt < user.retryMinutes * 60 * 1000) return;
  }

  let quizUrl = urlArg;
  let lessonId = null;
  if (quizUrl && webMode) {
    // A lesson given by hand is remembered too, so the cron does not open it again.
    const m = quizUrl.match(new RegExp(user.lessonLinkPattern || '/show-lesson/(\\d+)/'));
    if (m) lessonId = Number(m[1]);
  }
  if (!quizUrl && webMode) {
    // Checking the lesson list costs no AI usage, so it is not counted as an attempt.
    const found = await findLatestLesson(user);
    if (found.loginRequired) {
      if (state.lastResult !== 'LOGIN_REQUIRED') {
        log(`${tag} Signed out of the platform: run login.mjs --user ${user.id} --request, then --link.`);
        await notifyDiscord(user.discordMention, `${RESULT_LABELS.LOGIN_REQUIRED} — ${user.name}`);
        state.lastResult = 'LOGIN_REQUIRED';
        saveState();
      }
      return;
    }
    if (!found.id) { log(`${tag} No lesson listed on ${user.lessonListUrl}.`); return; }
    if (!force && String(found.id) === String(state.lastLessonId)) return;
    log(`${tag} New lesson listed: ${found.id}`);
    quizUrl = found.url;
    lessonId = found.id;
  }
  if (!quizUrl) {
    // Reading the mailbox costs no AI usage, so it is not counted as an attempt.
    const mail = await findQuizLink(user, lastCompleted || new Date(now - 3 * 24 * 3600 * 1000));
    if (!mail) return;
    log(`${tag} Quiz mail found: "${mail.subject}" (${mail.receivedAt.toISOString()})`);
    quizUrl = mail.link;
  }

  // Optional local extensions add rules for the AI, tools, and a lesson duration (docs/extensions.md).
  const plan = (await ext.beforeLesson?.(user, { lessonUrl: quizUrl })) || {};
  const prompt = fs.readFileSync(path.join(root, 'prompt.md'), 'utf8')
    .replace('{{QUIZ_URL}}', quizUrl)
    .replace('{{QUIZ_DOMAIN}}', user.quizDomain)
    .replace('{{NOTES}}', user.notes || '(aucune)')
    .replace('{{EXTRA_RULES}}', plan.rules?.length ? plan.rules.join('\n\n') : '(aucune)');

  log(`${tag} Starting quiz run: ${quizUrl}` + (plan.logNote ? ` (${plan.logNote})` : ''));
  const runStart = Date.now();
  state.lastAttempt = now.toISOString();
  saveState();

  const { stdout, stderr } = await runAgent(user, prompt, plan.mcpServers || {});
  fs.appendFileSync(logFile, stdout + (stderr.trim() ? `\n[stderr]\n${stderr}` : '') + '\n');
  // The final answer is on stdout; fall back to everything if the agent printed nothing there.
  const output = stdout.trim() ? stdout : stderr;

  const matches = [...output.matchAll(/RESULT:\s*(DONE|ALREADY_DONE|LOCKED|LOGIN_REQUIRED|ERROR)\b/g)];
  const result = matches.length ? matches[matches.length - 1][1] : 'ERROR';

  // Finish the lesson ourselves ("Terminer" on the correction): the AI's run may end before the
  // platform has recorded it. Until it succeeds, the lesson id is not saved, so it is retried.
  let finished = true;
  let finishNote = '';
  if (['DONE', 'ALREADY_DONE'].includes(result) && user.finishButton) {
    try {
      const status = await finishLesson(user, quizUrl);
      log(`${tag} Finish: ${status}`);
      finished = /terminé|finish page reached/i.test(status || '');
      if (!finished) finishNote = `\n⚠️ Fin de leçon non validée (${status}), nouvel essai plus tard`;
    } catch (e) {
      finished = false;
      log(`${tag} Finish error: ${e.message}`);
      finishNote = '\n⚠️ Clic sur « Terminer » en échec, nouvel essai plus tard';
    }
  }

  // Lesson duration: given by an extension if it measured it, else the whole run.
  let duration = null;
  if (result === 'DONE') {
    const after = (await ext.afterLesson?.(user, { plan, result, runStart })) || {};
    duration = formatDuration(after.durationMs > 0 ? after.durationMs : Date.now() - runStart);
    log(`${tag} Lesson time: ${duration}` + (after.durationMs > 0 ? '' : ' (whole run)'));
  }

  // Failures repeat every retry: only announce them when the result changes.
  if (result === 'DONE' || result !== state.lastResult) {
    const summary = output.replace(/RESULT:.*/g, '').trim();
    await notifyDiscord(user.discordMention,
      `${RESULT_LABELS[result]} — ${user.name}`
      + (duration ? `\n⏱️ Temps : ${duration}` : '')
      + finishNote
      + (['LOCKED', 'ALREADY_DONE'].includes(result) ? '' : '\n' + summary));
  }

  state.lastResult = result;
  // Not finished yet: no unlock delay, the normal retry delay applies and the finish is retried.
  if (result === 'DONE' && finished) state.lastCompleted = new Date().toISOString();
  // A listed lesson that is done is not retried: the next one has a new id.
  if (lessonId && finished && (result === 'DONE' || result === 'ALREADY_DONE')) state.lastLessonId = lessonId;
  saveState();
  log(`${tag} Run finished: ${result}`);
}

let users;
try {
  users = selectUsers(loadUsers(), argv);
  if (urlArg && users.length !== 1) throw new Error('--url needs --user <id> when several users are configured.');
} catch (e) {
  log(e.message);
  process.exit(2);
}

if (argv.includes('--test-discord')) {
  if (!process.env.DISCORD_WEBHOOK_URL) log('DISCORD_WEBHOOK_URL is not set in .env.');
  for (const user of users) await notifyDiscord(user.discordMention, `Message de test du bot de leçon — ${user.name}`);
  process.exit(0);
}

// One user at a time: lessons never run in parallel.
for (const user of users) {
  try {
    await runUser(user);
  } catch (e) {
    log(`[${user.id}] Error: ${e.message}`);
  }
}
