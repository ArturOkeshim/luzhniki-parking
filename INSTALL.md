# Установка PARKING-SUBSCRIPTION-LOCAL-V6.8-TABLE-COMPLIANCE

## Требования

- Linux-сервер сайта;
- доступ `root` по SSH;
- Node.js 22 или новее;
- `pnpm`, `curl`, `tar`, `systemd`;
- действующий Nginx для `parking.luzhniki.ru` либо настройка из комплектного примера.

Не используйте имя `aqua-bitrix-srv01`, если оно не разрешается на вашем компьютере. В командах ниже замените `<IP_СЕРВЕРА_САЙТА>` на фактический IP или рабочее DNS-имя именно сервера сайта.

## 1. Передача архива с Windows PowerShell

```powershell
$archive = "C:\Users\1\Downloads\PARKING-SUBSCRIPTION-LOCAL-V6.8-TABLE-COMPLIANCE-WITH-KEYS-2026-10-09.zip"
$server = "<IP_СЕРВЕРА_САЙТА>"

scp $archive "root@${server}:/root/"
ssh "root@$server"
```

## 2. Проверка архива на сервере

```bash
cd /root
sha256sum PARKING-SUBSCRIPTION-LOCAL-V6.8-TABLE-COMPLIANCE-WITH-KEYS-2026-10-09.zip
```

Сверьте значение с файлом `.sha256.txt`, который лежит рядом с архивом на компьютере.

## 3. Распаковка

```bash
cd /root
unzip -q PARKING-SUBSCRIPTION-LOCAL-V6.8-TABLE-COMPLIANCE-WITH-KEYS-2026-10-09.zip
cd PARKING-SUBSCRIPTION-LOCAL-V6.8-TABLE-COMPLIANCE-2026-10-09
chmod 700 install.sh
chmod 600 site/.env.production
chmod 600 site/SERVER-CONFIG-WITH-KEYS.env
```

## 4. Предварительная проверка

```bash
node --version
pnpm --version
set -a
. site/SERVER-CONFIG-WITH-KEYS.env
set +a
node site/deploy/preflight.mjs
```

Если `preflight.mjs` сообщает об отсутствующих переменных, не запускайте установку, пока конфигурация не исправлена.

## 5. Установка

```bash
./install.sh
```

Успешный результат:

```text
SITE_INSTALL=OK
URL=https://parking.luzhniki.ru/parking-subscription
```

При обновлении существующей версии установщик дополнительно покажет пути к резервной копии и предыдущему каталогу. При ошибке после переключения приложения старая версия восстанавливается автоматически.

## 6. Проверка

```bash
systemctl status luzhniki-parking-subscription --no-pager
curl -fsS http://127.0.0.1:3001/api/promo
curl -fsS http://127.0.0.1:3001/api/parking-subscription/calendar
curl -I https://parking.luzhniki.ru/parking-subscription
```

Откройте `https://parking.luzhniki.ru/parking-subscription` и проверьте:

1. дизайн и логотип загрузились;
2. промокод проверяется через Bitrix;
3. дата соответствует Москве;
4. срок составляет 30 календарных дней включительно;
5. после тестовой оплаты открывается подтверждение на сайте, а не страница заказа Bitrix;
6. в Bitrix созданы одна сделка, один заказ, один платёж и один кассовый чек.

## 7. Если на чистом сервере ещё нет Nginx-конфигурации

Сначала проверьте и адаптируйте пример:

```bash
cp site/deploy/nginx-parking.luzhniki.ru.conf.example /etc/nginx/conf.d/parking.luzhniki.ru.conf
nginx -t
systemctl reload nginx
```

На уже работающем сервере этот шаг не выполняйте.

## Безопасность

```bash
chmod 600 /root/PARKING-SUBSCRIPTION-LOCAL-V6.8-TABLE-COMPLIANCE-WITH-KEYS-2026-10-09.zip
```

После успешной установки не переносите архив в каталог, доступный через Nginx.
