#!/usr/bin/env bash
set -euo pipefail

APP_ROOT='/opt/luzhniki-parking-subscription'
APP_DIR="$APP_ROOT/app"
SERVICE='luzhniki-parking-subscription'
SERVICE_FILE="/etc/systemd/system/$SERVICE.service"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_SITE="$SCRIPT_DIR/site"
STAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP="/root/luzhniki-subscription-before-v6.8-$STAMP.tar.gz"
OLD_DIR="$APP_ROOT/app-before-v6.8-$STAMP"
FAILED_DIR="$APP_ROOT/app-failed-v6.8-$STAMP"
STAGE=''
SERVICE_BACKUP=''
HAD_APP=0
WAS_ACTIVE=0

cleanup() {
    if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then
        rm -rf -- "$STAGE"
    fi
}
trap cleanup EXIT

rollback_site() {
    systemctl stop "$SERVICE" >/dev/null 2>&1 || true
    if [ -d "$APP_DIR" ]; then
        mv "$APP_DIR" "$FAILED_DIR"
    fi
    if [ "$HAD_APP" -eq 1 ] && [ -d "$OLD_DIR" ]; then
        mv "$OLD_DIR" "$APP_DIR"
    fi
    if [ -n "$SERVICE_BACKUP" ] && [ -f "$SERVICE_BACKUP" ]; then
        cp -a "$SERVICE_BACKUP" "$SERVICE_FILE"
    elif [ "$HAD_APP" -eq 0 ]; then
        rm -f -- "$SERVICE_FILE"
    fi
    systemctl daemon-reload >/dev/null 2>&1 || true
    if [ "$WAS_ACTIVE" -eq 1 ] && [ -d "$APP_DIR" ]; then
        systemctl start "$SERVICE" >/dev/null 2>&1 || true
    fi
}

fail_with_rollback() {
    local message="$1"
    rollback_site
    echo "ОШИБКА: $message"
    if [ "$HAD_APP" -eq 1 ]; then
        echo 'Предыдущая версия восстановлена.'
    fi
    exit 1
}

if [ "$(id -u)" -ne 0 ]; then
    echo 'ОШИБКА: запустите установщик от root.'
    exit 1
fi

for command_name in node pnpm curl tar systemctl; do
    command -v "$command_name" >/dev/null 2>&1 || {
        echo "ОШИБКА: не найдена команда $command_name."
        exit 1
    }
done

for required in \
    "$SOURCE_SITE/package.json" \
    "$SOURCE_SITE/pnpm-lock.yaml" \
    "$SOURCE_SITE/app/lib/parking-tariffs.ts" \
    "$SOURCE_SITE/deploy/preflight.mjs" \
    "$SOURCE_SITE/deploy/luzhniki-parking-subscription.service"; do
    test -f "$required" || {
        echo "ОШИБКА: не найден файл $required"
        exit 1
    }
done

install -d -m 755 "$APP_ROOT"
STAGE="$(mktemp -d "$APP_ROOT/app-v6.8.XXXXXX")"

if [ -d "$APP_DIR" ]; then
    HAD_APP=1
fi
if systemctl is-active --quiet "$SERVICE"; then
    WAS_ACTIVE=1
fi

if [ -f "$APP_DIR/.env" ]; then
    CONFIG_SOURCE="$APP_DIR/.env"
elif [ -f "$SOURCE_SITE/SERVER-CONFIG-WITH-KEYS.env" ]; then
    CONFIG_SOURCE="$SOURCE_SITE/SERVER-CONFIG-WITH-KEYS.env"
elif [ -f "$SOURCE_SITE/.env.production" ]; then
    CONFIG_SOURCE="$SOURCE_SITE/.env.production"
else
    echo 'ОШИБКА: не найден действующий или комплектный файл конфигурации.'
    exit 1
fi

if [ "$HAD_APP" -eq 1 ]; then
    tar -czf "$BACKUP" -C "$APP_ROOT" 'app'
    test -s "$BACKUP"
fi
if [ -f "$SERVICE_FILE" ]; then
    SERVICE_BACKUP="/root/$SERVICE.service-before-v6.8-$STAMP"
    cp -a "$SERVICE_FILE" "$SERVICE_BACKUP"
fi

cp -a "$SOURCE_SITE/." "$STAGE/"
install -m 600 "$CONFIG_SOURCE" "$STAGE/.env"
rm -f -- "$STAGE/.env.local" "$STAGE/.env.production" "$STAGE/SERVER-CONFIG-WITH-KEYS.env"

cd "$STAGE"
set -a
. "$STAGE/.env"
set +a
node deploy/preflight.mjs
pnpm install --frozen-lockfile
pnpm run build

systemctl stop "$SERVICE" >/dev/null 2>&1 || true
if [ "$HAD_APP" -eq 1 ]; then
    mv "$APP_DIR" "$OLD_DIR"
fi
mv "$STAGE" "$APP_DIR"
STAGE=''
install -d -o www-data -g www-data -m 755 "$APP_DIR/.wrangler"
chown -R www-data:www-data "$APP_DIR"
install -m 644 "$APP_DIR/deploy/luzhniki-parking-subscription.service" "$SERVICE_FILE"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null

if ! systemctl start "$SERVICE"; then
    fail_with_rollback 'новая версия не запустилась.'
fi
sleep 3
systemctl is-active --quiet "$SERVICE" || fail_with_rollback 'сервис не перешёл в активное состояние.'

HEALTH_DIR="$(mktemp -d /tmp/parking-site-v6.8.XXXXXX)"

if ! curl --silent --show-error --fail \
    'http://127.0.0.1:3001/api/promo' \
    > "$HEALTH_DIR/promo.json"; then
    fail_with_rollback 'API сайта не отвечает.'
fi

if ! node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (data.configured !== true || data.mode !== "bitrix") process.exit(1);
' "$HEALTH_DIR/promo.json"; then
    fail_with_rollback 'API сайта не подключён к Bitrix.'
fi

for route in parking-subscription privacy offer legal; do
    if ! curl --silent --show-error --fail \
        "http://127.0.0.1:3001/$route" \
        --output "$HEALTH_DIR/$route.html"; then
        fail_with_rollback "маршрут /$route не отвечает."
    fi
done

ASSET_PATH="$(
    grep -oE '(href|src)="/assets/[^"]+"' "$HEALTH_DIR/parking-subscription.html" \
        | head -n 1 \
        | cut -d '"' -f 2 \
        || true
)"

if [ -z "$ASSET_PATH" ] \
    || ! curl --silent --show-error --fail \
        --output /dev/null \
        "http://127.0.0.1:3001$ASSET_PATH" \
    || ! curl --silent --show-error --fail \
        --output /dev/null \
        'http://127.0.0.1:3001/brand/luzhniki-logo.png'; then
    fail_with_rollback 'статические ресурсы сайта не загружаются.'
fi

rm -rf -- "$HEALTH_DIR"
trap - EXIT

echo 'SITE_INSTALL=OK'
if [ "$HAD_APP" -eq 1 ]; then
    echo "BACKUP=$BACKUP"
    echo "PREVIOUS_APP=$OLD_DIR"
else
    echo 'CLEAN_INSTALL=YES'
fi
echo 'URL=https://parking.luzhniki.ru/parking-subscription'
