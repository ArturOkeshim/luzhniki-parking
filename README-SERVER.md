# Абонементы «Лужники» — полный комплект файлов 7.0

Дата: 12.11.2026

Это полный каталог приложения `parking.luzhniki.ru`, а не патч и не автоматический установщик. После распаковки файлы можно целиком разместить в:

```text
/opt/luzhniki-parking-subscription/app
```

В комплект уже включён файл `.env` с действующей конфигурацией и ключами. Его резервная копия находится в `SERVER-CONFIG-WITH-KEYS.env`. Оба файла должны храниться с правами `600` и не должны попадать в публичный каталог Nginx.

## Что исправлено в этой версии

- при вводе российского ГРН выполняется серверная проверка неоплаченных штрафов;
- буквы российского ГРН можно вводить кириллицей, латиницей или смешанно; перед проверкой и созданием заявки они приводятся к кириллице;
- найденный штраф блокирует создание абонемента и показывает кнопку перехода на `testnpp.luzh-dev.ru` с уже заполненным ГРН;
- проверка работает только на чтение и не меняет карточки штрафов в Bitrix;
- иностранные номера не отправляются в сервис штрафов и продолжают оформляться по прежней логике;
- если сервис проверки временно недоступен, оформление абонемента остаётся доступным;
- перед Сбером открывается штатная страница Bitrix Pay Luzhniki `pay.luzhniki.ru/oformleniezakaza/`;
- полная публичная ссылка получается методом `salescenter.payment.getPublicUrl`;
- короткий CRM-редирект не подменяет штатную страницу оплаты;
- при задержке формирования ссылки сайт автоматически повторяет запрос;
- возврат из банка сам по себе не считается успешной оплатой;
- экран «Абонемент оплачен» появляется только после подтверждения фактического статуса `PAID=Y`;
- сохранены последние исправления контактов, заказов, корзины, чеков, согласий, тарифов и московского календаря;
- срок действия составляет ровно 30 календарных дней включительно: дата окончания равна дате старта плюс 29 дней.

## Структура

```text
app/                         страницы и серверные API-маршруты
deploy/                      готовые примеры systemd и Nginx
public/                      изображения, шрифты и документы
tests/                       автоматические проверки дат и возврата оплаты
worker/                      production entrypoint
.env                         готовая серверная конфигурация с ключами
.env.example                 шаблон конфигурации
SERVER-CONFIG-WITH-KEYS.env  резервная копия готовой конфигурации
package.json                 команды сборки и запуска
pnpm-lock.yaml               зафиксированные версии зависимостей
vite.config.ts               production-конфигурация
```

В архив намеренно не включены `node_modules`, `dist`, `.wrangler`, журналы и старые сборки.

## Ручное размещение на новом сервере

Нужны Node.js 22 или новее, Corepack/pnpm, systemd и Nginx. Команды выполняются от `root` после распаковки архива:

```bash
install -d -o www-data -g www-data -m 755 /opt/luzhniki-parking-subscription/app
cp -a . /opt/luzhniki-parking-subscription/app/
cd /opt/luzhniki-parking-subscription/app

chmod 600 .env SERVER-CONFIG-WITH-KEYS.env
corepack enable
pnpm install --frozen-lockfile
pnpm test
pnpm run build

install -o root -g root -m 644 \
  deploy/luzhniki-parking-subscription.service \
  /etc/systemd/system/luzhniki-parking-subscription.service

install -d -o www-data -g www-data -m 755 .wrangler
chown -R www-data:www-data /opt/luzhniki-parking-subscription/app
chmod 600 /opt/luzhniki-parking-subscription/app/.env

systemctl daemon-reload
systemctl enable --now luzhniki-parking-subscription
systemctl status luzhniki-parking-subscription --no-pager
```

Конфигурация Nginx находится в `deploy/nginx-parking.luzhniki.ru.conf.example`. Перед её включением нужно учесть действующую схему SSL на сервере. После добавления конфигурации:

```bash
nginx -t
systemctl reload nginx
```

## Проверка после запуска

```bash
curl --fail http://127.0.0.1:3001/api/promo
curl --fail 'http://127.0.0.1:3001/api/parking-subscription/fines?plate=%D0%90000%D0%90%D0%9077'
curl --fail --output /dev/null http://127.0.0.1:3001/parking-subscription
journalctl -u luzhniki-parking-subscription -n 100 --no-pager
```

На сайте нужно проверить полный путь:

```text
Страница абонементов → Pay Luzhniki → Сбер
```

Публичная ссылка должна иметь хост `pay.luzhniki.ru` и путь `/oformleniezakaza/`.

## Важно

- этот комплект не изменяет ядро Bitrix;
- действующий `/local/promo-api/index.php` на сервере CRM должен оставаться доступен;
- `FINES_PAYMENT_URL` должен вести на доступный пользователю сайт оплаты штрафов;
- архив содержит секреты и не предназначен для публичной передачи;
- контрольную оплату проводите отдельно после запуска; сборка и проверки не списывают деньги.
