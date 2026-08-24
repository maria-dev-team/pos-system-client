# Архитектура renderer Maria POS

Этот документ описывает правила разработки React-интерфейса в
`src/renderer/src`. Общие границы Electron main, preload и renderer остаются в
`ARCHITECTURE.md`.

## Цели

- Разделять общую frontend-инфраструктуру, UI-примитивы и бизнес-фичи.
- Держать экраны небольшими, а запросы и разделяемое состояние — вне JSX.
- Делать фичи автономными и связывать их через публичные API.
- Централизовать HTTP, роутинг, ошибки, server cache и auth session.
- Сохранять понятный поток данных: route -> view -> hook -> API/state -> UI.
- Добавлять структуру и абстракции только при реальной необходимости.

## Структура

```text
src/renderer/src/
  main.tsx                 # запуск React и глобальные providers
  App.tsx                  # RouterProvider без бизнес-логики
  env.d.ts
  test-setup.ts
  assets/                  # статические renderer-ресурсы
  common/
    api/
      config/              # build-time конфигурация API
      requests/            # endpoint-функции по backend-областям
      responses/           # snake_case response-контракты backend
      types/               # camelCase request payload-типы
      request.ts           # Axios, auth header и refresh/retry
    components/
      ui/                  # локальные shadcn/ui-примитивы
    config/                # build-time UI-конфигурация
    constants/             # query keys и общие константы
    helpers/               # небольшие общие pure helpers
    lib/                   # настройка библиотек и низкоуровневые utilities
    router/                # composition root TanStack Router
    styles/                # tokens, reset и глобальные стили
  features/
    feature-name/
      components/
      hooks/
      stores/
      feature-name-view.tsx
      feature-name.schema.ts
      index.ts             # публичный API фичи
```

Не создавайте все папки заранее. Фича содержит только файлы, необходимые её
текущему сценарию.

## Слои

### App

`main.tsx` и `App.tsx` собирают runtime приложения:

- React root;
- QueryClient;
- router;
- глобальные providers;
- Sonner;
- глобальные стили.

Здесь не размещается бизнес-логика конкретной фичи. Token provider связывается с
auth store в `main.tsx`, потому что это composition root, а `common` не должен
импортировать auth feature.

### Common

`common` содержит инфраструктуру приложения или код, который действительно нужен
нескольким фичам:

- API client и backend-контракты;
- router;
- базовые UI-примитивы;
- query keys;
- helpers;
- настройку библиотек;
- глобальные стили.

Не переносите код в `common` ради возможного переиспользования в будущем.

### Features

Фича представляет пользовательский сценарий или устойчивую область интерфейса.
Она может содержать view, локальные components, hooks, schema и stores.

Каждая фича с внешними потребителями экспортирует стабильный публичный API через
корневой `index.ts`. Соседние фичи и router не импортируют её внутренние файлы.

Текущие области:

- `auth` — login, выбор контекста, session store и logout;
- `organizations` — запрос доступных организаций;
- `register-shifts` — активные кассы, выбор, открытие и закрытие `register_shift`;
- `status-bar` — глобальный контекст, пользователь, API health, часы и logout;
- `user` — запрос текущего пользователя;
- `development` — временный debug-экран.

## Направление зависимостей

```text
App -> common + features
features -> common
common/router -> features/*/index.ts
```

Допустимо:

```text
feature view -> собственные hooks/components
feature hook -> common api/constants/helpers
feature component -> common components
feature A -> feature B public index.ts
common/router -> feature public index.ts
```

Запрещено:

```text
common -> features, кроме common/router
feature A -> feature B internals
router -> feature deep import
component -> raw axios/fetch
renderer -> main/preload internals
```

Deep-import в `components`, `hooks`, `stores`, `login` и `*-view` соседней фичи
запрещён ESLint. Относительные импорты допустимы внутри одной фичи; между слоями
используется alias `@renderer/*`.

## Роли файлов

### View

`*-view.tsx` собирает экран:

- layout;
- feature hooks;
- loading, empty и error states;
- локальные и общие компоненты.

View не выполняет raw HTTP-запросы и не знает детали Axios. Простая локальная
форма или mutation может оставаться во view; отдельный flow hook добавляется,
когда он реально уменьшает сложность экрана.

### Hooks

Feature hook владеет переиспользуемым query/mutation поведением или сценарием.
Query hook и его `queryOptions` находятся рядом. Query keys объявляются только в
`common/constants/query-keys.ts`.

