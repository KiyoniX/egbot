#!/usr/bin/env bash
# Installs the bot on a Linux server (Node 20.6+ required).
# Usage: ./setup.sh          install dependencies and the browser
#        ./setup.sh --cron   also schedule the bot every 15 minutes
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null || ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 20 || (a === 20 && b >= 6) ? 0 : 1)'; then
  echo "Node 20.6+ requis (le paquet apt d'Ubuntu est trop ancien). Installez Node 22 :"
  echo "  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs"
  exit 1
fi

npm ci
npx playwright install --with-deps chromium

mkdir -p logs
if [ ! -f config.json ]; then
  cp config.example.json config.json
  echo "Fichier config.json cree a partir de config.example.json : mettez-y vos utilisateurs."
fi
if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "Fichier .env cree : renseignez la cle de votre IA (voir README, Choisir l'IA) et, en mode mail, IMAP_PASSWORD."
fi

if [ "${1:-}" = "--cron" ]; then
  line="*/15 * * * * cd $PWD && PATH=$PATH flock -n .lock node --env-file=.env run.mjs >> logs/cron.log 2>&1 # quizbot"
  ( crontab -l 2>/dev/null | grep -v '# quizbot' || true; echo "$line" ) | crontab -
  echo "Cron installe (toutes les 15 minutes). Pour le retirer : crontab -e"
fi
