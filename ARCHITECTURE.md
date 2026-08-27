# Архитектура Maria POS

Проект состоит из Electron runtime и React-интерфейса. Процессные границы Electron
важнее удобства импорта: renderer не получает прямой доступ к Node.js или Electron API.

## Цели архитектуры

- Разделять Electron runtime, общую frontend-инфраструктуру и бизнес-фичи.
- Держать views тонкими, а сценарии и состояние выносить в hooks, stores или
  service-функции только при реальной сложности.
- Делать фичи автономными, чтобы изменение одной области не ломало соседние.
- Централизовать API, IPC, роутинг, ошибки, кэш и глобальное состояние.
- Поддерживать понятный поток данных: route -> view -> feature flow -> API/state -> UI.
- Упрощать тестирование, сопровождение и переиспользование компонентов.

## Структура

```text
src/
  main/                   # Electron main process: окна, lifecycle, IPC handlers
  preload/                # безопасный typed bridge между main и renderer
  renderer/
    index.html
    src/
      main.tsx            # запуск React и глобальные providers
      App.tsx             # сборка приложения, без бизнес-логики
      assets/             # изображения, шрифты и другие статические ресурсы
      common/             # общая инфраструктура и переиспользуемый код
        api/
          config/        # build-time API configuration
          requests/      # endpoint-функции по backend-областям
          responses/     # snake_case response-контракты backend
          types/         # camelCase request payload-типы
          request.ts     # Axios instances, auth header и refresh/retry
        components/
          ui/             # базовые UI-примитивы без бизнес-логики
        constants/
        helpers/
        lib/
        router/           # composition root TanStack Router
        styles/
      features/           # автономные пользовательские сценарии
        feature-name/
          components/
          hooks/
          stores/
          index.ts        # публичный API фичи
          feature-name-view.tsx
          feature-name.schema.ts
```

Не создавайте все папки заранее. Фича получает только те файлы, которые нужны её
текущему сценарию.

## Границы Electron

### Main

`src/main` управляет окнами, системными API, lifecycle приложения и IPC handlers.
Он не импортирует React-код из renderer.

Production renderer загружается с привилегированного origin `maria://app`, а не
через `file://`. Scheme регистрируется до `app.ready`, обслуживает только файлы из
собранного renderer и отклоняет другие hosts и path traversal. Это даёт приложению
стабильный origin для CSP, CORS и refresh-cookie. Dev/HMR продолжает использовать
локальный HTTP URL electron-vite.

### Preload

`src/preload` остаётся no-op, пока renderer не нужна конкретная системная операция.
При появлении такой операции preload экспортирует минимальный API через
`contextBridge`, а публичный контракт типизируется вместе с декларацией `Window`.
Наружу не передаются `ipcRenderer`, Node.js API или произвольные каналы.

### Renderer

`src/renderer/src` — обычное React-приложение. Доступ к ОС выполняется только через
предметный типизированный preload bridge, когда он появится, а сетевые запросы —
через общий API layer.

Направление зависимостей:

```text
main -> Electron / Node.js
preload -> Electron bridge
renderer App -> common + features
renderer features -> common
common/router -> public features APIs
```

Допустимые зависимости внутри renderer:

```text
feature view -> feature hooks / common api
feature hooks -> common api/router/constants/helpers
feature components -> common components
common/router -> features/*/index.ts
```

Запрещённые зависимости:

```text
renderer -> src/main
renderer -> src/preload internals
common -> features, кроме composition root в common/router
feature A -> feature B internals
component -> raw fetch / axios / ipcRenderer
```

Если две фичи взаимодействуют, используйте route params, общий store, events,
cache invalidation или небольшую common abstraction. Не импортируйте внутренности
соседней фичи напрямую.

## Renderer layers

### App layer

`main.tsx` и `App.tsx` подключают router, глобальные providers, styles и error
boundaries. Бизнес-логика конкретной фичи здесь не размещается.

### Common layer