### Components

- `common/components/ui` — базовые shadcn/ui-примитивы без бизнес-смысла;
- `common/components` — повторяемые UI-паттерны приложения;
- `features/*/components` — части интерфейса одной фичи.

Feature component получает данные и callbacks через props и не обращается к API,
если запрос не является его явной ответственностью.

Переиспользуемое POS-действие не знает, на каком экране размещено. Например,
`CloseRegisterShiftAction` получает `registerShiftId` и callback завершения,
самостоятельно выполняет mutation и показывает сверку, но не импортирует router
или временный debug feature.

### Schemas

`*.schema.ts` описывает клиентскую валидацию ввода: обязательность, формат,
длину и допустимые значения. Backend остаётся источником истины для бизнес-правил.

### Stores

Store используется для долгоживущего client state, которое нужно нескольким
независимым частям приложения. Локальное UI-состояние остаётся в React, server
state — в React Query.

## React и TypeScript

- Компоненты называются в `PascalCase`, файлы — в `kebab-case.tsx`.
- Hooks называются `use-*.ts`, schemas — `*.schema.ts`, stores — `*-store.ts`.
- Props, используемые одним компонентом, объявляются рядом с ним.
- TypeScript самостоятельно выводит тип результата React-компонента. Не указывайте
  `React.JSX.Element` вручную без причины; это не DOM-элемент и на runtime не
  влияет.
- `any`, non-null assertions и подавления TypeScript без объяснения не
  используются.

## Shadcn-first UI

Перед созданием нового базового контрола проверьте shadcn/ui. Доступные примитивы
устанавливаются через shadcn CLI и хранятся в `common/components/ui`.

Сейчас renderer использует локальные `Button`, `Input`, `Label` и `Tooltip`.
Это исходный код компонентов проекта, а не runtime-зависимость от внешнего
компонентного сервиса. Radix отвечает за доступность сложных примитивов вроде
tooltip.

Не реализуйте заново focus trap, keyboard navigation, outside click, portal,
modal overlay или scroll lock. Common- и feature-компоненты могут только тонко
компоновать shadcn-примитивы под API проекта.

Стили адаптируются через semantic CSS variables в `common/styles/base.css`.
Feature UI использует semantic tokens вместо magic colors, теней и радиусов.
Интерактивные элементы обязаны иметь доступное имя, focus state и keyboard
navigation.

Конфигурация shadcn CLI находится в корневом `components.json`:

```bash
npx shadcn@latest add <component>
```

Не добавляйте похожий самописный primitive, если shadcn/Radix уже решает задачу.

## API

```text
common/api/
  config/
  requests/
    auth/
    organizations/
    registers/
    users/
  responses/
  types/
  request.ts
```

Request-функция описывает только endpoint, HTTP method, payload и response type.
Она импортирует payload из `common/api/types`, response — из
`common/api/responses`, снимает transport envelope `{ data: ... }` и экспортируется
через `common/api/index.ts`.

Правила контрактов:

- backend response сохраняется в snake_case;
- request payload внутри renderer объявляется в camelCase;
- общий serializer переводит plain object body и params в snake_case;
- `FormData` не проходит через общий serializer;
- UI model и mapper добавляются только когда backend-модель реально неудобна UI;
- компоненты не импортируют Axios instance и не создают raw HTTP-вызовы.

Transport в `request.ts` отвечает за:

- обязательный build-time `VITE_API_URL`;
- timeout 15 секунд, JSON и `withCredentials`;
- bearer access token через внедрённый token provider;
- отдельный refresh client;
- single-flight refresh для параллельных 401;
- максимум один повтор исходного запроса;
- исключение login, register, refresh и logout из refresh loop.

Refresh token остаётся только в httpOnly cookie и недоступен renderer JavaScript.

## Server state и client state

React Query владеет user, organizations, auth context, registers и
register shifts, а также API health. Server state не копируется в Zustand.

Query keys централизованы:

```ts
queryKeys.auth.context();
queryKeys.auth.currentUser();
queryKeys.health.api();
queryKeys.organizations.mine();
queryKeys.registers.all();
queryKeys.registers.active(storeId);
queryKeys.registerShifts.all();
queryKeys.registerShifts.current(registerId);
```

Zustand хранит lifecycle auth session: access token, initialization/logout и
pending flags. Access token сохраняется в `sessionStorage` только до JWT `exp`.

