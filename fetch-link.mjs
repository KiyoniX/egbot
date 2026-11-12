// Reads a user's mailbox over IMAP and returns the quiz link from the newest matching mail.
// Run directly to test the mailboxes: node --env-file=.env fetch-link.mjs [--user <id>]
import { pathToFileURL } from 'node:url';

// Outlook rewrites links as "safelinks"; the real target is in the `url` parameter.
export function unwrap(raw) {
  try {
    const u = new URL(raw);
    if (u.hostname.endsWith('safelinks.protection.outlook.com') && u.searchParams.get('url')) {
      return u.searchParams.get('url');
    }
  } catch {}
  return raw;
}

export function extractLinks({ html, text }) {
  const found = [];
  for (const m of (html || '').matchAll(/href\s*=\s*["']([^"']+)["']/gi)) {
    found.push(m[1].replace(/&amp;/g, '&'));
  }
  for (const m of (text || '').matchAll(/https?:\/\/[^\s<>"')\]]+/g)) {
    found.push(m[0].replace(/[.,;:!?]+$/, ''));
  }
  return [...new Set(found.map(unwrap))];
}

export function pickQuizLink(links, user) {
  const domain = user.quizDomain.toLowerCase();
  return links.find((link) => {
    let u;
    try { u = new URL(link); } catch { return false; }
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:') return false;
    if (host !== domain && !host.endsWith('.' + domain)) return false;
    return !user.linkContains || link.includes(user.linkContains);
  }) || null;
}

// A redirected mail keeps the user as recipient; a forwarded one has the user as sender.
export function involvesAddress(mail, email) {
  const wanted = email.toLowerCase();
  return [mail.from, mail.to, mail.cc].flat().filter(Boolean)
    .flatMap((field) => field.value || [])
    .some((a) => (a.address || '').toLowerCase() === wanted);
}

// Newest mail received after `since` that belongs to this user and links to the quiz domain.
export async function findQuizLink(user, since) {
  const { ImapFlow } = await import('imapflow');
  const { simpleParser } = await import('mailparser');
  const client = new ImapFlow({
    host: user.imap.host,
    port: user.imap.port,
    secure: true,
    auth: { user: user.imap.user, pass: user.imapPassword },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock('INBOX');
  try {
    const uids = (await client.search({ since }, { uid: true })) || [];
    for (const uid of uids.sort((a, b) => b - a)) {
      const msg = await client.fetchOne(uid, { source: true, internalDate: true }, { uid: true });
      if (!msg || msg.internalDate <= since) continue;
      const mail = await simpleParser(msg.source);
      const subject = mail.subject || '';
      if (user.email && !involvesAddress(mail, user.email)) continue;
      if (user.mailSubjectContains
        && !subject.toLowerCase().includes(user.mailSubjectContains.toLowerCase())) continue;
      const link = pickQuizLink(extractLinks({ html: mail.html || '', text: mail.text || '' }), user);
      if (link) return { link, subject, receivedAt: msg.internalDate };
    }
    return null;
  } finally {
    lock.release();
    await client.logout();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { loadUsers, selectUsers } = await import('./users.mjs');
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000);
  for (const user of selectUsers(loadUsers(), process.argv.slice(2))) {
    try {
      const mail = await findQuizLink(user, since);
      console.log(`[${user.id}]`, mail || 'Aucun mail avec un lien de quiz sur les 3 derniers jours.');
    } catch (e) {
      console.log(`[${user.id}] Erreur de boite mail : ${e.message}`);
    }
  }
}