`common` содержит инфраструктуру или код, используемый минимум двумя фичами:
API client, router, UI-примитивы, helpers, constants и общие types.
Не переносите код в `common` только ради возможного переиспользования в будущем.

`common/router` — единственное разрешённое исключение зависимости common -> features:
route tree собирает экраны через публичные `features/*/index.ts` и не импортирует
их внутренние hooks, stores или views напрямую.

### Feature layer

Каждая папка в `features` представляет пользовательский сценарий или устойчивую
предметную область интерфейса. Фича может содержать view, локальные components,
hooks, schema и store. Межфичевые импорты выполняются только через корневой
`index.ts`; внутренние файлы не являются публичным API.

## Роли файлов

- `*-view.tsx` собирает экран, вызывает flow hook и отображает loading, empty и
  error states. Сетевая и сложная сценарная логика во view не размещается.
- `use-*-flow.ts` оркестрирует форму, запросы, mutations, навигацию и подготовку
  props для view. Простой экран не обязан иметь flow hook.
- `components/` содержит части интерфейса конкретной фичи. Компоненты получают
  данные и callbacks через props.
- `*.schema.ts` описывает только клиентскую валидацию пользовательского ввода.
- `stores/` используется для долгоживущего client state, разделяемого несколькими
  частями приложения. Локальное состояние остаётся в React, server state — в
  query/cache layer.
- Query hook и его переиспользуемые `queryOptions` находятся рядом в feature
  `hooks/`; query keys остаются централизованными в `common/constants`.

## Поток данных

Типичный read-сценарий:

```text
Route
  -> View
  -> Query hook
  -> API request
  -> Response mapper (если нужен)
  -> UI state
  -> Components
```

Типичный write-сценарий:

```text
User action
  -> Component callback
  -> Flow hook
  -> Validation
  -> Mutation или IPC call
  -> Cache invalidation / optimistic update
  -> Navigation / toast / UI feedback
```

Пользователь всегда должен видеть текущее состояние: загрузка, сохранение, ошибка,
пустой результат или успешное действие.

## Роутинг

Приложение использует code-based TanStack Router с `createMemoryHistory`. Route
tree находится в `common/router`: это composition root, которому разрешено
импортировать только публичные API фич. Router plugin, code generation и devtools
не добавляются без реальной необходимости.

Auth guards выполняются в `beforeLoad`, а server data загружается через единые
React Query options. В router context передаётся `QueryClient`, но user,
organization, store и permissions не копируются в router state. Переходы используют
типизированный `to`; строки маршрутов не размножаются за пределами route tree и
небольших feature flows.

## API и IPC

- HTTP-вызовы централизуются в `common/api`; компоненты не выполняют raw-запросы.
- `common/api/requests` содержит короткие endpoint-функции, сгруппированные по
  backend-областям; наружу они экспортируются через `common/api/index.ts`.
- `common/api/responses` описывает внешний snake_case контракт backend, а
  `common/api/types` — внутренние camelCase request payload-типы.
- `VITE_API_URL` обязателен, содержит только API origin и передаётся при build.
- Основной Axios instance использует этот `baseURL`, timeout 15 секунд,
  `Content-Type: application/json` и `withCredentials: true`.
- Отдельный Axios instance выполняет refresh и не получает response interceptor
  основного client, поэтому refresh не может зациклиться.
- Request interceptor получает bearer через внедрённый token-provider. `common`
  не импортирует auth feature; provider настраивается в composition root.
- Plain object payload и query params централизованно переводятся из camelCase в
  snake_case. `FormData` не сериализуется и самостоятельно задаёт content type.
- При 401 с `INVALID_TOKEN`, `INVALID_SESSION` или без `error_code` выполняется
  один single-flight refresh для всех параллельных запросов. Login, register,
  refresh и logout никогда не запускают refresh. Исходный запрос повторяется не
  более одного раза с новым bearer.
- 401 от refresh очищает access token. Другие ошибки refresh передаются вызывающему
  сценарию без скрытых повторов.
