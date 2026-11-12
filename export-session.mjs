// Run on the user's own PC: opens Chrome, lets them sign in to the quiz platform, then saves
// the session (cookies + local storage) to session-<id>.json, to be copied to the server.
// Usage: node export-session.mjs [--user <id>]
import path from 'node:path';
import readline from 'node:readline/promises';
import { chromium } from 'playwright';
import { root, selectOneUser } from './users.mjs';

const user = selectOneUser(process.argv.slice(2));
if (!user.quizDomain) throw new Error('Set quizDomain in config.json first.');

const browser = await chromium.launch({ channel: 'chrome', headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`https://${user.quizDomain}`);

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question(`[${user.id}] Connectez-vous dans la fenetre Chrome, puis appuyez sur Entree ici... `);
rl.close();

const file = `session-${user.id}.json`;
await context.storageState({ path: path.join(root, file) });
await browser.close();
console.log(`Session enregistree dans ${file} : copiez ce fichier dans le dossier du bot sur le serveur.`);
