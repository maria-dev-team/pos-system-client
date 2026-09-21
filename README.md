# DukenAI POS

Кассовое Electron-приложение на React и TypeScript.

## Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/) + [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint) + [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)

## Project Setup

### Install

```bash
$ npm install
```

### Development

```bash
$ npm run dev
```

### Build

```bash
$ npm run build:win
```

Before packaging, place a trusted Windows x64 FFmpeg executable at
`resources/ffmpeg.exe`.

## Windows releases

The `Release Windows` GitHub Actions workflow builds and uploads a Windows
installer when a GitHub Release is published. The application version is taken
from a semantic version tag such as `v1.0.1` during the build.

Configure this repository variable in **Settings → Secrets and variables →
Actions → Variables**:

- `POS_API_URL` — production API URL embedded into the application.

The workflow downloads a pinned Windows x64 LGPL FFmpeg build and verifies its
SHA-256 checksum. No FFmpeg variables or committed binary are required.

To publish any version, open GitHub **Releases → Draft a new release**, create a
new tag in the `vMAJOR.MINOR.PATCH` format (for example, `v1.0.0` or `v1.0.1`),
select `main`, and publish the release. Updating and committing `package.json`
before a release is not required. The public download URL for the latest
installer is stable:

```text
https://github.com/maria-dev-team/pos-system-client/releases/latest/download/dukenai-pos-setup.exe
```

The repository must be public for unauthenticated downloads from a website. If
the repository is private, release assets require GitHub authentication and
cannot be used as a public download URL.

## Два штрихкода товара

Касса принимает основной `barcode` и дополнительный `additional_barcode`, включая
внутренние EAN-13, сгенерированные в каталоге. Оба кода доступны в поиске и при
сканировании онлайн/офлайн. Сканирование разных кодов одного товара увеличивает
количество в одной строке чека; в снимке строки сохраняется основной штрихкод.
Совпадение с несколькими товарами, в том числе через GTIN, требует выбора товара.

При первом запуске обновлённой версии SQLite автоматически переходит на схему 2:
добавляется индекс дополнительного штрихкода и сбрасываются старые курсоры загрузки
каталога для всех магазинов. Каталог один раз перечитывается в фоне, поскольку
старый парсер API мог отбросить дополнительный код. Сохранённые товары, чеки и
очередь отправки остаются на месте. До получения обновлённого каталога офлайн
доступны ранее сохранённые коды; онлайн-поиск может дополнить старую карточку сразу.
Повторный запуск продолжает прерванную загрузку, а не начинает её заново.

Требуется версия core-api с поддержкой дополнительного штрихкода и применённой
миграцией `1789862400000-add-additional-product-barcode`. Ответ старого сервера без
`additional_barcode` также принимается: поле считается пустым. Генерация кодов
остаётся в административном клиенте; касса использует сохранённые коды.

## Проверка цены до добавления в чек

Кнопка «Проверить цену» рядом с поиском открывает отдельное окно. Найти товар
можно по названию, основному или дополнительному штрихкоду, в том числе сканером.
Окно показывает цену каталога за единицу товара. Сканирование и Enter не создают
и не изменяют чек; добавление выполняется только кнопкой «Добавить в чек».
Для маркированного товара перед добавлением требуется Data Matrix с упаковки.

Просмотр доступен с правом `product.read`, даже без прав создания/изменения продаж.
В подключённой локальной кассе без сети используется сохранённый каталог; цена
соответствует последним полученным данным. Если цена не задана или товар неактивен,
добавление недоступно.

## Внесение и изъятие наличных

В блоке «Касса и отчёты» доступны кнопки «Внесение» и «Изъятие». Необходимо право
`cash_movement.create` и доступ к собственной активной смене. Форма запрашивает
сумму и причину, показывает остаток и историю. Операции учитываются при закрытии
смены и проверке наличных возвратов; изъять больше доступного остатка нельзя.

Требуется обновлённый core-api с миграцией `1789948800000-create-cash-movements`.
Проведение доступно при подключении к серверу после синхронизации локальных чеков.
При потере ответа команда сохраняется; кнопка «Повторить проверку операции»
повторяет её с тем же UUID, исключая дублирование. До проверки такой команды
нельзя завершить кассирскую смену через POS.

В этой версии реализован внутренний учёт Maria. Передача денежных операций
в WebKassa/reKassa и печать их фискальных документов пока не реализованы.