- Request-функция описывает endpoint, HTTP method, payload и response type.
- Request-функции снимают только transport envelope `{ data: ... }`; response types
  сохраняют backend snake_case. Mapper добавляется только при реальном отличии UI
  model.
- Backend response types не смешиваются с UI models; mapper добавляется только
  когда формы данных действительно различаются.
- IPC channel обрабатывает одну конкретную операцию и валидирует входные данные
  на границе main process.
- Preload предоставляет предметные методы (`window.api.printReceipt()`), а не
  универсальный `send(channel, payload)`.
- Ошибки HTTP и IPC нормализуются до понятного renderer-контракта в одном месте.

Фичи импортируют готовые request-функции, query/mutation hooks или предметные
preload methods и не знают детали транспорта.

## Server State и Client State

Server state приходит с backend, может устаревать, требует loading/error states и
инвалидируется после mutations. Он хранится в query/cache layer, а не копируется
вручную в global store.

Client state управляет локальным интерфейсом и может жить в React state, URL,
store или local storage. Global store добавляется только когда состояние нужно
нескольким независимым частям приложения или должно переживать экран.

В текущем приложении React Query владеет user, organizations, auth context и
registers. Query hooks/options находятся в соответствующих features, а query keys
объявляются в `common/constants/query-keys.ts` и включают scope, когда ответ зависит
от organization/store. После `select-context` инвалидируются context и зависимые
queries.

Checkout связывает загрузку с жизненным циклом интерфейса: список отложенных чеков
запрашивается только при открытом диалоге, а полный чек — отдельным query с ключом
`queryKeys.sales.detail(saleId)` только после раскрытия его карточки. Закрытые
карточки не создают лишних запросов; loading, error и retry деталей не блокируют
весь список.

Returns следует тому же разделению: `ReturnsView` собирает экран из feature
components, `useReturnsFlow` владеет локальным состоянием и query orchestration,
а `useReturnSubmission` — денежной mutation. Точная pending-команда возврата
хранится в persisted feature store с привязкой к cashier session, чтобы retry после
неоднозначного ответа повторял исходный endpoint, payload и idempotency key.

Zustand хранит ограниченное client state: lifecycle auth-сессии и точные pending
commands денежных операций, которые должны пережить перезапуск экрана. Access token
дублируется в `sessionStorage` только до срока JWT `exp`; refresh token никогда не
доступен JavaScript и остаётся в httpOnly cookie.

## Формы

- Данные формы находятся рядом со сценарием отправки.
- Клиентская схема даёт быстрый feedback, но backend остаётся источником истины.
- Field errors показываются рядом с полями, повторная отправка блокируется в
  pending state.
- Recoverable ошибка не сбрасывает введённые данные.
- Form component отделяется от flow hook только когда это упрощает сложный экран.
- `FormField` задаёт только общий вертикальный ритм label/input/error. Связи
  `htmlFor`, `aria-describedby` и `aria-invalid` остаются явными в форме.
- Для денежных сумм и количества используется `NumericKeypad`, для текста —
  `VirtualKeyboard`; compact-вариант применяется в плотном checkout layout.

## Ошибки и состояния экрана

HTTP и IPC ошибки нормализуются централизованно в категории validation,
unauthorized, forbidden, not found, conflict, network/device и unknown. View не
парсит сырой backend или Electron error.

Экран с данными явно обрабатывает:

- initial loading и background refresh;
- empty state с полезным следующим действием;
- recoverable error и retry;
- permission/access state;
- mutation или destructive action pending;
- success/failure feedback.

Skeleton используется для известного layout, spinner — для короткого перехода.
Составные экраны локализуют состояния: например, ошибка деталей отложенного чека
показывается с retry внутри его карточки и не заменяет весь диалог.

## Именование и импорты

- Компоненты: `kebab-case.tsx`, экспорт — `PascalCase`.
- Hooks: `use-*.ts`; schemas: `*.schema.ts`; stores: `*-store.ts`.
- Для renderer используется существующий alias `@renderer/*`.
- Относительные импорты допустимы внутри одной небольшой фичи; alias используется
  для импортов между renderer layers.
