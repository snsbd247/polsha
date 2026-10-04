#!/bin/bash
# Runs ON the cPanel server. Expects in ~/polsha/releases/:
#   backend.tgz  (git archive HEAD backend)
#   frontend.tgz (contents of frontend/dist: tar -czf frontend.tgz -C frontend/dist .)
# Both are checked before anything live changes, and the database is dumped first.
# First deploy only: ~/polsha/.first-deploy.env with DB_DATABASE, DB_USERNAME,
# DB_PASSWORD, APP_URL, ADMIN_PASSWORD. It is deleted after use.
set -euo pipefail

ROOT="$HOME/polsha"
WEB="$HOME/public_html"
PHP="$(command -v php)"
COMPOSER="$HOME/bin/composer"
cd "$ROOT"

fail() { echo "!! $*" >&2; exit 1; }

echo "== check packages"
# Look inside both archives before anything live is touched: a wrongly packed
# release must stop here, not after the old site has been removed.
[ -s releases/backend.tgz ] || fail "releases/backend.tgz missing"
[ -s releases/frontend.tgz ] || fail "releases/frontend.tgz missing"
tar -tzf releases/backend.tgz | grep -x 'backend/artisan' >/dev/null || fail "backend.tgz has no backend/artisan (pack with: git archive HEAD backend)"
rm -rf frontend.new && mkdir frontend.new
tar -xzf releases/frontend.tgz -C frontend.new
# tolerate a package made of the dist folder itself instead of its contents
if [ ! -f frontend.new/index.html ] && [ -f frontend.new/dist/index.html ]; then
  mv frontend.new frontend.pkg && mv frontend.pkg/dist frontend.new && rm -rf frontend.pkg
fi
[ -f frontend.new/index.html ] || fail "frontend.tgz has no index.html"
ls frontend.new/assets/index-*.js >/dev/null 2>&1 || fail "frontend.tgz has no assets/index-*.js"

echo "== backup database"
# The running release takes a dump before migrations change anything.
if [ -f backend/artisan ]; then
  (cd backend && "$PHP" artisan backup:run --type=pre-deploy) || fail "backup failed — nothing was changed"
fi

echo "== unpack backend"
rm -rf backend.new && mkdir backend.new
tar -xzf releases/backend.tgz -C backend.new --strip-components=1

# Carry over config and user uploads/backups from the running release.
if [ -f backend/.env ]; then cp backend/.env backend.new/.env; fi
if [ -d backend/storage/app ]; then
  rm -rf backend.new/storage
  cp -a backend/storage backend.new/storage
fi

echo "== composer"
cd backend.new
"$PHP" "$COMPOSER" install --no-dev --optimize-autoloader --no-interaction --no-progress 2>&1 | tail -3

FIRST=0
if [ ! -s .env ]; then
  FIRST=1
  # shellcheck disable=SC1091
  source "$ROOT/.first-deploy.env"
  cat > .env <<ENV
APP_NAME=Polsha
APP_ENV=production
APP_KEY=
APP_DEBUG=false
APP_URL=${APP_URL}
APP_TIMEZONE=Asia/Dhaka
APP_LOCALE=bn
APP_FALLBACK_LOCALE=en
APP_MAINTENANCE_DRIVER=file
BCRYPT_ROUNDS=12
LOG_CHANNEL=daily
LOG_LEVEL=error
DB_CONNECTION=mysql
DB_HOST=localhost
DB_PORT=3306
DB_DATABASE=${DB_DATABASE}
DB_USERNAME=${DB_USERNAME}
DB_PASSWORD=${DB_PASSWORD}
FRONTEND_URL=${APP_URL}
SESSION_DRIVER=database
CACHE_STORE=database
QUEUE_CONNECTION=database
FILESYSTEM_DISK=local
MAIL_MAILER=log
MYSQLDUMP_PATH=$(command -v mysqldump)
ENV
  "$PHP" artisan key:generate --force
fi

mkdir -p storage/framework/{cache,sessions,views} storage/logs bootstrap/cache
chmod -R u+rwX,g+rwX storage bootstrap/cache

echo "== migrate"
"$PHP" artisan migrate --force
if [ "$FIRST" = 1 ]; then
  ADMIN_PASSWORD="$ADMIN_PASSWORD" "$PHP" artisan db:seed --force
  rm -f "$ROOT/.first-deploy.env"
fi

echo "== switch release"
cd "$ROOT"
rm -rf backend.old
if [ -d backend ]; then mv backend backend.old; fi
mv backend.new backend
# the new release carries the database backups; a second copy in the old release only fills the disk
rm -rf backend.old/storage/app/private/backups

# Cache only after the move: cached config stores absolute paths.
cd "$ROOT/backend"
"$PHP" artisan config:cache
"$PHP" artisan route:cache
"$PHP" artisan event:cache >/dev/null 2>&1 || true
cd "$ROOT"

echo "== frontend"
# Replace only what the build owns; leave anything else in public_html alone.
# The new files were unpacked and checked above, so the swap is a few quick moves.
rm -rf "$WEB/assets" "$WEB/index.html" "$WEB/laravel.php" "$WEB/.htaccess"
cp -a frontend.new/. "$WEB/"
rm -rf frontend.new
echo "live bundle: $(cd "$WEB/assets" && ls index-*.js)"

echo "== cron"
CRON="* * * * * cd $ROOT/backend && $PHP artisan schedule:run >> /dev/null 2>&1"
# `crontab -l` exits non-zero when no crontab exists yet; don't let set -e abort on that.
EXISTING="$(crontab -l 2>/dev/null | grep -v 'polsha/backend && .*schedule:run' || true)"
printf '%s\n%s\n' "$EXISTING" "$CRON" | sed '/^$/d' | crontab -

echo "== done"
