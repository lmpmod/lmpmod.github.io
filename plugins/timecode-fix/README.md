---
version: 1.1
---

# Оновлення таймкодів

Оновлює бейджі «переглянуто» одразу після синхронізації таймкодів із сервера lampac, без перезавантаження сторінки.

## Проблема

Плагін таймкодів lampac (`/timecode/js/{token}`) при відкритті картки серіалу асинхронно
завантажує таймкоди з сервера й пише їх у `localStorage`:

```javascript
Lampa.Storage.set(filename, viewed, true);  // nolisten = true
```

Параметр `nolisten` блокує подію зміни, тож `Lampa.Timeline.read()` сам не викликається,
а внутрішній in-memory кеш `Timeline.viewed$1` лишається застарілим. Симптом: епізоди
показані як непереглянуті, хоча дані вже є і в `localStorage`, і на сервері; бейджі
з'являються лише після перезавантаження або повторного відкриття картки.

## Рішення

Плагін перехоплює `Lampa.Storage.set` і після кожного запису ключа `file_view*` з
`nolisten = true`:

1. викликає `Lampa.Timeline.read()` — освіжає кеш `viewed$1`;
2. для кожного хешу з нових даних шле подію `state:changed { target:'timeline', reason:'update' }`.

`reason:'update'` принципово: компоненти епізодів (`listenerTimeline`) реагують лише на
нього, тоді як `Timeline.read()` надсилає `reason:'read'`.

## Сумісність

- Lampa Web, Android, Smart TV.
- Потрібен завантажений timecode-плагін lampac (`timecode: true` у `initPlugins`) —
  без нього просто не буде що перехоплювати.
- Не залежить від версії Lampa: використовує лише публічний API `Lampa.Storage`
  і `Lampa.Timeline`.

## Встановлення

`https://lmpmod.github.io/timecode-fix.js`