- Каждая feature с внешними потребителями экспортирует стабильный публичный API
  через корневой `index.ts`. Deep-import в её hooks, stores, components и views
  запрещён ESLint.
- Barrel-файлы внутри common добавляются только когда они дают стабильный публичный API.
- Пользовательский текст говорит предметными действиями «выбрать/открыть кассу» и
  «начать/завершить работу». Имена API, query keys, routes и types сохраняют точные
  backend-термины `registerShift` и `cashierSession`.

## Стили и UI

- Глобальные tokens и reset размещаются в `common/styles`.
- Локальные стили остаются рядом с фичей или компонентом.
- Layout страницы и стили маленького компонента не смешиваются в одном файле.
- Design tokens используются вместо magic colors и spacing.
- Responsive constraints предпочтительнее точечных фиксов под один экран.
- UI primitive не содержит бизнес-текст, маршруты или сетевые вызовы.
- UI primitive имеет typed props и поддерживает disabled/loading/error states,
  когда они применимы.
- Интерактивные элементы поддерживают keyboard navigation, focus state и
  доступное имя.
- Loading, empty, error и pending states проектируются вместе с основным сценарием.

Выберите один основной подход к стилям и применяйте его последовательно. Новая UI
библиотека добавляется только если существующих CSS и компонентов недостаточно.

### Текущий визуальный язык

Maria POS использует светлый touch-first интерфейс: почти белый workspace, белые
карточки с тонкой границей и мягкой тенью, фиолетово-индиговый primary и отдельные
success, warning и destructive состояния. Цвета задаются семантическими OKLCH
tokens в `base.css`; feature не копирует их hex/rgb-значения.

Общий стиль строится слоями:

```text
base.css tokens и глобальное touch-поведение
  -> common UI primitives
  -> feature layout и предметные состояния
```

- Inter с системным fallback используется для интерфейса; суммы и количества
  получают `tabular-nums`, чтобы цифры не сдвигали layout.
- Базовая цель нажатия — `3rem` (48 px). Кнопки и клавиатуры отключают выделение,
  используют `touch-action: manipulation`, видимый focus ring и короткий pressed
  feedback.
- `Button`, `Input`, `Dialog`, `FormField`, `NumericKeypad` и `VirtualKeyboard`
  задают общий размер, радиус, состояния и ритм. Фича переопределяет только нужную
  композицию, ширину или визуальный приоритет.
- Основное действие использует primary. Вторичные и потенциально опасные действия
  обычно остаются спокойными ghost/bordered-кнопками; насыщенный destructive
  используется в точке окончательного подтверждения.
- Карточки и диалоги используют крупные скругления, тонкие borders и небольшое
  число теней. Иконка сопровождает текст или имеет доступное имя, но не заменяет
  смысл действия.
- Dialog footer на узком экране складывает полноширинные действия вертикально, на
  широком — выравнивает их горизонтально. Pending-операция блокирует повторную
  отправку и закрытие диалога, если результат операции ещё неизвестен.
- Empty state содержит короткое объяснение и следующий шаг; warning/destructive
  сообщения не полагаются только на цвет.

Checkout на узком экране складывает корзину и панель итогов, а с `lg` использует
две колонки с фиксированной шириной панели действий. Поиск и сканирование находятся
сверху, корзина имеет sticky header, итог и primary action визуально доминируют.
Экранные вызовы клавиатуры используют `VirtualKeyboardOverlay`: dialog закреплён
снизу поверх страницы и не меняет её layout. Клавиатуры внутри dialog/form остаются
inline; compact-вариант применяется только в плотных сценариях.

Экраны выбора рабочего места используют один вертикальный список широких карточек:
название, код и status находятся слева, основное действие — справа; на узком экране
карточка складывается в одну колонку. Это рабочий список, а не dashboard-сетка.

## Авторизация и доступы

При старте session store использует ещё действующий access token или вызывает
`/v1/auth/refresh`, после чего bootstrap получает user, organizations и
`/v1/auth/context`. Новый login всегда ведёт к явному выбору организации и
магазина; восстановленный полный backend context сразу открывает рабочий экран.

