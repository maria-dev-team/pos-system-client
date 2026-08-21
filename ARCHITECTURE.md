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
        api/              # HTTP client, requests и response types
        components/
          ui/             # базовые UI-примитивы без бизнес-логики
        constants/
        helpers/
        hooks/
        lib/
        router/
          guards/
        styles/
        types/
      features/           # автономные пользовательские сценарии
        feature-name/
          components/
          hooks/
          lib/
          stores/
          feature-name-view.tsx
          feature-name.schema.ts
          use-feature-name-flow.ts
          feature-name.module.css
```

Не создавайте все папки заранее. Фича получает только те файлы, которые нужны её
текущему сценарию.

## Границы Electron

### Main

`src/main` управляет окнами, системными API, lifecycle приложения и IPC handlers.
Он не импортирует React-код из renderer.

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
```

Допустимые зависимости внутри renderer:

```text
feature view -> feature hooks
feature hooks -> common api/router/constants/helpers
feature components -> common components
```

Запрещённые зависимости:

```text
renderer -> src/main
renderer -> src/preload internals
common -> features
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
API client, router, guards, UI-примитивы, helpers, constants и общие types.
Не переносите код в `common` только ради возможного переиспользования в будущем.

### Feature layer

Каждая папка в `features` представляет пользовательский сценарий. Фича может
содержать view, локальные components, hooks, schema и store. Её внутренние файлы
не являются публичным API для соседних фич.

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
  query/cache layer, когда он появится.

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

Роутинг централизуется в `common/router` и использует единый словарь route
constants. Guards отвечают только за auth/setup/access проверки; сложные переходы
выносятся в отдельный hook или route helper. Dynamic routes строятся общим helper,
а не строками внутри компонентов.

## API и IPC

- HTTP-вызовы централизуются в `common/api`; компоненты не выполняют raw-запросы.
- API layer отвечает за base URL, credentials, auth headers, refresh flow, error
  normalization и retry policy, если она действительно нужна.
- Request-функция описывает endpoint, HTTP method, payload и response type.
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

## Формы

- Данные формы находятся рядом со сценарием отправки.
- Клиентская схема даёт быстрый feedback, но backend остаётся источником истины.
- Field errors показываются рядом с полями, повторная отправка блокируется в
  pending state.
- Recoverable ошибка не сбрасывает введённые данные.
- Form component отделяется от flow hook только когда это упрощает сложный экран.

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

## Именование и импорты

- Компоненты: `kebab-case.tsx`, экспорт — `PascalCase`.
- Hooks: `use-*.ts`; schemas: `*.schema.ts`; stores: `*-store.ts`.
- Для renderer используется существующий alias `@renderer/*`.
- Относительные импорты допустимы внутри одной небольшой фичи; alias используется
  для импортов между renderer layers.
- Barrel-файлы добавляются только когда они дают стабильный публичный API.

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

## Авторизация и доступы

Auth state централизуется в session store или provider. Refresh, logout и session
expired имеют единый сценарий; guards используют этот контракт и не дублируют
auth-логику. UI может скрывать недоступные действия, но backend остаётся источником
истины для прав.

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

## Проверка изменений

Перед merge запускаются:

```bash
npm run format
npm run lint
npm run typecheck
npm run build
```

Для Windows release дополнительно запускается `npm run build:win` и проверяется
созданный installer.

## Чеклист новой фичи

1. Создать папку сценария в `src/renderer/src/features`.
2. Добавить route и route constants, если фича является экраном.
3. Создать `*-view.tsx`; выделить components или flow hook только при реальной
   сложности.
4. Вынести HTTP request в `common/api`, если нужен backend.
5. Описать response type и mapper, только если backend model не подходит UI.
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
