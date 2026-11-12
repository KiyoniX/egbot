// Loads config.json and resolves each user: shared settings, per-user overrides, secrets, data folder.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.dirname(fileURLToPath(import.meta.url));

export function loadUsers() {
  const { users = [], ...shared } = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
  if (!users.length) throw new Error('config.json: add at least one entry in "users".');

  const seen = new Set();
  return users.map((u) => {
    if (!/^[a-z0-9_-]+$/i.test(u.id || '')) {
      throw new Error(`config.json: invalid user id "${u.id}" (letters, digits, - and _ only).`);
    }
    if (seen.has(u.id.toLowerCase())) throw new Error(`config.json: duplicate user id "${u.id}".`);
    seen.add(u.id.toLowerCase());
    // Without an address filter, users sharing a mailbox would pick up each other's lesson.
    if (users.length > 1 && !u.imap && !u.email) {
      throw new Error(`config.json: user "${u.id}" needs "email" (or its own "imap") to tell its mails apart.`);
    }

    const key = u.id.toUpperCase().replace(/-/g, '_');
    return {
      ...shared,
      ...u,
      name: u.name || u.id,
      imap: u.imap || shared.imap,
      imapPassword: u.imap ? process.env[`IMAP_PASSWORD_${key}`] : process.env.IMAP_PASSWORD,
      // Reusable sign-in link from the platform's login mail (web mode), kept in .env.
      loginLink: process.env[`LOGIN_LINK_${key}`] || null,
      agent: u.agent || shared.agent || 'claude',
      // A secret from .env: the user's own (NAME_<ID>) first, then the shared one (NAME).
      secret: (name) => process.env[`${name}_${key}`] || process.env[name] || null,
      dir: path.join(root, 'users', u.id),
    };
  });
}

// Applies an optional `--user <id>` argument.
export function selectUsers(users, argv) {
  if (!argv.includes('--user')) return users;
  const id = argv[argv.indexOf('--user') + 1];
  const found = users.filter((u) => u.id === id);
  if (!found.length) throw new Error(`Unknown user "${id}". Known: ${users.map((u) => u.id).join(', ')}`);
  return found;
}

// For the scripts that act on exactly one user.
export function selectOneUser(argv) {
  const users = selectUsers(loadUsers(), argv);
  if (users.length !== 1) {
    throw new Error(`Several users configured: add --user <id> (${users.map((u) => u.id).join(', ')}).`);
  }
  return users[0];
}
