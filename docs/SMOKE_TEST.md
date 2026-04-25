# Smoke Test

Тесты рассчитаны на PostgreSQL и свободные порты `8815/8816`.

## Подготовка

```bash
yarn install
npx playwright install chromium
```

Если нужна чистая локальная БД под новую схему:

```bash
yarn --cwd backend run db:init
```

Если нужно мигрировать старую локальную БД с legacy-схемы:

```bash
yarn --cwd backend run db:migrate:nodes
```

## Быстрый smoke

```bash
yarn run smoke
```

Минимум после фронтовых/WS правок:

```bash
yarn run test:login
```

## Ручная проверка

1. Запуск сервисов:

```bash
yarn run backend:dev
yarn run frontend:dev
```

2. Создать invite:

```bash
yarn run invite:create
```

3. Зарегистрировать 2 пользователей и открыть `/chat` в двух окнах.

4. Проверить:

- login/session restore работают;
- `/console?tab=user&nickname=<мой-ник>` открывается, профиль editable;
- `/console?tab=user&nickname=<чужой-ник>` read-only, есть `Написать` и `Добавить в контакты`;
- при смене аватара открывается crop-оверлей (drag/zoom + круглая маска), после применения avatar обновляется;
- загрузка аватара картинкой работает, рядом в UI виден avatar/fallback;
- у `marx` слева от имени видна красная звезда;
- общий чат `group` работает;
- direct-диалог между пользователями создаётся и открывается;
- push из direct по клику открывает именно целевой direct и прокручивает к нужному сообщению (`/chat?room=<id>&focusMessage=<id>`), без fallback-редиректа в `/chat`;
- отправка text/image/video, edit, delete, reactions работают;
- image upload принимает файлы примерно до 20MB и отправляет пережатый `max 1024x1024` вариант;
- превью `/uploads/*.mp4|webm|mov|m4v|ogv` рендерится как video;
- Rutube-ссылка рендерится embed-preview;
- pinned обычного сообщения в non-direct работает, в direct недоступен;
- в header есть `Закрепить`:
  - в direct закрепляет собеседника в контактах;
  - в room делает `join` и добавляет room в навигацию;
- вкладка `Комнаты` показывает joined/public комнаты;
- элементы в левой навигации стали компактнее, скроллится только список;
- header active dialog показывает avatar room/user, клик по avatar/name ведёт в `/console`;
- создание `public` и `private` room через `/console?tab=rooms` работает;
- room avatar загружается и показывается в header/списках;
- вход в public room через `Войти` работает;
- для admin комнаты invite existing users через контакты/поиск работает;
- в `/console?tab=rooms` для не-admin room есть `Покинуть комнату` (`room:leave`);
- в `/console?tab=rooms` для admin room можно `Выкинуть` участника (с confirm), у исключённого room пропадает из UI;
- список участников в room info отсортирован: online сверху;
- room с `postOnlyByAdmin=true` принимает сообщения только от admin;
- `commentsEnabled=true` даёт кнопку `комментарии+`, `commentsEnabled=false` прячет её и `message:comment-room:create` больше не создаёт новую comment room;
- кнопка комментариев находится снизу справа у сообщения и показывает счётчик;
- comment room открывается как обычная room, а `к посту` возвращает в исходную;
- в header comment room виден avatar исходной комнаты;
- после удаления исходного сообщения comment room не пропадает, но header показывает удалённый источник;
- анонимная отправка пишет `sender_id = id` системного пользователя `anonymous`, в UI автор = `Аноним`;
- анонимная отправка работает и в direct: сообщение отображается как от `Аноним`, в БД автор — системный `anonymous` (не `NULL`);
- `/console?tab=vpn` показывает секции установки приложения и VPN без invites/donation;
- `/console?tab=invites` показывает список room с заголовком `Доступные комнаты для приглашаемого пользователя`;
- invite создаётся с выбранными комнатами;
- использованный invite исчезает из списка, доступный можно удалить вручную;
- redeem invite добавляет нового пользователя только в выбранные комнаты;
- redeem invite у уже зарегистрированного пользователя добавляет только недостающие room и показывает сообщение о новом доступе;
- после logout/login или повторного открытия `/chat` пользователь возвращается в последнюю room/direct;
- `users.name` может совпадать у нескольких пользователей, поиск не должен ломаться.

5. Scriptable сейчас специально НЕ проверяем:
- `message:create(kind='scriptable')` должен вернуть `scriptable_disabled`;
- `runtime:action` должен вернуть `scriptable_disabled`;
- `room:surface:set` должен вернуть `scriptable_disabled`;
- старые scriptable messages не должны валить UI, но интерактивности у них больше нет.

6. После проверки остановить процессы backend/frontend.

## Что больше не проверяем

- `graph:*`
- `/spaces`
- `space/folder/room_ref`

Эта модель выпилена и не должна всплывать ни в тестах, ни в UI.