После смены organization/store инвалидируются context и зависимые queries.
После закрытия кассовой смены current-shift cache соответствующей кассы сразу
очищается; переход выполняет экран-потребитель после подтверждения сверки.

## Роутинг

Renderer использует code-based TanStack Router с memory history. Route tree
находится в `common/router`, потому что это composition root приложения.

Это единственное исключение зависимости `common -> features`: router импортирует
экраны и query options только из `features/*/index.ts`.

Auth guards выполняются в `beforeLoad`. В router context передаётся QueryClient,
но user, organization, store и permissions не дублируются в router state.

Текущие маршруты:

```text
/
/login
/select-organization
/select-store
/select-register-shift
/debug
```

Корневой route layout владеет общим shell: status bar занимает фиксированную
высоту, а содержимое текущего маршрута прокручивается отдельно. Полноэкранные
views используют высоту родителя, а не повторный viewport height.

Состав status bar и частота `/health` задаются build-time конфигурацией в
`common/config/status-bar.config.ts`. Известные элементы можно менять местами,
добавлять и убирать через `leftItems`/`rightItems`. Health-check хранится в React
Query, не вызывает toast при потере связи и не заменяется `navigator.onLine`,
поскольку POS должен показывать доступность backend, а не только наличие сети.

## Auth и ошибки

При старте session store использует действующий access token или вызывает
`/v1/auth/refresh`, затем bootstrap получает user, organizations и auth context.

Новый login всегда ведёт к явному выбору организации и магазина. Восстановленный
полный context сразу открывает следующий рабочий экран.

Logout очищает token и Query cache только после успешного ответа backend. Network
error или `CASHIER_SESSION_MUST_BE_ENDED` сохраняет локальную сессию.

HTTP-ошибки нормализуются одним helper и показываются через Sonner. Feature не
парсит `error_code` самостоятельно. Recoverable ошибка не сбрасывает введённые
данные или выбранный контекст.

Каждый экран с server data явно обрабатывает:

- initial loading;
- background refetch, когда он заметен пользователю;
- empty state;
- recoverable error и retry;
- permission/access state;
- mutation pending;
- success/failure feedback.

## Поток данных

Read:

```text
Route
  -> View
  -> Query hook/options
  -> API request
  -> Response mapper, если нужен
  -> UI state
  -> Components
```

Write:

```text
User action
  -> Component callback
  -> Validation
  -> Mutation
  -> Cache invalidation
  -> Navigation / toast / UI feedback
```

## Тестирование

В первую очередь тестируются:

- формы и валидация;
- API serialization и contracts;
- refresh single-flight и session lifecycle;
- error normalization;
- query invalidation;
- routing и guards;
- критичные auth/POS flows.

Snapshot tests не заменяют поведенческие проверки.

Перед merge:

```bash
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

## Чеклист новой фичи

1. Создать папку сценария в `features`.
2. Добавить `index.ts` с минимальным публичным API.
3. Добавить route в `common/router`, если фича является экраном.
4. Создать `*-view.tsx`; выделять components или flow hook только при реальной
   сложности.
5. Добавить request в соответствующую область `common/api/requests`.
6. Описать response contract и request payload в соответствующих API-папках.
7. Добавить schema, если есть пользовательский ввод.
8. Переиспользовать shadcn/common components до создания нового primitive.
9. Обработать loading, empty, error, permission и pending states.
10. Добавить тесты для ключевых веток.
11. Проверить keyboard navigation, focus state, типы, lint и build.

## Красные флаги

- View содержит большую бизнес-логику или сетевые детали.
- Компонент выполняет raw HTTP-запрос.
- Одна фича импортирует внутренности другой.
- Router импортирует deep path фичи вместо `index.ts`.
- Server state дублируется в Zustand.
- Query keys создаются строками в разных местах.
- Backend errors парсятся отдельно в каждом компоненте.
- UI primitive содержит бизнес-текст или знает route фичи.
- Feature создаёт собственный dialog/select/tooltip при наличии shadcn primitive.
- Loading и error states существуют только для happy path.
- Абстракция или dependency добавлена «на будущее».

## Когда усложнять

Начинайте с простой feature-based структуры. Новая abstraction, store, mapper,
service или dependency оправдана, когда уже есть повторение, сложное разделяемое
состояние, требования offline/realtime или измеримая проблема.

Хорошая renderer-архитектура делает пользовательский сценарий видимым в коде:
небольшой view, необходимый hook, готовый API contract и простые компоненты.
