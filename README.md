# VKBOT ArturRU

VK-бот для знакомств: анкеты, лайки, фильтры, админ-панель.

## Возможности

- Регистрация анкеты: пол, возраст, город, имя, описание, фото.
- Просмотр анкет противоположного пола по городу и фильтрам.
- Лайки, уведомления о симпатии и взаимная симпатия.
- Для мужчин лайки доступны после оплаты подписки; для девушек — бесплатно.
- Кнопка «Поднять в топ 🔝» в меню (у мужчин — вместе с оплатой).
- Админ-панель: статистика, пользователи, поиск, блокировка, тестовые анкеты, ссылки канала и модератора.
- Данные хранятся локально в `data/db.json`.

## Требования

- Node.js 18+
- Токен группы VK с доступом к сообщениям
- Long Poll включён в настройках группы
- Магазин ЮKassa (тестовый или боевой)

## Настройка

```bash
cp .env.example .env
```

```env
VK_TOKEN=токен_группы
ADMIN_IDS=123456789

YOOKASSA_SHOP_ID=shop_id
YOOKASSA_SECRET_KEY=secret_key
YOOKASSA_TEST_MODE=true

SUBSCRIPTION_AMOUNT=1
BOOST_AMOUNT=1
SUBSCRIPTION_DAYS=30
BOOST_DAYS=30

WEBHOOK_PORT=3001
WEBHOOK_PATH=/yookassa/webhook
YOOKASSA_RETURN_URL=https://vk.com
```

Суммы `SUBSCRIPTION_AMOUNT` и `BOOST_AMOUNT` задаются в рублях. Для тестов по умолчанию стоит **1 ₽**.

## Запуск

```bash
npm install
npm run stop
npm start
```

- `npm run stop` — остановить бота перед перезапуском
- `npm run fix-photos` — перезалить фото анкет для группового токена
- `npm test` — автотесты
- `npm run check` — проверка синтаксиса

## ЮKassa

1. Создайте платёж — бот отправляет ссылку ЮKassa в VK (кнопка `open_link`).
2. Webhook — бот поднимает HTTP-сервер на `WEBHOOK_PORT` по пути `WEBHOOK_PATH`.
3. В личном кабинете ЮKassa укажите URL webhook, например:
   `https://ваш-домен.ru/yookassa/webhook`
4. Включите событие `payment.succeeded`.

На VPS проксируйте порт через nginx:

```nginx
location /yookassa/webhook {
    proxy_pass http://127.0.0.1:3001/yookassa/webhook;
}
```

После успешной оплаты подписки мужчине активируется доступ к лайкам. После оплаты «Поднять в топ» анкета показывается первой в выдаче.

## VPS (systemd)

1. Склонировать в отдельную папку, например `/var/www/vk-bot-arturru`
2. `npm install`
3. Создать `.env`
4. Поправить пути в `vkbot-arturru.service`
5. Установить сервис:

```bash
sudo cp vkbot-arturru.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable vkbot-arturru
sudo systemctl start vkbot-arturru
cd /var/www/vk-bot-arturru
npm run fix-photos
```

Логи: `sudo journalctl -u vkbot-arturru -f`

## Обновление

```bash
cd /var/www/vk-bot-arturru
npm run stop
git pull
npm install
npm test
sudo systemctl restart vkbot-arturru
```
