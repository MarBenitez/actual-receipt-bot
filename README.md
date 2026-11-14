# actual-receipt-bot

Send a photo of a receipt to a Telegram chat and the expense is logged in [Actual Budget](https://github.com/actualbudget/actual).

- The photo is read **on your own server** with [Tesseract](https://github.com/tesseract-ocr/tesseract) OCR. No AI company sees your receipt.
- The bot replies with the store, the amount and the date, and suggests the category you used last time at that store.
- Nothing is saved until you tap **Save** (✅ Guardar). Anything it misread can be fixed with a button.
- No receipt? Type `12,50 bar` and it logs that.
- It only works for the Telegram users you list in `.env`. Anyone else just gets told their Telegram ID.

> The bot's messages are in Spanish and it reads Spanish receipts (amounts like `23,40`, dates like `13 NOV 2026`).

## What you need

- **Actual Budget running on a server** with Docker (the bot runs as one more container next to it).
- A **Telegram bot token** from [@BotFather](https://t.me/BotFather).
- Some free RAM: the bot used 103 MB right after starting on our server, and the compose file caps it at 512 MB.

## Set it up

1. Create the bot in Telegram: open @BotFather, send `/newbot`, pick a name, copy the token.
2. On your server, clone this repo next to Actual:
   ```
   git clone https://github.com/MarBenitez/actual-receipt-bot.git
   cd actual-receipt-bot
   cp .env.example .env
   ```
3. Fill in `.env` (`TELEGRAM_TOKEN`, `ACTUAL_PASSWORD`, `ACTUAL_SYNC_ID`, `ACTUAL_ACCOUNT`, `ACTUAL_SERVER_URL`).
   Leave `ALLOWED_USER_IDS` empty for now.
4. Find the Docker network of your Actual container and set it as `ACTUAL_NETWORK`:
   ```
   docker inspect <your-actual-container> --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}'
   ```
   Then point `ACTUAL_SERVER_URL` at Actual's container name on that network, e.g. `http://actual:5006`
   (with Actual's official compose file the service is called `actual_server`: `http://actual_server:5006`).
   This needs a user-defined network, which Docker Compose creates for you; the default `bridge` network
   of a plain `docker run` does not resolve container names.
5. Start it:
   ```
   docker compose up -d --build
   docker compose logs -f
   ```
6. Message your bot. It answers "Este bot es privado. Tu número de Telegram es …". Put that number in
   `ALLOWED_USER_IDS` and restart with `docker compose up -d`.
7. Send a receipt photo.

## How well it reads

Measured on 8 invented Spanish receipts, each turned into two simulated phone photos (rendered receipts with
backgrounds, wrinkles, tilt and light added by ImageMagick, not real camera shots), read on macOS with the same code:

| photo | total right |
|---|---|
| normal (good light, flat) | 8 of 8 |
| difficult (faded thermal ink, wrinkled, tilted, dim) | 4 of 8 (3 not read, 1 wrong) |

When it can't find the total it asks you, and it always shows what it read before saving. Real receipts can do worse than these.

`scripts/leer.js photo.jpg` prints what the bot would read from a photo. Outside Docker it needs `tesseract`,
a Python with `opencv-python-headless` and `numpy` (set `PYTHON`), and `TESSDATA_DIR=./tessdata`.

## Privacy

The photo travels through Telegram (normal Telegram chats are stored on Telegram's servers) and is read on the
server where the bot runs. While it is being read it sits in temporary files that are deleted right after.
No AI service is called. The bot keeps a synced copy of your budget in its data volume, so run it on a machine
you trust, ideally the same server as Actual.

## Credits and licenses

- This bot: MIT, see `LICENSE`.
- [Actual Budget](https://github.com/actualbudget/actual) (MIT), through its official API `@actual-app/api`.
- [grammY](https://grammy.dev) for Telegram.
- `tessdata/spa.traineddata` is the Spanish model from [tesseract-ocr/tessdata_best](https://github.com/tesseract-ocr/tessdata_best),
  licensed under Apache-2.0 (full text in `tessdata/LICENSE`). The MIT license of this repo does not cover `tessdata/`.

---

## En español

Mandas la foto de un ticket a un chat de Telegram y el gasto se apunta en Actual Budget. La foto la lee un OCR
(Tesseract) en tu propio servidor, el bot te enseña tienda, importe y fecha, te propone la categoría que usaste la
última vez en esa tienda y no apunta nada hasta que pulsas ✅ Guardar.

Necesitas Actual funcionando en un servidor con Docker y un token de @BotFather. Los pasos son los de arriba: clonar,
copiar `.env.example` a `.env`, rellenarlo, `docker compose up -d --build`, escribir al bot para saber tu número y
ponerlo en `ALLOWED_USER_IDS`.
