# ANDROID_APK

Минимальная Android-обёртка для текущего MARX frontend сделана через Capacitor.

## Что используется
- Nuxt 3 SPA (`ssr: false`)
- web assets после сборки: `frontend/.output/public`
- Android-платформа: `frontend/android`

## Подготовка
```bash
cd frontend
yarn install
cp config.example.json config.json
```

## Сборка web assets
```bash
yarn generate
```
Проверка:
```bash
ls -l .output/public/index.html
```

## Синхронизация с Android
```bash
yarn android:sync
```
Команда делает:
1. `yarn generate`
2. `cap sync android`

## Открыть в Android Studio
```bash
yarn android:open
```
Если Capacitor не находит Android Studio, укажи путь вручную:
```bash
export CAPACITOR_ANDROID_STUDIO_PATH=/path/to/android-studio/bin/studio.sh
```

## Запуск на телефоне
1. Подключить устройство с включённым `USB debugging`.
2. Открыть `frontend/android` в Android Studio.
3. Нажать `Run 'app'` и выбрать устройство.

CLI-вариант (если устройство доступно):
```bash
yarn android:run
```

## Запуск на эмуляторе
1. Создать/запустить AVD в Android Studio (Device Manager).
2. Запустить `Run 'app'`.

CLI-вариант:
```bash
yarn android:run
```

## Где лежит debug APK
После сборки debug:
- `frontend/android/app/build/outputs/apk/debug/app-debug.apk`

## Примечания
- В `AndroidManifest.xml` включён `INTERNET`.
- `cleartext` включён (`usesCleartextTraffic=true`), потому что текущий `frontend/config.example.json` использует `apiUrl: http://...`.
- PWA/service worker не отключались: на этом этапе они не блокируют `generate`/`sync` и запуск Android-wrapper.