Logout очищает token и Query cache только после успешного ответа backend. Network
error или `CASHIER_SESSION_MUST_BE_ENDED` сохраняет локальную сессию, потому что
backend остаётся источником истины и не завершает кассовую сессию автоматически.

HTTP-ошибки переводятся в человекочитаемые сообщения одним helper и показываются
через Sonner. Feature не парсит `error_code` самостоятельно. UI может скрывать
недоступные действия, но обязан корректно обработать backend 403.

## Производительность

Следите за лишними refetch, нестабильными query keys, большими initial bundles,
лишними re-render и тяжёлыми списками без pagination или virtualization. Не
глобализируйте состояние и не добавляйте memoization заранее: оптимизируйте по
измерениям или конкретной проблеме.

## Тестирование

Минимальная стратегия:

- unit tests для helpers, mappers и pure functions;
- component tests для сложных UI-состояний;
- hook tests для flows с mutations и ошибками;
- integration tests для ключевых пользовательских сценариев;
- e2e tests для критичных маршрутов, auth и кассовых операций;
- main/preload tests для денежных операций, IPC validation и аппаратных ошибок.

В первую очередь тестируются формы и валидация, права доступа, error handling,
cache invalidation, routing/guards, IPC contracts и критичные user flows. Snapshot
не заменяет проверку поведения.

UI-тесты проверяют поведение через роли и доступные имена: pending/disabled,
раскрытие составных карточек, lazy query и локальный retry. Layout-контракты,
которые влияют на работу кассира (например, overlay-клавиатура не растягивает
страницу), закрепляются точечной component-проверкой, а не snapshot.

## Проверка изменений

Перед merge запускаются:

```bash
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

Для Windows release дополнительно запускается `npm run build:win` и проверяется
созданный installer.

## Чеклист новой фичи

1. Создать папку сценария в `src/renderer/src/features`.
2. Добавить route и route constants, если фича является экраном.
3. Создать `*-view.tsx`; выделить components или flow hook только при реальной
   сложности.
4. Вынести HTTP request в соответствующую папку `common/api/requests`.
5. Описать response contract в `common/api/responses`, а request payload — в
   `common/api/types`; mapper добавлять только если backend model не подходит UI.
6. Добавить schema, если есть пользовательский ввод.
7. Добавить предметный preload API и main handler, если нужен доступ к ОС.
8. Разделить common components и feature components.
9. Обработать loading, empty, error, permission и pending states.
10. Добавить тест для ключевых веток и критичного пользовательского сценария.
11. Проверить accessibility, типы, lint и production build.

## Красные флаги

- View содержит большую бизнес-логику или сетевые детали.
- Компонент выполняет raw HTTP или IPC call.
- Одна фича импортирует внутренности другой.
- Router импортирует deep path фичи вместо её публичного `index.ts`.
- Server state вручную дублируется в global store.
- Query keys или routes создаются строками в разных местах.
- Backend/IPC errors парсятся отдельно в каждом компоненте.
- Loading и error states добавлены только для happy path.
- UI primitive содержит бизнес-текст или знает route конкретной фичи.
- Preload экспортирует универсальный IPC transport или Node.js API.
- Main process доверяет payload из renderer без validation.
- Большой список не использует pagination, lazy loading или virtualization.
- Стили одной фичи управляют layout другой.

## Когда усложнять

Начинайте с простой feature-based структуры. Абстракция полезна, когда паттерн уже
повторяется в нескольких фичах, скрывает нестабильную внешнюю библиотеку, улучшает
типобезопасность или уменьшает количество решений в каждой фиче.

Новая abstraction, store, mapper, service или dependency не создаются «на
будущее». Добавляйте их после появления повторения, сложного состояния, требований
offline/realtime или измеримой проблемы.

Хорошая архитектура делает пользовательский сценарий видимым в коде: ясный view,
небольшой flow, готовый API/IPC contract и простые компоненты.
