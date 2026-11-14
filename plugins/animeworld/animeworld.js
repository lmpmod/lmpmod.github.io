(function () {
    'use strict';

    /**
     *  Аніме Світ / Anime World + Donghua v.1.12.0
     *  Побудовано на базі архітектури dorama.js
     *
     *  Додає в меню пункт "Аніме Світ"
     *  Має категорії:
     *    Новинки аніме
     *    Популярні аніме
     *    Повнометражні аніме-фільми
     *    Дунхуа-фільми
     *    Нові китайські дунхуа
     *    Популярні китайські дунхуа
     *    Світ культивації (Xianxia)
     *    Бойові мистецтва (Wuxia)
     *    та інші категорії (доповнюється)
     *
     *  Дані бере з бази TMDB: with_genres=16, with_keywords=210024
     *  Для дунхуа: with_original_language='zh'
     *
     *  Оновлення:
     *    - Додано кнопку фільтра (країни, жанри, ключові слова, рік) та сортування (популяні на початку, рейтинг від високого, нові/старі на початку)
     *    - Безпечне кешування: ключ ID + Type (напр. 123_tv) запобігає колізіям із фільмами.
     *    - Мапінг через MAL ID (Shikimori-резолвер) + Hikka UA (CORS-ready).
     *    - Паралельне збагачення (mapWithLimit 8) для максимальної швидкості.
     *    - Очищення подвійних слешів у посиланнях зображень.
     *    - Налаштування вимкнення.увімкнення пошуку назв RU/EN при відсутності українських.
     *    - Збереження назв в кеші для оптимізації запитів.
     *    - Налаштування порядку та видимості категорій.
     *    - Каскадне завантаження назв та описів: TMDB (UK) -> Shikimori (RU) -> AniList (EN).
     *    - Глибока очистка тексту від Unicode-послідовностей, HTML-тегів та BB-кодів.
     *    - Суворе порівняння року випуску при пошуку в зовнішніх базах.
     *    - Рефакторинг: перехід на Lampa.Api.sources.
     *  v1.9.1:
     *    - (Видалено в v1.10.8) Мультиформатний кеш: зберігає uk/ru/en назви одночасно, applyBestTitle обирає за поточними налаштуваннями.
     *    - Прогресивне збагачення: картки рендеряться одразу, назви оновлюються в міру надходження.
     *    - Виправлено пошук UK назв при ru_enabled=false (видалено ранній вихід з fetchShikimori).
     *    - Shikimori: при ru_enabled=false пропускається другий запит (деталі), потрібний лише для RU опису.
     *    - Shikimori: адаптивна черга з паузою всієї черги при 429 (Retry-After), перенесення в кінець до 5 разів.
     *  v1.10.0:
     *    - Глобальна заміна назв: нове налаштування "Заміна назв скрізь" (вимкнено за замовчуванням).
     *    - При увімкненні замінює назви аніме/дунхуа (ja/zh) на всіх екранах: вибране, пошук, головна.
     *    - MutationObserver відстежує нові картки при гортанні (infinite scroll) в межах активності.
     *    - Флаг _enrichRunning запобігає паралельним запускам; dataset.awEnriched маркує оброблені картки.
     *  v1.10.1-v1.10.5:
     *    - Незначні покращення.
     *  v1.10.6:
     *   - виправлено стилі, щоб не перетиналися з іншими розширеннями
     *  v1.10.7:
     *   - дрібні правки
     *  v1.10.8:
     *    - Кеш зберігає лише одну (найкращу за пріоритетом uk/ru/en) назву та опис на запис, щоб не перевищувати квоту localStorage.
     *  v1.11.0:
     *    - Мапінг TMDB -> MAL ID з окремою точкою заміни (fetchMalId) на майбутнє.
     *    - Shikimori: порівняння року враховує і aired_on/released_on (те саме для AniList: startDate/endDate).
     *    - CORS-проксі для Hikka: налаштування "Свій CORS-проксі" або автоматичний фолбек через список публічних проксі.
     *    - Кеш: модель "expires" замість timestamp; зберігається mal_id (безстроково, не залежить від TTL назви/опису);
     *      невдачі з непідтвердженою причиною (429, мережа, похибка пошуку) отримують короткий TTL для швидкого повторного пошуку;
     *      прострочені записи без mal_id видаляються повністю, з mal_id — обрізаються до самого ID.
     *    - Hikka: опис (synopsis) підвантажується окремим запитом і очищується від
     *      markdown-посилань/переносів рядків для коректного показу;
     *    - Виправлено показ українських назви/опису на повній картці тайтулу.
     *    - Виправлено застосування дефолтних значень перемикачів (RU/EN/"скрізь").
     *  v1.11.1:
     *    - Нові категорії "Зараз виходять" (with_status=0) та "Випущене" (with_status=3).
     *    - Ряд "Продовжити перегляд" на головному екрані: локально з історії перегляду
     *      (Favorite), без звернень до мережі.
     *  v1.11.2:
     *    - Нова категорія "Дунхуа-фільми" (with_original_language=zh, with_genres=16) -
     *      "Повнометражні аніме-фільми" вимагає keyword=210024 ("Anime"), яким
     *      китайські дунхуа-фільми на TMDB зазвичай не позначені, тож раніше сюди
     *      не потрапляли.
     *  v1.11.3:
     *    - Ряд "Продовжити перегляд" тепер фільтрує за жанром 16 (Animation) замість
     *      мови — раніше мовний фільтр (ja/zh) не відрізняв аніме від дорами тими
     *      самими мовами, і дорама потрапляла в цей ряд. Потребує genre_ids на картці
     *      (плагін favorite-fix) — без нього картка просто не показується
     *      в ряду.
     *  v1.11.4:
     *    - "Продовжити перегляд" більше не показує наздогнані серіали (усі випущені
     *      серії переглянуто) — рахуємо відсоток останнього релевантного епізоду
     *      через Lampa.Timeline.watchedEpisode, поріг 90% як у рідній стрічці Lampa.
     *      Покриває і завершені серіали (немає next_episode_to_air), яких рідна
     *      логіка клієнта не враховує.
     *  v1.11.5:
     *    - Виправлено: заміна назв тепер працює і на картках календаря ("Нещодавні
     *      виходи епізодів", "Найближчі виходи епізодів") — патч EpisodeMap.Card.onCreate
     *      через Lampa.Maker.map('Episode') та сканування .card-episode.
     *  v1.12.0:
     *    - Jikan замінено на AniList (GraphQL) для EN-назви/опису: api.jikan.moe став
     *      недоступним (сайт відкривається, API висить до таймауту й гальмує чергу).
     *    - fetchMalId тепер працює через AniList (idMal), Shikimori лишається резервом.
     *    - AniList: таймаут 8 с, інтервал 2.2 с між запитами (ліміт 30/хв), пауза 60 с при 429 та
     *      статусі 0 (вичерпаний ліміт видно як CORS-помилку), вимкнення на 30 хв при 5xx;
     *      fetchMalId пропускає AniList, якщо в черзі вже ≥5 запитів.
     *    - Пошук RU-назв/описів (Shikimori) за замовчуванням вимкнено (anime_world_fallback_ru: false);
     *      у вже збереженому налаштуванні значення не змінюється.
     */

    // Поліфіл для ES5-пристроїв (старі Smart TV без ES6)
    if (!Array.prototype.find) {
        Array.prototype.find = function(predicate) {
            if (this == null) throw new TypeError('Array.prototype.find called on null or undefined');
            if (typeof predicate !== 'function') throw new TypeError('predicate must be a function');
            var list = Object(this);
            var length = list.length >>> 0;
            var thisArg = arguments[1];
            var value;
            for (var i = 0; i < length; i++) {
                value = list[i];
                if (predicate.call(thisArg, value, i, list)) return value;
            }
            return undefined;
        };
    }

    // Список публічних CORS-проксі як запасних варіантів (коли в налаштуваннях не вказано свій).
    // Порядок у масиві — це порядок спроб. Щоб прибрати проксі (наприклад, якщо він почав
    // обмежувати кількість запитів) — просто видаліть або закоментуйте відповідний рядок.
    // Формат рядка: якщо закінчується на "=" — ціль додається закодованою (query-стиль),
    // інакше — як є (шлях-стиль). Те саме правило, що й для поля "Свій CORS-проксі" в налаштуваннях.
    // Відсоток перегляду останнього епізоду, з якого серіал вважається наздогнаним
    // і зникає з "Продовжити перегляд". Те саме значення, що в рідній стрічці Lampa
    // (app.min.js, ContinueWatch: ongoing.filter(c => c.viewed >= 90)).
    var CAUGHT_UP_PERCENT = 90;

    var PUBLIC_CORS_PROXIES = [
        'https://proxy.corsfix.com/?',
        'https://cors.io/?url=',
        'https://proxy.cors.sh/'
    ];

    // Додає цільовий URL до префікса проксі за правилом query-стиль ("=" в кінці) / шлях-стиль
    function applyProxyPrefix(prefix, targetUrl) {
        return /=$/.test(prefix) ? prefix + encodeURIComponent(targetUrl) : prefix + targetUrl;
    }

    // Скільки тримати в кеші результат, коли пошук UK не вдався через тимчасову помилку
    // (напр. 429 від Shikimori чи мережевий збій), а не через підтверджену відсутність перекладу.
    // Значно менше за звичайний TTL, щоб найближчим часом сталася повторна спроба.
    var SOFT_FAIL_CACHE_MS = 15 * 60 * 1000; // 15 хвилин

    // Дефолти trigger-налаштувань, які явно пишуться в Storage при першому старті (ensureSettingDefaults),
    // бо Lampa.SettingsApi.addParam({type:'trigger', default:...}) сам по собі в Storage нічого не пише.
    var DEFAULT_SETTINGS = {
        anime_world_fallback_ru: false,
        anime_world_fallback_en: true,
        anime_world_global_titles: false
    };

    var ANIME_CONFIG = {
        'anime_world': {
            title: 'Аніме Світ',
            icon: '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><path fill="currentColor" fill-rule="evenodd" d="m368.256 214.573l-102.627 187.35c40.554 71.844 73.647 97.07 138.664 94.503c63.67-2.514 136.974-89.127 95.694-163.243L397.205 150.94c-3.676 12.266-25.16 55.748-28.95 63.634M216.393 440.625C104.077 583.676-57.957 425.793 20.85 302.892c0 0 83.895-147.024 116.521-204.303c25.3-44.418 53.644-72.37 90.497-81.33c44.94-10.926 97.565 12.834 125.62 56.167c19.497 30.113 36.752 57.676 6.343 109.738c-3.613 6.184-143.438 257.46-143.438 257.46m8.014-264.595c-30.696-17.696-30.696-62.177 0-79.873s69.273 4.544 69.273 39.936s-38.578 57.633-69.273 39.937" clip-rule="evenodd"/></svg>',
            categories: [
                {
                    "id": "anime_new",
                    "title": "Новинки аніме",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "210024",
                        "sort_by": "first_air_date.desc",
                        "first_air_date.lte": "{current_date}",
                        "vote_count.gte": "1"
                    }
                },
                {
                    "id": "anime_pop",
                    "title": "Популярні аніме",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "210024",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "anime_movie",
                    "title": "Повнометражні аніме-фільми",
                    "url": "discover/movie",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "210024",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "donghua_movie",
                    "title": "Дунхуа-фільми",
                    "url": "discover/movie",
                    "params": {
                        "with_original_language": "zh",
                        "with_genres": "16",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "donghua_new",
                    "title": "Нові китайські дунхуа",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "zh",
                        "with_genres": "16",
                        "sort_by": "first_air_date.desc",
                        "first_air_date.lte": "{current_date}",
                        "vote_count.gte": "5"
                    }
                },
                {
                    "id": "donghua_pop",
                    "title": "Популярні китайські дунхуа",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "zh",
                        "with_genres": "16",
                        "sort_by": "popularity.desc",
                        "vote_count.gte": "10"
                    }
                },
                {
                    "id": "anime_ongoing",
                    "title": "Зараз виходять",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "210024",
                        "with_status": "0", // Returning Series — серіал ще виходить
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "anime_released",
                    "title": "Випущене",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "210024",
                        "with_status": "3", // Ended — серіал повністю вийшов
                        "sort_by": "popularity.desc"
                    }
                },
                // додаткові категорії
                {
                    "id": "anime_best",
                    "title": "🏆 Аніме-шедеври (Топ)",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "210024",
                        "vote_count.gte": 200,
                        "sort_by": "vote_average.desc"
                    }
                },
                {
                    "id": "anime_isekai",
                    "title": "Світи Ісекай",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "237451|291482", // Isekai OR Reverse Isekai
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "anime_space",
                    "title": "Космічне аніме",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "9882|195114|4270|252634", // Space OR Space Adventure OR Galaxy OR Outer Space
                        "without_keywords": "290589,197692,18257,370043,155644", // Виключення (AND NOT), відсіє все дитяче та суто західне
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "anime_fantasy",
                    "title": "Фентезі",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "210024,293198", // Anime + Fantasy
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "anime_scifi",
                    "title": "Фантастика Sci-Fi",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "210024,281358", // Anime + Sci-Fi
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "anime_romance",
                    "title": "Романтика",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "9840|9673", // Romance OR Love
                        "without_keywords": "290589,197692,18257,370043,155644", // Без дитячого та західного
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "anime_slice_of_life",
                    "title": "Повсякденність та шкільне життя",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "9914|190116|353147", // Slice of Life OR School OR Everyday
                        "without_keywords": "290589,197692,18257,370043,155644", // Без дитячого та західного
                        "sort_by": "popularity.desc"
                    }
                },
                // для дорослих
                {
                    "id": "anime_ecchi",
                    "title": "Еччі (16+)",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "195669", // Ecchi
                        "include_adult": "true",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "anime_seinen", // Серйозне аніме для дорослої чоловічої аудиторії (психологія, драма, бойовики).
                    "title": "Сейнен (18+)",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "195668", // Seinen
                        "include_adult": "true",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "anime_hentai",
                    "title": "Хентай (18+)",
                    "url": "discover/tv",
                    "params": {
                        "with_genres": "16",
                        "with_keywords": "198385", // Hentai
                        "include_adult": "true",
                        "sort_by": "popularity.desc"
                    }
                },
                // Додаткові розділи дунхуа
                {
                    "id": "donghua_xianxia",
                    "title": "Світ культивації (Xianxia)",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "zh",
                        "with_genres": "16",
                        "with_keywords": "234890",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "donghua_wuxia",
                    "title": "Бойові мистецтва (Wuxia)",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "zh",
                        "with_genres": "16",
                        "with_keywords": "184656",
                        "sort_by": "popularity.desc"
                    }
                }
            ]
        }
    };

    var ANIME_FILTER_LANGUAGES = [
        { id: 'ja', title: 'Японія' },
        { id: 'zh', title: 'Китай' }
    ];

    // Жанр "Анімація" (16) завжди присутній в URL, тут лише додаткові
    var ANIME_FILTER_GENRES = [
        { id: '35',    title: 'Комедія' },
        { id: '18',    title: 'Драма' },
        { id: '10759', title: 'Екшн та пригоди' },
        { id: '10765', title: 'Фентезі та фантастика' },
        { id: '9648',  title: 'Детектив' },
        { id: '10751', title: 'Сімейний' }
    ];

    var ANIME_FILTER_KEYWORDS = [
        { id: '9840|9673',                      title: 'Романтика' },
        { id: '237451|291482',                  title: 'Ісекай' },
        { id: '190116|9914|353147',             title: 'Школа / Повсякденність' },
        { id: '3998|184656|1462|10278',         title: 'Бойові мистецтва' },
        { id: '234890',                         title: 'Xianxia (Культивація)' },
        { id: '5484|194421|12320|357276',       title: 'Реінкарнація' },
        { id: '4379|10854',                     title: 'Подорож у часі' },
        { id: '162846|6152|15001|14999|294131', title: 'Надприродне' },
        { id: '12565|10714',                    title: 'Психологічне' },
        { id: '9748',                           title: 'Помста' },
        { id: '9882|14626|195114|4270|252634',  title: 'Космос' },
        { id: '33465|243230',                   title: 'Паралельний світ' },
        { id: '10046|10891|11272',              title: 'Меха' },
        { id: '34137|364081|18129',             title: 'Dungeon/Підземелля' },
        { id: '10349|12332|359337',             title: 'Виживання' },
        { id: '6075|12380',                     title: 'Спорт' },
        { id: '287664|283297|311916',           title: 'Ідол / Музика' },
        { id: '18249|4563|173374',              title: 'Ігровий світ' },
        { id: '3133|357106',                    title: 'Вампіри' },
        { id: '12988|375003',                   title: 'Пірати' },
        { id: '9194',                           title: 'Гарем' },
        { id: '195669',                         title: 'Еччі' }
    ];

    var ANIME_FILTER_SORTS = [
        { id: 'popularity.desc',     title: 'Популярні',         voteCount: 50  },
        { id: 'vote_average.desc',   title: 'Рейтинг ↓',        voteCount: 150 },
        { id: 'first_air_date.desc', title: 'Нові спочатку',    voteCount: 3   },
        { id: 'first_air_date.asc',  title: 'Старіші спочатку', voteCount: 5   }
    ];

    // AniList: таймаут запиту та строк вимкнення джерела після збою мережі/5xx
    var ANILIST_TIMEOUT = 8000;
    var ANILIST_DOWN_TTL = 30 * 60 * 1000;
    // Ліміт AniList зараз 30 запитів/хв (x-ratelimit-limit); після його вичерпання відповідь приходить
    // БЕЗ CORS-заголовків — браузер показує це як CORS-помилку зі статусом 0, а не як 429.
    // Тому темп тримаємо проактивно (~27 запитів/хв), а статус 0 трактуємо як вичерпаний ліміт.
    var ANILIST_MIN_INTERVAL = 2200;
    var ANILIST_LIMIT_PAUSE = 60 * 1000;
    // Якщо в черзі AniList уже стільки запитів, fetchMalId його пропускає (резолвить Shikimori)
    var ANILIST_MAX_BACKLOG = 5;

    // Черга з послідовною обробкою (одна задача одночасно), паузою при 429 (pause) та опційним
    // мінімальним інтервалом між стартами задач (проактивний захист від жорстких лімітів
    // на кшталт 3 запити/сек — коли mapWithLimit шле по 8 паралельних enrichItem, без цього перший же
    // "залп" одразу впирається в ліміт).
    function createRateLimitedQueue(minInterval) {
        var queue = [];
        var processing = false;
        var pausedUntil = 0;
        var lastStart = 0;

        function process() {
            if (processing || !queue.length) return;
            var now = Date.now();
            var wait = Math.max(pausedUntil - now, lastStart + (minInterval || 0) - now);
            if (wait > 0) { setTimeout(process, wait); return; }
            processing = true;
            lastStart = Date.now();
            var task = queue.shift();
            task(function () {
                processing = false;
                process();
            });
        }

        return {
            enqueue: function (task) { queue.push(task); process(); },
            pause: function (ms) { pausedUntil = Date.now() + ms; },
            size: function () { return queue.length; }
        };
    }

    /**
     * Помічник для збагачення даних (Каскад назв та описів)
     */
    var AnimeWorldHelper = {
        shikimoriQueue: createRateLimitedQueue(0),
        // Без штучної затримки: лише послідовна обробка + реактивна пауза при реальному 429
        // (як і в Shikimori) — фіксований інтервал на кожен елемент занадто сповільнював масове
        // збагачення списку (20-30 карток = вже 7-10+ секунд лише на очікування)
        anilistQueue: createRateLimitedQueue(ANILIST_MIN_INTERVAL),
        anilistMemo: {},
        anilistDownUntil: 0,

        extractId: function(id) {
            if (!id) return null;
            var match = String(id).match(/(\d+)/);
            return match ? match[1] : null;
        },

        getMediaType: function(item) {
            if (item.media_type) return item.media_type;
            if (item.first_air_date || item.name || item.number_of_seasons) return 'tv';
            return 'movie';
        },

        // Отримання та ініціалізація налаштувань категорій
        getCategorySettings: function() {
            var categories = ANIME_CONFIG.anime_world.categories;
            var saved = Lampa.Storage.get('anime_categories_state', []);
            
            // Якщо пусто - створюємо дефолтний стан
            if (!saved.length) {
                saved = categories.map(function(c) { return { id: c.id, visible: true }; });
            }
            
            // Синхронізація: додаємо нові, видаляємо ті яких вже нема в конфигу
            var result = [];
            saved.forEach(function(s) {
                if (categories.find(function(c) { return c.id === s.id; })) {
                    result.push(s);
                }
            });
            categories.forEach(function(c) {
                if (!result.find(function(r) { return r.id === c.id; })) {
                    result.push({ id: c.id, visible: true });
                }
            });
            
            return result;
        },

        // Фільтрація та сортування категорій згідно налаштувань
        getEnabledCategories: function() {
            var settings = this.getCategorySettings();
            var categories = ANIME_CONFIG.anime_world.categories;
            
            var result = [];
            settings.forEach(function(s) {
                if (s.visible) {
                    var cat = categories.find(function(c) { return c.id === s.id; });
                    if (cat) result.push(cat);
                }
            });
            
            return result;
        },

        // Жанр 16 (Animation) у TMDB — надійніший сигнал за мову: дорама тими самими
        // мовами (ja/zh), що й аніме, жанру 16 не має. genre_ids на картці зберігається
        // плагіном favorite-fix (сам по собі clearCard() губить це поле при
        // Favorite.add() — див. animeworld/continue-watching-genre-problem.md). Свідомо
        // без відкату на мовну евристику: картка без genre_ids просто не показується в
        // цьому ряду, доки не встановлено favorite-fix (і за потреби не
        // запущено його міграцію для старих карток).
        isAnimeByGenre: function (item) {
            return Array.isArray(item.genre_ids) && item.genre_ids.indexOf(16) !== -1;
        },

        // Відсоток перегляду останнього релевантного епізоду серіалу — щоб прибрати
        // з "Продовжити перегляд" те, що вже наздогнано (усі випущені серії
        // переглянуто). Рідна стрічка Lampa рахує це сама (ContinueWatch у
        // app.min.js: ongoing -> caught_up при viewed >= 90), але наш ряд будується
        // власним кодом із Favorite, тож ту саму логіку треба повторити тут.
        // Варіант розширений — рідний покриває лише онгоїнги з
        // next_episode_to_air.episode_number > 1, а нам потрібні ще й завершені:
        //
        //   next є, episode_number > 1  -> попередній епізод поточного сезону
        //   next є, episode_number == 1 -> last_episode_to_air (фінал минулого сезону)
        //   next немає, last є          -> last_episode_to_air (завершений серіал)
        //   немає обох                  -> 0 (нема чим міряти, показуємо)
        //
        // last_episode_to_air на картці зберігається плагіном favorite-fix; без
        // нього метод поверне 0 і поведінка буде як раніше.
        watchedLastEpisodePercent: function (item) {
            if (!Lampa.Timeline || !Lampa.Timeline.watchedEpisode) return 0;

            var next = item.next_episode_to_air;
            var last = item.last_episode_to_air;

            if (next) {
                if (next.episode_number > 1) return Lampa.Timeline.watchedEpisode(item, next.season_number, next.episode_number - 1);
                if (last) return Lampa.Timeline.watchedEpisode(item, last.season_number, last.episode_number);
                return 0;
            }

            if (last) return Lampa.Timeline.watchedEpisode(item, last.season_number, last.episode_number);

            return 0;
        },

        // Ряд "Продовжити перегляд": локально, без мережі — з історії перегляду (Favorite),
        // відфільтрованої до аніме/дунхуа за жанром 16 (Animation), без вже переглянутого
        // (viewed), закинутого (thrown) і наздогнаного (усі випущені серії переглянуто).
        buildContinueWatchingRow: function () {
            var history = Lampa.Favorite.get({ type: 'history' }) || [];
            if (!history.length) return null;

            var viewed = Lampa.Favorite.get({ type: 'viewed' }) || [];
            var thrown = Lampa.Favorite.get({ type: 'thrown' }) || [];

            var results = history.filter(function (item) {
                if (!AnimeWorldHelper.isAnimeByGenre(item)) return false;
                var isViewed = viewed.some(function (v) { return v.id == item.id; });
                var isThrown = thrown.some(function (t) { return t.id == item.id; });
                if (isViewed || isThrown) return false;
                // той самий поріг, що й у рідній стрічці Lampa
                return AnimeWorldHelper.watchedLastEpisodePercent(item) < CAUGHT_UP_PERCENT;
            }).slice(0, 20);

            if (!results.length) return null;

            return { results: results, title: 'Продовжити перегляд', nomore: true, url: 'anime_world:continue_watch' };
        },

        isLocalized: function (text) {
            if (!text) return false;
            return /[а-яА-ЯіїєґІЇЄҐ]/.test(text);
        },

        // Перевірка на наявність ієрогліфів (CJK: Chinese, Japanese, Korean)
        isCJK: function (text) {
            return /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u309F\u30A0-\u30FF]/.test(text || '');
        },

        // Пошук всіх доступних перекладів у TMDB (UK, RU, EN)
        fetchTMDBTranslations: function (item, callback) {
            var type = this.getMediaType(item);
            var url = Lampa.TMDB.api(type + '/' + item.id + '/translations?api_key=' + Lampa.TMDB.key());
            var network = new Lampa.Reguest();
            
            network.silent(url, function (data) {
                var tr = data.translations || [];
                var res = {};
                
                var uk = tr.find(function (x) { return x.iso_639_1 === 'uk' || x.iso_3166_1 === 'UA'; });
                var ru = tr.find(function (x) { return x.iso_639_1 === 'ru' || x.iso_3166_1 === 'RU'; });
                var en = tr.find(function (x) { return x.iso_639_1 === 'en' || x.iso_3166_1 === 'US'; });

                if (uk && (uk.data.title || uk.data.name)) res.uk = { title: uk.data.title || uk.data.name, overview: uk.data.overview };
                if (ru && (ru.data.title || ru.data.name)) res.ru = { title: ru.data.title || ru.data.name, overview: ru.data.overview };
                if (en && (en.data.title || en.data.name)) res.en = { title: en.data.title || en.data.name, overview: en.data.overview };
                
                callback(res);
            }, function () { callback({}); });
        },

        // Формує список кандидатів проксі-URL для обходу CORS, у порядку спроб:
        // 1. Свій проксі з налаштувань, якщо вказано — єдина спроба, бо це варіант під контролем користувача.
        //    Приклади значення поля:
        //      https://192.168.0.10:9118/corseu/mytoken/   (Corseu lampac, шлях, токен вже в URL)
        //      https://mycors-proxy.com?url=                (звичайний CORS-проксі, query-параметр)
        //    Якщо рядок закінчується на "=" — цільовий URL додається закодованим (query-стиль),
        //    інакше — як є (шлях-стиль).
        // 2. Lampa.Utils.proxy (якщо колись з'явиться в клієнті).
        // 3+. Публічні проксі зі списку PUBLIC_CORS_PROXIES (на початку файлу) по черзі.
        buildProxyUrls: function (targetUrl) {
            var customProxy = (Lampa.Storage.get('anime_world_custom_proxy', '') || '').trim();

            if (customProxy) {
                return [applyProxyPrefix(customProxy, targetUrl)];
            }

            var urls = [];
            if (typeof Lampa.Utils !== 'undefined' && typeof Lampa.Utils.proxy === 'function') {
                urls.push(Lampa.Utils.proxy(targetUrl));
            }
            PUBLIC_CORS_PROXIES.forEach(function (prefix) {
                urls.push(applyProxyPrefix(prefix, targetUrl));
            });
            return urls;
        },

        // Виконує запит послідовно через кандидатів buildProxyUrls, переходячи до наступного при помилці/відсутності відповіді
        fetchViaProxy: function (targetUrl, callback) {
            var urls = this.buildProxyUrls(targetUrl);
            var i = 0;

            function tryNext() {
                if (i >= urls.length) return callback(null);
                var url = urls[i++];
                var network = new Lampa.Reguest();
                network.silent(url, function (res) {
                    var json = res;
                    if (res && typeof res.body === 'string') {
                        try { json = JSON.parse(res.body); } catch (e) { json = null; }
                    }
                    if (json) callback(json);
                    else tryNext();
                }, function () { tryNext(); });
            }
            tryNext();
        },

        // MAL ID через AniList (поле idMal у видачі пошуку за назвою+роком, другий запит не потрібен).
        // Раніше була заглушка (v1.10.27: пробний Jikan-first не пришвидшив холодний прохід по каталогу).
        // Якщо AniList нічого не дав — continueEnrich користується Shikimori як резервним резолвером.
        fetchMalId: function (item, callback) {
            var year = this.getYear(item.first_air_date || item.release_date);
            // Черга AniList забита (ліміт 30 запитів/хв) — не чекаємо, MAL ID знайде Shikimori
            if (this.anilistQueue.size() >= ANILIST_MAX_BACKLOG) return callback(null);
            this.searchAniList(item, year, function (match) {
                callback(match && match.idMal ? match.idMal : null);
            });
        },

        // Прямий запит до Hikka за MAL ID. /integrations/mal/anime/{id} не містить synopsis_ua/en
        // (лише назви), тому за наявності slug робимо другий запит до /anime/{slug} за описом.
        fetchHikkaMetadata: function (mal_id, callback) {
            var _this = this;
            if (!mal_id) return callback(null);

            this.fetchViaProxy('https://api.hikka.io/integrations/mal/anime/' + mal_id, function (json) {
                if (!json || (!json.title_ua && !json.title_en)) return callback(null);

                var result = {
                    title: json.title_ua || json.title_en,
                    overview: '',
                    has_ua: !!json.title_ua
                };

                if (!json.slug) return callback(result);

                _this.fetchViaProxy('https://api.hikka.io/anime/' + json.slug, function (info) {
                    if (info) result.overview = _this.cleanHikkaDescription(info.synopsis_ua || info.synopsis_en || '');
                    callback(result);
                });
            });
        },

        // Прибирає markdown-посилання Hikka ([текст](url) -> текст) та переводить \n\n у <br><br>,
        // бо шаблон опису в Lampa вставляє текст як HTML і не зберігає переноси рядків самостійно
        cleanHikkaDescription: function (text) {
            if (!text) return '';
            return text
                .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1')
                .replace(/\u200B/g, '')
                .replace(/\n\n+/g, '\n\n')
                .trim()
                .replace(/\n\n/g, '<br><br>')
                .replace(/\n/g, '<br>');
        },

        cleanDescription: function (text) {
            if (!text) return '';
            var decoded = text.replace(/\\u([0-9a-fA-F]{4})/g, function (match, grp) { return String.fromCharCode(parseInt(grp, 16)); });
            return decoded
                .replace(/<\/?[^>]+(>|$)/g, "")
                .replace(/\[\/?(?:b|i|u|s|url|img|code|quote|spoiler|center|right|left|color|size|list|item|\*|hr|video|youtube|twitch|character|person|anime|manga|entry|comment|topic|user|style|character_id|person_id|anime_id|manga_id|rel)[^\]]*\]/gi, '')
                .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
                .replace(/\n\n+/g, '\n\n').trim();
        },

        getYear: function (dateStr) { return dateStr ? dateStr.split('-')[0] : ''; },

        fetchShikimori: function (item, year, callback) {
            var _this = this;

            var ru_enabled = Lampa.Storage.get('anime_world_fallback_ru', DEFAULT_SETTINGS.anime_world_fallback_ru);
            var searchTitle = item.original_name || item.original_title || item.name || item.title;
            // Використовуємо shikimori.io напряму: shikimori.one віддає 301 на .io БЕЗ CORS-заголовків
            // на самій відповіді редиректу, тож браузер блокує запит ще до переходу на .io
            var searchUrl = 'https://shikimori.io/api/animes?search=' + encodeURIComponent(searchTitle) + '&limit=5';

            function enqueueShiki(requeues) {
                _this.shikimoriQueue.enqueue(function(done) {
                    var network = new Lampa.Reguest();
                    network.silent(searchUrl, function(found) {
                        if (!found) { callback(null); done(); return; }
                        // TMDB.first_air_date іноді збігається з released_on (кінець виходу), а не
                        // з aired_on (початок показу в Японії) — напр. коли аніме вийшло в грудні,
                        // а TMDB веде відлік від наступного січня. Перевіряємо обидві дати.
                        var match = Array.isArray(found) && found.find(function(f) {
                            var airedYear = _this.getYear(f.aired_on);
                            var releasedYear = _this.getYear(f.released_on);
                            return (airedYear && year && parseInt(airedYear) === parseInt(year)) ||
                                   (releasedYear && year && parseInt(releasedYear) === parseInt(year));
                        });
                        if (!match) { callback(null); done(); return; }
                        // Деталі потрібні завжди: лише там Shikimori віддає справжній myanimelist_id
                        // (match.id — це внутрішній ID Shikimori, який не завжди збігається з MAL ID)
                        var network2 = new Lampa.Reguest();
                        network2.silent('https://shikimori.io/api/animes/' + match.id, function(details) {
                            var realMalId = details && details.myanimelist_id ? details.myanimelist_id : null;
                            callback({
                                title: ru_enabled ? (match.russian || match.name) : null,
                                overview: ru_enabled && details ? _this.cleanDescription(details.description) : '',
                                mal_id: realMalId
                            });
                            done();
                        }, function() {
                            // Мережевий збій на запиті деталей — не підтверджена відсутність, а тимчасова невдача
                            callback({ title: ru_enabled ? (match.russian || match.name) : null, overview: '', mal_id: null, soft_fail: true });
                            done();
                        });
                    }, function(jqXHR) {
                        var status = jqXHR ? jqXHR.status : 0;
                        if (status === 429) {
                            var retryAfter = jqXHR && jqXHR.getResponseHeader ? jqXHR.getResponseHeader('Retry-After') : '3';
                            var wait = parseInt(retryAfter || '3') * 1000;
                            _this.shikimoriQueue.pause(wait);
                            if (requeues > 0) enqueueShiki(requeues - 1);
                            else callback({ title: null, overview: '', mal_id: null, soft_fail: true });
                        } else {
                            // Мережевий збій на пошуковому запиті — теж тимчасова невдача, а не підтверджена відсутність
                            callback({ title: null, overview: '', mal_id: null, soft_fail: true });
                        }
                        done();
                    });
                });
            }
            enqueueShiki(5);
        },

        // Спільний пошук в AniList (GraphQL) за назвою+роком — використовується і для mal_id (fetchMalId,
        // поле idMal прямо у видачі), і для EN-назви/опису (fetchAniList). Рік перевіряємо так само, як
        // у Shikimori: startDate (початок показу) і endDate (кінець) можуть припадати на різні роки.
        // Замінив Jikan (api.jikan.moe лежав при робочому jikan.moe, запити висіли до таймауту).
        // Черга (anilistQueue) з паузою при 429 (ліміт ~90 запитів/хв); після збою мережі/5xx джерело
        // вимикається на ANILIST_DOWN_TTL, щоб не гальмувати збагачення списків. Результат пошуку
        // кешується в пам'яті сесії, щоб fetchMalId і fetchAniList не слали однаковий запит двічі.
        searchAniList: function (item, year, callback) {
            var _this = this;
            var searchTitle = item.original_name || item.original_title || item.name || item.title;
            if (!searchTitle) return callback(null);

            var memoKey = searchTitle + '|' + year;
            if (this.anilistMemo.hasOwnProperty(memoKey)) return callback(this.anilistMemo[memoKey]);
            if (Date.now() < this.anilistDownUntil) return callback(null);

            var gql = 'query($s:String){Page(perPage:10){media(search:$s,type:ANIME){' +
                'idMal startDate{year} endDate{year} title{romaji english} description(asHtml:false)}}}';
            var body = JSON.stringify({ query: gql, variables: { s: searchTitle } });

            function attempt(requeues) {
                _this.anilistQueue.enqueue(function (done) {
                    var network = new Lampa.Reguest();
                    network.silent('https://graphql.anilist.co', function (res) {
                        var list = res && res.data && res.data.Page && res.data.Page.media;
                        var match = null;
                        if (list && list.length) {
                            match = list.find(function (f) {
                                var fromYear = f.startDate && f.startDate.year;
                                var toYear = f.endDate && f.endDate.year;
                                return (fromYear && year && parseInt(fromYear) === parseInt(year)) ||
                                       (toYear && year && parseInt(toYear) === parseInt(year));
                            }) || null;
                        }
                        _this.anilistMemo[memoKey] = match;
                        callback(match);
                        done();
                    }, function (jqXHR) {
                        var status = jqXHR ? jqXHR.status : 0;
                        if (status === 429) {
                            var retryAfter = jqXHR && jqXHR.getResponseHeader ? jqXHR.getResponseHeader('Retry-After') : '2';
                            _this.anilistQueue.pause(parseInt(retryAfter || '2') * 1000);
                            if (requeues > 0) attempt(requeues - 1);
                            else callback(null);
                        } else {
                            // Не кешуємо як "немає даних". Статус 0 — найімовірніше вичерпаний ліміт
                            // (відповідь без CORS-заголовків) або мережа: пауза на хвилину замість вимкнення.
                            // 5xx — вимикаємо джерело на ANILIST_DOWN_TTL.
                            if (status === 0) _this.anilistQueue.pause(ANILIST_LIMIT_PAUSE);
                            else if (status >= 500) _this.anilistDownUntil = Date.now() + ANILIST_DOWN_TTL;
                            callback(null);
                        }
                        done();
                    }, body, { headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, timeout: ANILIST_TIMEOUT });
                });
            }
            attempt(5);
        },

        fetchAniList: function (item, year, callback) {
            var _this = this;
            this.searchAniList(item, year, function (match) {
                if (match) callback({ title: (match.title && (match.title.english || match.title.romaji)) || '', overview: _this.cleanDescription(match.description) });
                else callback(null);
            });
        },

        getCache: function () { return Lampa.Storage.get('anime_world_cache', {}); },

        // TMDB ID -> MAL ID зберігається в тому самому записі кешу (поле mal_id), без власного TTL —
        // на відміну від назви/опису цей зв'язок практично не змінюється з часом. Тому запис не
        // видаляється цілком по закінченню expires, якщо в ньому є mal_id (див. чистку в setCache) —
        // лише назва/опис вважаються застарілими, а mal_id продовжує використовуватись.
        getCachedMalId: function (id, type) {
            var entry = this.getCache()[id + '_' + type];
            return entry && entry.mal_id ? entry.mal_id : null;
        },

        // Обирає найкращу назву/опис із зібраних варіантів за поточними налаштуваннями
        pickBestTitle: function (titles) {
            var ru_enabled = Lampa.Storage.get('anime_world_fallback_ru', DEFAULT_SETTINGS.anime_world_fallback_ru);
            var en_enabled = Lampa.Storage.get('anime_world_fallback_en', DEFAULT_SETTINGS.anime_world_fallback_en);

            if (titles.uk)                    return { title: titles.uk, overview: titles.uk_ov || '' };
            if (ru_enabled && titles.ru)      return { title: titles.ru, overview: titles.ru_ov || '' };
            if (en_enabled && titles.en)      return { title: titles.en, overview: titles.en_ov || '' };
            if (titles.title)                 return { title: titles.title, overview: titles.overview || '' }; // старий формат кешу
            return null;
        },

        // Зберігає в кеші лише одну (найкращу) назву + опис
        setCache: function (id, type, titles) {
            var cache = this.getCache();
            var ttl = parseInt(Lampa.Storage.get('anime_world_cache_ttl', '24'));
            if (ttl > 0) {
                var key = id + '_' + type;
                var best = this.pickBestTitle(titles);
                if (best) {
                    // UK не знайдено через тимчасову помилку (429/мережевий збій) — кешуємо
                    // на короткий строк, щоб незабаром сталася повторна спроба, а не на весь TTL
                    var entryTtl = (titles._softFail && !titles.uk) ? SOFT_FAIL_CACHE_MS : ttl * 3600000;
                    var entry = { title: best.title, overview: best.overview, expires: Date.now() + entryTtl };
                    if (titles.mal_id) entry.mal_id = titles.mal_id;
                    cache[key] = entry;
                    var now = Date.now();
                    // Прострочені записи: без mal_id видаляються повністю, з mal_id — обрізаються
                    // до самого лише ID (застарілі назву/опис/expires сенсу тримати немає)
                    for (var k in cache) {
                        if (cache[k].expires && now > cache[k].expires) {
                            if (cache[k].mal_id) cache[k] = { mal_id: cache[k].mal_id };
                            else delete cache[k];
                        }
                    }
                    Lampa.Storage.set('anime_world_cache', cache);
                }
            }
        },

        // Застосовує назву/опис з кешованого запису
        applyBestTitle: function (item, entry) {
            var best = this.pickBestTitle(entry);
            if (!best) return;

            if (best.title) { if (item.name !== undefined) item.name = best.title; else item.title = best.title; }
            if (best.overview) item.overview = this.cleanDescription(best.overview);
        },

        enrichItem: function (item, callback) {
            var _this = this;
            var id = _this.extractId(item.id || item.tmdb_id);
            var type = _this.getMediaType(item);
            var year = _this.getYear(item.first_air_date || item.release_date);

            if (item.poster_path) item.poster_path = item.poster_path.replace(/^\/+/, '');
            if (item.backdrop_path) item.backdrop_path = item.backdrop_path.replace(/^\/+/, '');
            if (item.img) item.img = item.img.replace(/\/+/g, '/').replace(':/', '://');

            var key = id + '_' + type;
            var cached = _this.getCache()[key];
            if (cached && cached.expires && Date.now() < cached.expires) {
                _this.applyBestTitle(item, cached);
                return callback();
            }

            // Збираємо всі знайдені назви для збереження в кеші
            var collected = { uk: null, ru: null, en: null, uk_ov: null, ru_ov: null, en_ov: null };

            // 1. TMDB UA/RU/EN (один запит, всі мови одразу)
            _this.fetchTMDBTranslations(item, function (tmdbData) {
                if (tmdbData.uk) { collected.uk = tmdbData.uk.title; collected.uk_ov = tmdbData.uk.overview; }
                if (tmdbData.ru) { collected.ru = tmdbData.ru.title; collected.ru_ov = tmdbData.ru.overview; }
                if (tmdbData.en) { collected.en = tmdbData.en.title; collected.en_ov = tmdbData.en.overview; }

                var done = function () {
                    // Без mal_id не можна бути певним, що причина — підтверджена відсутність
                    // (може бути похибка пошуку за роком чи інша нерозпізнана невдача) —
                    // тому такий запис теж кешується на короткий строк (якщо UK ще не знайдено)
                    if (!collected.mal_id) collected._softFail = true;
                    _this.setCache(id, type, collected);
                    _this.applyBestTitle(item, collected);
                    callback();
                };

                // 2. TMDB ID -> MAL ID -> Hikka UA (лише якщо TMDB не дав або назву, або опис —
                // не займаємо те, що вже є, заповнюємо лише відсутнє, і економимо запит до Hikka,
                // коли TMDB уже дав обидва).
                // Якщо MAL ID вже відомий з попереднього разу — Shikimori для його пошуку не потрібен.
                function withMalId(mal_id) {
                    if (mal_id) {
                        collected.mal_id = mal_id;
                        if (!collected.uk || !collected.uk_ov) {
                            return _this.fetchHikkaMetadata(mal_id, function(hikkaData) {
                                if (hikkaData && hikkaData.has_ua) {
                                    if (!collected.uk) collected.uk = hikkaData.title;
                                    if (!collected.uk_ov && hikkaData.overview) collected.uk_ov = hikkaData.overview;
                                    return done();
                                }
                                // 3. Fallback: Інші джерела
                                _this.continueEnrich(item, year, collected, mal_id, done);
                            });
                        }
                        // TMDB-переклад уже є — Hikka не потрібна
                        return _this.continueEnrich(item, year, collected, mal_id, done);
                    }
                    // 3. Fallback: Інші джерела
                    _this.continueEnrich(item, year, collected, null, done);
                }

                var knownMalId = _this.getCachedMalId(id, type);
                if (knownMalId) withMalId(knownMalId);
                else _this.fetchMalId(item, withMalId);
            });
        },

        continueEnrich: function(item, year, collected, known_mal_id, done) {
            var _this = this;
            var ru_enabled = Lampa.Storage.get('anime_world_fallback_ru', DEFAULT_SETTINGS.anime_world_fallback_ru);
            var en_enabled = Lampa.Storage.get('anime_world_fallback_en', DEFAULT_SETTINGS.anime_world_fallback_en);

            // Shikimori потрібен коли немає UK і:
            //   - MAL ID ще не відомий (!known_mal_id): Shikimori як резервний MAL ID резолвер → другий шанс Hikka UK
            //   - або MAL ID вже відомий, але потрібна RU (ru_enabled && !collected.ru)
            // RU від Shikimori зберігається лише якщо ru_enabled
            var needShikimori = !collected.uk && (!known_mal_id || (ru_enabled && !collected.ru));
            if (needShikimori) {
                return _this.fetchShikimori(item, year, function (shikiData) {
                    if (shikiData && shikiData.soft_fail) collected._softFail = true;
                    if (shikiData) {
                        var mid = known_mal_id || shikiData.mal_id;
                        if (mid) collected.mal_id = mid;
                        // Якщо MAL ID ще не відомий, пробуємо Hikka через ID, знайдений Shikimori
                        if (!known_mal_id && mid) {
                            return _this.fetchHikkaMetadata(mid, function(hikkaData) {
                                if (hikkaData && hikkaData.has_ua) {
                                    collected.uk = hikkaData.title;
                                    if (hikkaData.overview) collected.uk_ov = hikkaData.overview;
                                }
                                if (ru_enabled && !collected.ru) {
                                    collected.ru = shikiData.title;
                                    if (shikiData.overview) collected.ru_ov = shikiData.overview;
                                }
                                _this.finalEnrich(item, year, collected, en_enabled, done);
                            });
                        }
                        if (ru_enabled && !collected.ru) {
                            collected.ru = shikiData.title;
                            if (shikiData.overview) collected.ru_ov = shikiData.overview;
                        }
                    }
                    _this.finalEnrich(item, year, collected, en_enabled, done);
                });
            }
            _this.finalEnrich(item, year, collected, en_enabled, done);
        },

        finalEnrich: function(item, year, collected, en_enabled, done) {
            var _this = this;
            if (en_enabled && !collected.en) {
                // 5. AniList EN
                return _this.fetchAniList(item, year, function(anilistData) {
                    if (anilistData) {
                        collected.en = anilistData.title;
                        if (anilistData.overview) collected.en_ov = anilistData.overview;
                    }
                    done();
                });
            }
            done();
        },

        mapWithLimit: function (items, limit, worker, callback) {
            var index = 0, active = 0, done = 0; if (!items.length) return callback();
            function next() {
                if (done >= items.length) { if(callback) callback(); return; }
                while (active < limit && index < items.length) {
                    (function (idx) {
                        active++;
                        worker(items[idx], function () { active--; done++; next(); });
                    })(index++);
                }
            }
            next();
        },

        // Синхронно застосовує кеш до елемента; повертає true якщо кеш знайдено
        enrichItemCacheOnly: function (item) {
            var id = this.extractId(item.id || item.tmdb_id);
            var type = this.getMediaType(item);
            var key = id + '_' + type;
            var cached = this.getCache()[key];

            if (item.poster_path) item.poster_path = item.poster_path.replace(/^\/+/, '');
            if (item.backdrop_path) item.backdrop_path = item.backdrop_path.replace(/^\/+/, '');
            if (item.img) item.img = item.img.replace(/\/+/g, '/').replace(':/', '://');

            if (cached && cached.expires && Date.now() < cached.expires) {
                this.applyBestTitle(item, cached);
                return true;
            }
            return false;
        },

        // Фаза 1: синхронний кеш → негайний рендер; Фаза 2: фонове збагачення решти
        enrichListProgressive: function (list, onReady, onItemUpdated) {
            var _this = this;
            var uncached = [];

            list.forEach(function (item) {
                if (!_this.enrichItemCacheOnly(item)) uncached.push(item);
            });

            onReady();

            if (uncached.length) {
                _this.mapWithLimit(uncached, 4, function (item, cb) {
                    _this.enrichItem(item, function () {
                        if (onItemUpdated) onItemUpdated(item);
                        cb();
                    });
                }, null);
            }
        }
    };

    function openAnimeCategoriesEditor() {
        var settings = AnimeWorldHelper.getCategorySettings();
        var categories = ANIME_CONFIG.anime_world.categories;
        var list = $('<div class="menu-edit-list aw-list aw-cat-list"></div>');
        function updateOrder() {
            var newOrder = [];
            list.find('.menu-edit-list__item').each(function() {
                var id = $(this).data('id');
                var isVisible = $(this).find('.dot').attr('opacity') === '1';
                newOrder.push({ id: id, visible: isVisible });
            });
            Lampa.Storage.set('anime_categories_state', newOrder);
        }

        settings.forEach(function(item) {
            var cat = categories.find(function(c) { return c.id === item.id; });
            if (!cat) return;
            
            var row = $('<div class="menu-edit-list__item' + (item.visible ? '' : ' item-hidden') + '" data-id="' + item.id + '">' +
                '<div class="menu-edit-list__title">' + cat.title + '</div>' +
                '<div class="aw-btns">' +
                    '<div class="menu-edit-list__move move-up selector">▲</div>' +
                    '<div class="menu-edit-list__move move-down selector">▼</div>' +
                    '<div class="menu-edit-list__toggle selector">' +
                        '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<rect x="1.89111" y="1.78369" width="21.793" height="21.793" rx="3.5" stroke="currentColor" stroke-width="3"/>' +
                            '<path d="M7.44873 12.9658L10.8179 16.3349L18.1269 9.02588" stroke="currentColor" stroke-width="3" class="dot" opacity="' + (item.visible ? '1' : '0') + '" stroke-linecap="round"/>' +
                        '</svg>' +
                    '</div>' +
                '</div>' +
            '</div>');

            row.find('.move-up').on('hover:enter', function() { var prev = row.prev('.menu-edit-list__item'); if (prev.length) { row.insertBefore(prev); updateOrder(); scrollIfNeeded(row); } });
            row.find('.move-down').on('hover:enter', function() { var next = row.next('.menu-edit-list__item'); if (next.length) { row.insertAfter(next); updateOrder(); scrollIfNeeded(row); } });
            row.find('.menu-edit-list__toggle').on('hover:enter', function() { var dot = row.find('.dot'); var isVisible = dot.attr('opacity') === '1'; dot.attr('opacity', isVisible ? '0' : '1'); if (isVisible) row.addClass('item-hidden'); else row.removeClass('item-hidden'); updateOrder(); });
            
            list.append(row);
        });
        
        var resetBtn = $('<div class="selector folder-reset-button">Скинути за замовчуванням</div>');
        resetBtn.on('hover:enter', function () {
            Lampa.Storage.set('anime_categories_state', []);
            Lampa.Modal.close();
            Lampa.Controller.toggle('settings');
            Lampa.Noty.show('Налаштування скинуто');
            refreshIfActive();
        });
        list.append(resetBtn);
        
        function scrollIfNeeded(row) {
            var scrollEl = row.closest('.scroll')[0];
            if (!scrollEl || !scrollEl.Scroll) return;
            var c = scrollEl.getBoundingClientRect();
            var r = row[0].getBoundingClientRect();
            if (r.top < c.top || r.bottom > c.bottom) scrollEl.Scroll.update(row);
        }

        Lampa.Modal.open({
            title: 'Налаштування категорій',
            html: list,
            size: 'small',
            onBack: function() {
                Lampa.Modal.close();
                Lampa.Controller.toggle('settings');
                refreshIfActive();
            }
        });

        // Патч Scroll.update: замінює стрибаючий авто-скрол Lampa на мінімальний delta-скрол
        setTimeout(function () {
            var scrollEl = list.closest('.scroll')[0];
            if (!scrollEl || !scrollEl.Scroll) return;
            var body = scrollEl.querySelector('.scroll__body');
            if (!body) return;
            var _orig = scrollEl.Scroll.update.bind(scrollEl.Scroll);
            scrollEl.Scroll.update = function (elem, force) {
                if (force) { _orig(elem, force); return; }
                var c = scrollEl.getBoundingClientRect();
                var el = (elem && elem[0]) ? elem[0] : elem;
                if (!el) { _orig(elem, force); return; }
                var r = el.getBoundingClientRect();
                var delta = 0;
                if      (r.bottom > c.bottom) delta = c.bottom - r.bottom;
                else if (r.top    < c.top)    delta = c.top    - r.top;
                if (!delta) return;
                var tr = window.getComputedStyle(body).transform;
                var currentY = (tr && tr !== 'none') ? new DOMMatrix(tr).m42 : 0;
                body.style.transform = 'translate3d(0,' + (currentY + delta) + 'px,0)';
            };
        }, 0);
    }

    function refreshIfActive() {
        var active = Lampa.Activity.active();
        if (active && active.component === 'category' && active.source === 'anime_world') {
            Lampa.Noty.show('Застосування налаштувань...');
            setTimeout(function() { window.location.reload(); }, 200);
        }
    }

    function getDefaultAnimeFilter() {
        return { languages: ['ja', 'zh'], genres: [], keywords: [], sort: 'popularity.desc', year_from: 0, year_to: 0 };
    }

    function buildAnimeFilterUrl(filter) {
        var params = [];
        var langs = filter.languages || [];
        var effectiveLangs = langs.length > 0 ? langs : ANIME_FILTER_LANGUAGES.map(function (l) { return l.id; });
        params.push('with_original_language=' + effectiveLangs.join('|'));
        // Жанр 16 (Анімація) завжди; додаткові — через AND (кома)
        var userGenres = filter.genres || [];
        params.push('with_genres=' + ['16'].concat(userGenres).join(','));
        var kws = filter.keywords || [];
        if (kws.length) params.push('with_keywords=' + kws.join('|'));
        var sortObj = ANIME_FILTER_SORTS.filter(function (s) { return s.id === filter.sort; })[0];
        params.push('sort_by=' + (filter.sort || 'popularity.desc'));
        params.push('vote_count.gte=' + (sortObj ? sortObj.voteCount : 5));
        if (filter.year_from) params.push('first_air_date.gte=' + filter.year_from + '-01-01');
        if (filter.year_to)   params.push('first_air_date.lte=' + filter.year_to + '-12-31');
        return 'discover/tv?' + params.join('&');
    }

    function openAnimeFilterEditor(currentFilter, onApply) {
        var filter = {
            languages: (currentFilter.languages || []).slice(),
            genres:    (currentFilter.genres    || []).slice(),
            keywords:  (currentFilter.keywords  || []).slice(),
            sort:      currentFilter.sort || 'popularity.desc',
            year_from: currentFilter.year_from || 0,
            year_to:   currentFilter.year_to   || 0
        };

        function getSummary(ids, list) {
            if (!ids.length) return '—';
            var titles = ids.map(function (id) {
                var found = list.filter(function (x) { return x.id === id; })[0];
                return found ? found.title : id;
            });
            return titles.length <= 2 ? titles.join(', ') : titles.slice(0, 2).join(', ') + '…';
        }

        function getLangSummary() {
            if (!filter.languages.length || filter.languages.length === ANIME_FILTER_LANGUAGES.length) return 'Усі';
            return getSummary(filter.languages, ANIME_FILTER_LANGUAGES);
        }

        function getSortTitle() {
            var s = ANIME_FILTER_SORTS.filter(function (x) { return x.id === filter.sort; })[0];
            return s ? s.title : filter.sort;
        }

        function getYearSummary() {
            var from = filter.year_from, to = filter.year_to;
            if (!from && !to) return 'Будь-який';
            if (from && to) return from + '–' + to;
            return from ? 'з ' + from : 'до ' + to;
        }

        function openSubToggle(title, items, selectedArr, onBack) {
            var wrap = $('<div class="menu-edit-list aw-list"></div>');
            items.forEach(function (item) {
                var isSelected = selectedArr.indexOf(item.id) >= 0;
                var row = $('<div class="menu-edit-list__item selector' + (isSelected ? '' : ' item-hidden') + '">' +
                    '<div class="menu-edit-list__title">' + item.title + '</div>' +
                    '<div class="menu-edit-list__toggle">' +
                        '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<rect x="1.89111" y="1.78369" width="21.793" height="21.793" rx="3.5" stroke="currentColor" stroke-width="3"/>' +
                            '<path d="M7.44873 12.9658L10.8179 16.3349L18.1269 9.02588" stroke="currentColor" stroke-width="3" class="dot" opacity="' + (isSelected ? '1' : '0') + '" stroke-linecap="round"/>' +
                        '</svg>' +
                    '</div>' +
                '</div>');
                row.on('hover:enter', function () {
                    var dot = row.find('.dot');
                    var wasSelected = dot.attr('opacity') === '1';
                    dot.attr('opacity', wasSelected ? '0' : '1');
                    if (wasSelected) {
                        row.addClass('item-hidden');
                        var idx = selectedArr.indexOf(item.id);
                        if (idx >= 0) selectedArr.splice(idx, 1);
                    } else {
                        row.removeClass('item-hidden');
                        if (selectedArr.indexOf(item.id) < 0) selectedArr.push(item.id);
                    }
                });
                wrap.append(row);
            });
            Lampa.Modal.open({
                title: title,
                html: wrap,
                size: 'small',
                onBack: function () { Lampa.Modal.close(); onBack(); }
            });
        }

        function openSubSort(onBack) {
            var wrap = $('<div class="menu-edit-list aw-list"></div>');
            ANIME_FILTER_SORTS.forEach(function (sort) {
                var isSelected = filter.sort === sort.id;
                var row = $('<div class="menu-edit-list__item anime-sort-row selector' + (isSelected ? '' : ' item-hidden') + '">' +
                    '<div class="menu-edit-list__title">' + sort.title + '</div>' +
                    '<div class="menu-edit-list__toggle">' +
                        '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<circle cx="13" cy="13" r="10.5" stroke="currentColor" stroke-width="3"/>' +
                            '<circle cx="13" cy="13" r="5.5" class="dot" fill="currentColor" opacity="' + (isSelected ? '1' : '0') + '"/>' +
                        '</svg>' +
                    '</div>' +
                '</div>');
                row.on('hover:enter', function () {
                    filter.sort = sort.id;
                    Lampa.Modal.close();
                    onBack();
                });
                wrap.append(row);
            });
            Lampa.Modal.open({
                title: 'Сортування',
                html: wrap,
                size: 'small',
                onBack: function () { Lampa.Modal.close(); onBack(); }
            });
        }

        function openYearPicker(title, currentVal, onBack) {
            var wrap = $('<div class="menu-edit-list aw-list"></div>');
            var thisYear = new Date().getFullYear();
            var years = [{ id: 0, title: 'Будь-який' }];
            for (var y = thisYear; y >= 1960; y--) years.push({ id: y, title: String(y) });
            years.forEach(function (year) {
                var isSelected = year.id === currentVal;
                var row = $('<div class="menu-edit-list__item anime-sort-row selector' + (isSelected ? '' : ' item-hidden') + '">' +
                    '<div class="menu-edit-list__title">' + year.title + '</div>' +
                    '<div class="menu-edit-list__toggle">' +
                        '<svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                            '<circle cx="13" cy="13" r="10.5" stroke="currentColor" stroke-width="3"/>' +
                            '<circle cx="13" cy="13" r="5.5" class="dot" fill="currentColor" opacity="' + (isSelected ? '1' : '0') + '"/>' +
                        '</svg>' +
                    '</div>' +
                '</div>');
                row.on('hover:enter', function () {
                    Lampa.Modal.close();
                    onBack(year.id);
                });
                wrap.append(row);
            });
            Lampa.Modal.open({
                title: title,
                html: wrap,
                size: 'small',
                onBack: function () { Lampa.Modal.close(); onBack(currentVal); }
            });
        }

        function openSubYear(onBack) {
            var wrap = $('<div class="menu-edit-list aw-list"></div>');

            function getYearLabel(val) { return val ? String(val) : 'Будь-який'; }

            function addYearRow(label, getter, pickTitle, setter) {
                var row = $('<div class="menu-edit-list__item selector">' +
                    '<div class="menu-edit-list__title">' + label + '</div>' +
                    '<div class="menu-edit-list__summary">' + getYearLabel(getter()) + '</div>' +
                    '<div class="menu-edit-list__arrow">›</div>' +
                '</div>');
                row.on('hover:enter', function () {
                    Lampa.Modal.close();
                    openYearPicker(pickTitle, getter(), function (y) {
                        setter(y);
                        openSubYear(onBack);
                    });
                });
                wrap.append(row);
            }

            addYearRow('Від', function () { return filter.year_from; }, 'Рік від', function (y) { filter.year_from = y; });
            addYearRow('До',  function () { return filter.year_to;   }, 'Рік до',  function (y) { filter.year_to = y;   });

            Lampa.Modal.open({
                title: 'Рік',
                html: wrap,
                size: 'small',
                onBack: function () { Lampa.Modal.close(); onBack(); }
            });
        }

        function openMainModal() {
            var wrap = $('<div class="menu-edit-list aw-list"></div>');

            function addNavRow(title, summary) {
                var row = $('<div class="menu-edit-list__item selector">' +
                    '<div class="menu-edit-list__title">' + title + '</div>' +
                    '<div class="menu-edit-list__summary">' + summary + '</div>' +
                    '<div class="menu-edit-list__arrow">›</div>' +
                '</div>');
                wrap.append(row);
                return row;
            }

            addNavRow('Країна', getLangSummary()).on('hover:enter', function () {
                Lampa.Modal.close();
                openSubToggle('Країна', ANIME_FILTER_LANGUAGES, filter.languages, openMainModal);
            });

            addNavRow('Жанри', getSummary(filter.genres, ANIME_FILTER_GENRES) || '—').on('hover:enter', function () {
                Lampa.Modal.close();
                openSubToggle('Жанри', ANIME_FILTER_GENRES, filter.genres, openMainModal);
            });

            addNavRow('Ключові слова', getSummary(filter.keywords, ANIME_FILTER_KEYWORDS) || '—').on('hover:enter', function () {
                Lampa.Modal.close();
                openSubToggle('Ключові слова', ANIME_FILTER_KEYWORDS, filter.keywords, openMainModal);
            });

            addNavRow('Сортування', getSortTitle()).on('hover:enter', function () {
                Lampa.Modal.close();
                openSubSort(openMainModal);
            });

            addNavRow('Рік', getYearSummary()).on('hover:enter', function () {
                Lampa.Modal.close();
                openSubYear(openMainModal);
            });

            var applyBtn = $('<div class="selector folder-reset-button anime-filter-apply">Застосувати фільтр</div>');
            applyBtn.on('hover:enter', function () {
                Lampa.Storage.set('anime_filter', filter);
                Lampa.Modal.close();
                if (onApply) onApply(filter);
            });
            wrap.append(applyBtn);

            var resetBtn = $('<div class="selector folder-reset-button">Скинути фільтр</div>');
            resetBtn.on('hover:enter', function () {
                Lampa.Storage.set('anime_filter', getDefaultAnimeFilter());
                Lampa.Modal.close();
                Lampa.Controller.toggle('content');
                Lampa.Noty.show('Фільтр скинуто');
            });
            wrap.append(resetBtn);

            Lampa.Modal.open({
                title: 'Фільтр аніме',
                html: wrap,
                size: 'small',
                onBack: function () {
                    Lampa.Modal.close();
                    Lampa.Controller.toggle('content');
                }
            });
        }

        openMainModal();
    }

    function buildCategoryBaseUrl(cat) {
        if (!cat.params) return cat.url;
        var parts = [];
        for (var key in cat.params) {
            parts.push(key + '=' + cat.params[key]);
        }
        return cat.url + '?' + parts.join('&');
    }

    function updateCardTitle(id, title) {
        function tryUpdate() {
            var found = false;
            $('.card').each(function () {
                // card_data може бути на батьківському вузлі (як в Lampa Card component)
                var node = this;
                while (node && !node.card_data) node = node.parentNode;
                if (node && node.card_data && String(node.card_data.id) === id) {
                    $(this).find('.card__title').text(title);
                    found = true;
                }
            });
            return found;
        }
        if (!tryUpdate()) setTimeout(tryUpdate, 800);
    }

    function buildTmdbUrl(baseUrl, page) {
        if (baseUrl.indexOf('{current_date}') >= 0) {
            var d = new Date();
            var date = [d.getFullYear(), ('0' + (d.getMonth() + 1)).slice(-2), ('0' + d.getDate()).slice(-2)].join('-');
            baseUrl = baseUrl.replace(/\{current_date\}/g, date);
        }
        var sep = baseUrl.indexOf('?') >= 0 ? '&' : '?';
        return Lampa.TMDB.api(baseUrl + sep + 'api_key=' + Lampa.TMDB.key() + '&language=' + Lampa.Storage.get('language', 'uk') + '&page=' + (page || 1));
    }

    function preparePage(json, url, page) {
        if (!json) json = { results: [] };
        var cur = page || json.page || 1;
        var total = parseInt(json.total_pages || 0, 10);
        var hasNext = total ? cur < total : json.results && json.results.length >= 20;
        json.url = url;
        json.page = cur;
        if (hasNext) json.more = true; else json.nomore = true;
        return json;
    }

    function isAnimeUrl(url) {
        return url &&
            (url.indexOf('discover/tv?') === 0 || url.indexOf('discover/movie?') === 0) &&
            url.indexOf('with_genres=16') >= 0;
    }

    function patchAnimeActivityRouting() {
        if (!Lampa.Activity || Lampa.Activity._animeWorldPatched) return;
        var originalPush = Lampa.Activity.push;
        Lampa.Activity.push = function (object) {
            if (object && object.component === 'category_full' && isAnimeUrl(object.url)) {
                object.source = 'anime_world';
            }
            return originalPush.apply(this, arguments);
        };
        Lampa.Activity._animeWorldPatched = true;
    }

    function registerAnimeSource() {
        if (!Lampa.Api || !Lampa.Api.sources || !Lampa.Api.sources.tmdb) return false;
        if (Lampa.Api.sources.anime_world) return true;
        patchAnimeActivityRouting();

        var tmdb = Lampa.Api.sources.tmdb;

        Lampa.Api.sources.anime_world = {
            main: function (params, oncomplite, onerror) {
                Lampa.Api.sources.anime_world.category(params, oncomplite, onerror);
            },
            category: function (params, oncomplite, onerror) {
                var categories = AnimeWorldHelper.getEnabledCategories();
                if (!categories.length) { if (onerror) onerror(); return; }

                var pending = categories.length;
                var data = new Array(categories.length);
                var cancelled = false;
                var net = new Lampa.Reguest();

                function done() {
                    if (cancelled) return;
                    if (--pending > 0) return;
                    cancelled = true;
                    var rows = data.filter(function (r) { return r && r.results && r.results.length; });
                    var continueRow = AnimeWorldHelper.buildContinueWatchingRow();
                    if (continueRow) rows.unshift(continueRow);
                    if (!rows.length) { if (onerror) onerror(); return; }

                    var all_items = [];
                    rows.forEach(function (r) { all_items = all_items.concat(r.results); });
                    AnimeWorldHelper.enrichListProgressive(all_items,
                        function () { oncomplite(rows); },
                        function (item) {
                            updateCardTitle(
                                String(AnimeWorldHelper.extractId(item.id || item.tmdb_id)),
                                item.name || item.title
                            );
                        }
                    );
                }

                categories.forEach(function (cat, i) {
                    var base = buildCategoryBaseUrl(cat);
                    net.silent(buildTmdbUrl(base, 1), function (json) {
                        if (json && json.results) {
                            data[i] = preparePage(json, base, 1);
                            data[i].title = cat.title;
                        }
                        done();
                    }, done);
                });
            },
            list: function (params, oncomplite, onerror) {
                var net = new Lampa.Reguest();
                net.silent(buildTmdbUrl(params.url, params.page || 1), function (json) {
                    if (json && json.results) {
                        var page = preparePage(json, params.url, params.page || 1);
                        AnimeWorldHelper.enrichListProgressive(json.results,
                            function () { oncomplite(page); },
                            function (item) {
                                updateCardTitle(
                                    String(AnimeWorldHelper.extractId(item.id || item.tmdb_id)),
                                    item.name || item.title
                                );
                            }
                        );
                    } else if (onerror) onerror();
                }, onerror);
            },
            full:        tmdb.full,
            person:      tmdb.person,
            seasons:     tmdb.seasons,
            collections: tmdb.collections,
            menu:        tmdb.menu,
            clear:       tmdb.clear
        };

        return true;
    }

    // Lampa.SettingsApi.addParam({type:'trigger', default:...}) реєструє default лише для
    // відображення тумблера — фізично в Storage нічого не пишеться, доки користувач сам його
    // не перемкне. Без цього на чистому встановленні деякі платформи Lampa не застосовують
    // default коректно, доки тумблер не вимкнути й увімкнути повторно. Тому пишемо явно самі.
    function ensureSettingDefaults() {
        var UNSET = '__aw_unset__';
        for (var key in DEFAULT_SETTINGS) {
            if (Lampa.Storage.get(key, UNSET) === UNSET) Lampa.Storage.set(key, DEFAULT_SETTINGS[key]);
        }
    }

    function startPlugin() {
        if (window.plugin_animeworld_ready) return;
        window.plugin_animeworld_ready = true;
        ensureSettingDefaults();

        var styles = [
            '.aw-list.menu-edit-list { padding: 1em; }',
            '.aw-list .menu-edit-list__item { display: flex; align-items: center; margin: 0.3em 0; padding: 0.5em; background: rgba(255,255,255,0.05); border-radius: 5px; }',
            '.aw-list .menu-edit-list__title { flex: 1; min-width: 0; font-size: 1.1em; padding-left: 0.5em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
            '.aw-cat-list .menu-edit-list__title { flex: 1 !important; min-width: 0 !important; max-width: none !important; width: auto !important; }',
            '.aw-btns { display: flex; align-items: center; gap: 0.3em; flex-shrink: 0; margin-left: 0.5em; }',
            '.aw-list .menu-edit-list__move { width: 1.8em; height: 1.8em; display: flex; align-items: center; justify-content: center; cursor: pointer; font-weight: bold; user-select: none; background: rgba(255,255,255,0.1); border-radius: 3px; }',
            '.aw-list .menu-edit-list__move.focus { background: #fff; color: #000; }',
            '.aw-list .menu-edit-list__toggle { width: 1.8em; height: 1.8em; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid rgba(255,255,255,0.5); border-radius: 3px; }',
            '.aw-list .menu-edit-list__item.selector.focus .menu-edit-list__toggle { border-color: #fff; background: rgba(255,255,255,0.2); }',
            '.aw-list .item-hidden { opacity: 0.4; }',
            '.aw-list .folder-reset-button { background: rgba(200,100,100,0.3); margin-top: 1em; border-radius: 5px; padding: 1em; text-align: center; cursor: pointer; }',
            '.aw-list .folder-reset-button.focus { background: #fff; color: #000; }',
            '.aw-list .anime-filter-apply { background: rgba(80,180,80,0.3) !important; }',
            '.aw-list .menu-edit-list__item.selector.focus { background: rgba(255,255,255,0.28); border-radius: 5px; }',
            '.aw-list .menu-edit-list__item.selector.focus .menu-edit-list__title { color: #fff; }',
            '.aw-list .anime-sort-row .menu-edit-list__toggle { border: none; }',
            '.aw-list .menu-edit-list__summary { flex: 2; text-align: right; font-size: 0.85em; opacity: 0.55; padding-right: 0.4em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
            '.aw-list .menu-edit-list__arrow { font-size: 1.4em; line-height: 1; opacity: 0.45; padding-left: 0.2em; flex-shrink: 0; }',
            '.aw-list .menu-edit-list__item.selector.focus .menu-edit-list__summary { opacity: 0.9; }',
            '.aw-list .menu-edit-list__item.selector.focus .menu-edit-list__arrow { opacity: 0.9; }'
        ].join('');
        if (!document.getElementById('anime-world-styles')) {
            $('head').append('<style id="anime-world-styles">' + styles + '</style>');
        }
        registerAnimeSource();

        function createSettings() {
            Lampa.SettingsApi.addComponent({ component: 'anime_world_settings', name: 'Аніме Світ', icon: ANIME_CONFIG.anime_world.icon });
            Lampa.SettingsApi.addParam({
                component: 'anime_world_settings',
                param: { name: 'anime_world_categories_editor', type: 'static' },
                field: { name: 'Відображення та порядок категорій', description: 'Налаштувати список категорій на головній' },
                onRender: function(item) { item.on('hover:enter', function() { openAnimeCategoriesEditor(); }); }
            });
            Lampa.SettingsApi.addParam({
                component: 'anime_world_settings',
                param: { name: 'anime_world_cache_ttl', type: 'select', values: { '0': 'Вимкнути', '12': '12 годин', '24': '24 години', '48': '48 годин', '72': '72 години', '168': '7 днів', '336': '14 днів', '720': '1 місяць' }, default: '24' },
                field: { name: 'Час зберігання кешу', description: 'Як довго зберігати назви та описи локально' }
            });
            Lampa.SettingsApi.addParam({
                component: 'anime_world_settings',
                param: { name: 'anime_world_fallback_ru', type: 'trigger', default: DEFAULT_SETTINGS.anime_world_fallback_ru },
                field: { name: 'Пошук російською', description: 'Шукати назви та описи RU при відсутності UK' }
            });
            Lampa.SettingsApi.addParam({
                component: 'anime_world_settings',
                param: { name: 'anime_world_fallback_en', type: 'trigger', default: DEFAULT_SETTINGS.anime_world_fallback_en },
                field: { name: 'Пошук англійською', description: 'Шукати назви та описи EN при відсутності UK' }
            });
            Lampa.SettingsApi.addParam({
                component: 'anime_world_settings',
                param: { name: 'anime_world_global_titles', type: 'trigger', default: DEFAULT_SETTINGS.anime_world_global_titles },
                field: { name: 'Заміна назв скрізь', description: 'Замінювати назви аніме на всіх екранах (вибране, пошук, головна)' }
            });
            Lampa.SettingsApi.addParam({
                component: 'anime_world_settings',
                param: { name: 'anime_world_custom_proxy', type: 'input', values: '', default: '' },
                field: { name: 'Свій CORS-проксі', description: 'Наприклад https://192.168.0.10:9118/corseu/mytoken/ або https://mycors-proxy.com?url=. Якщо порожньо — публічний cors.io/proxy.cors.sh' }
            });
            Lampa.SettingsApi.addParam({
                component: 'anime_world_settings',
                param: { name: 'anime_world_clear_cache', type: 'static' },
                field: { name: 'Очистити кеш метаданих', description: 'Видалити всі збережені назви та описи' },
                onRender: function(item) { item.on('hover:enter', function() { Lampa.Storage.set('anime_world_cache', {}); Lampa.Noty.show('Кеш метаданих очищено'); refreshIfActive(); }); }
            });
        }

        function addMenuButton() {
            var menu = $('.menu .menu__list').eq(0);
            if (!menu.length || menu.find('.menu__item[data-sid="anime_world"]').length) return;
            var btn = $('<li class="menu__item selector" data-action="anime_world_action" data-sid="anime_world">' +
                '<div class="menu__ico">' + ANIME_CONFIG.anime_world.icon + '</div>' +
                '<div class="menu__text">' + ANIME_CONFIG.anime_world.title + '</div>' +
                '</li>');
            btn.on('hover:enter', function () {
                registerAnimeSource();
                Lampa.Activity.push({ title: ANIME_CONFIG.anime_world.title, component: 'category', source: 'anime_world', url: 'tv', card_type: true, page: 1 });
            });
            menu.append(btn);
        }

        function addAnimeFilterButton() {
            var activeActivity = null;
            var hideTimer;

            var button = $('<div class="head__action head__settings selector">' +
                '<svg height="36" viewBox="0 0 38 36" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                    '<rect x="1.5" y="1.5" width="35" height="33" rx="1.5" stroke="currentColor" stroke-width="3"/>' +
                    '<rect x="7" y="8" width="24" height="3" rx="1.5" fill="currentColor"/>' +
                    '<rect x="7" y="16" width="24" height="3" rx="1.5" fill="currentColor"/>' +
                    '<rect x="7" y="25" width="24" height="3" rx="1.5" fill="currentColor"/>' +
                    '<circle cx="13.5" cy="17.5" r="3.5" fill="currentColor"/>' +
                    '<circle cx="23.5" cy="26.5" r="3.5" fill="currentColor"/>' +
                    '<circle cx="21.5" cy="9.5" r="3.5" fill="currentColor"/>' +
                '</svg>' +
            '</div>');
            button.hide();

            button.on('hover:enter', function () {
                var savedFilter = Lampa.Storage.get('anime_filter', getDefaultAnimeFilter());
                openAnimeFilterEditor(savedFilter, function (filter) {
                    Lampa.Activity.push({
                        title: 'Фільтр',
                        component: 'category_full',
                        source: 'anime_world',
                        url: buildAnimeFilterUrl(filter),
                        anime_filter: true,
                        card_type: true,
                        page: 1
                    });
                });
            });

            $('.head .open--search').after(button);

            function isFilterActivity(obj) {
                if (!obj) return false;
                if (obj.component === 'category' && obj.source === 'anime_world') return true;
                if (obj.component !== 'category_full' || obj.source !== 'anime_world') return false;
                if (obj.anime_filter) return true;
                var saved = Lampa.Storage.get('anime_filter', null);
                return !!(saved && obj.url === buildAnimeFilterUrl(saved));
            }

            Lampa.Listener.follow('activity', function (e) {
                if (e.type === 'start') activeActivity = e.object;
                clearTimeout(hideTimer);
                hideTimer = setTimeout(function () {
                    if (!isFilterActivity(activeActivity)) {
                        button.hide();
                        activeActivity = null;
                    }
                }, 1000);

                if (e.type === 'start' && isFilterActivity(e.object)) {
                    button.show();
                    activeActivity = e.object;
                }
            });
        }

        function subscribeGlobalEnrich() {
            var _enrichObserver = null;
            var _enrichRunning = false;

            // Картки календаря ("Нещодавні/Найближчі виходи епізодів") рендеруються
            // компонентом Episode (клас .card-episode), а не Card (.card). У Episode.Card
            // card_data на DOM-елементі не виставляється — патч виправляє це одноразово.
            // Дані шоу лежать у this.data.card (не в самому this.data, який є об'єктом
            // епізоду), тому збагачення далі використовує entry.item = card.card_data.card.
            (function patchEpisodeCardData() {
                var em = Lampa.Maker && Lampa.Maker.map('Episode');
                if (!em || !em.Card || em.Card._awPatched) return;
                var orig = em.Card.onCreate;
                em.Card.onCreate = function () {
                    orig.apply(this, arguments);
                    if (this.html && this.data) this.html.card_data = this.data;
                };
                em.Card._awPatched = true;
            })();

            function enrichActivityCards() {
                if (!Lampa.Storage.get('anime_world_global_titles', DEFAULT_SETTINGS.anime_world_global_titles)) return;
                if (_enrichRunning) return;

                var cards = [];
                var cache = AnimeWorldHelper.getCache();

                function collectCard(card, item) {
                    var isAnime = item.original_language === 'ja' || item.original_language === 'zh';
                    // якщо original_language не збережено (закладки з не-TMDB джерел) —
                    // перевіряємо кеш: якщо раніше збагачувалось плагіном — точно аніме
                    if (!isAnime) {
                        var cid = AnimeWorldHelper.extractId(item.id || item.tmdb_id);
                        var ctype = AnimeWorldHelper.getMediaType(item);
                        isAnime = !!(cache[cid + '_' + ctype]);
                    }
                    if (!isAnime) return;
                    var titleEl = card.querySelector('.card__title');
                    if (!titleEl) return;
                    cards.push({ card: card, titleEl: titleEl, item: item });
                }

                $('.card').get().forEach(function (card) {
                    if (card.dataset.awEnriched) return;
                    var item = card.card_data;
                    if (!item || !item.id) return;
                    collectCard(card, item);
                });

                // Картки calendar-рядків ("Нещодавні/Найближчі виходи") — .card-episode.
                // card_data.card — об'єкт серіалу (показ картки); card_data — об'єкт епізоду.
                $('.card-episode').get().forEach(function (card) {
                    if (card.dataset.awEnriched) return;
                    var data = card.card_data;
                    if (!data || !data.card || !data.card.id) return;
                    collectCard(card, data.card);
                });

                if (!cards.length) return;
                _enrichRunning = true;

                AnimeWorldHelper.mapWithLimit(cards, 8, function (entry, cb) {
                    AnimeWorldHelper.enrichItem(entry.item, function () {
                        var newTitle = entry.item.name || entry.item.title;
                        if (newTitle) $(entry.titleEl).text(newTitle);
                        entry.card.dataset.awEnriched = '1';
                        cb();
                    });
                }, function () {
                    _enrichRunning = false;
                    // новi картки могли з'явитись поки observer був заблокований флагом
                    enrichActivityCards();
                });
            }

            function setupObserver() {
                if (_enrichObserver) { _enrichObserver.disconnect(); _enrichObserver = null; }
                var slide = document.querySelector('.activity--active');
                if (!slide) return;
                _enrichObserver = new MutationObserver(function () { enrichActivityCards(); });
                _enrichObserver.observe(slide, { childList: true, subtree: true });
            }

            Lampa.Listener.follow('activity', function (e) {
                if (e.type === 'start') {
                    setTimeout(function () {
                        enrichActivityCards();
                        setupObserver();
                    }, 500);
                }
                if (e.type === 'archive') {
                    enrichActivityCards();
                    setupObserver();
                }
            });
        }

        // Повна картка (component 'full') рендериться напряму через tmdb.full
        // (registerAnimeSource: full: tmdb.full) — enrichItem її не торкається взагалі,
        // тому без цього назва/опис на сторінці тайтлу завжди лишались оригінальними TMDB,
        // навіть якщо в кеші вже є українські дані.
        function subscribeFullCardEnrich() {
            Lampa.Listener.follow('full', function (e) {
                if (e.type !== 'complite' || !e.data || !e.data.movie) return;
                var movie = e.data.movie;

                var isAnime = movie.original_language === 'ja' || movie.original_language === 'zh';
                if (!isAnime) {
                    var cid = AnimeWorldHelper.extractId(movie.id || movie.tmdb_id);
                    var ctype = AnimeWorldHelper.getMediaType(movie);
                    isAnime = !!(AnimeWorldHelper.getCache()[cid + '_' + ctype]);
                }
                if (!isAnime) return;

                AnimeWorldHelper.enrichItem(movie, function () {
                    var active = Lampa.Activity.active();
                    var render = active && active.activity && active.activity.render();
                    if (!render) return;

                    var newTitle = movie.name || movie.title;
                    if (newTitle) $('.full-start-new__title', render).text(newTitle);
                    if (movie.overview) $('.full-descr__text', render).html(movie.overview + '<br><br>');
                });
            });
        }

        if (window.appready) { addMenuButton(); createSettings(); addAnimeFilterButton(); subscribeGlobalEnrich(); subscribeFullCardEnrich(); }
        else { Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') { addMenuButton(); createSettings(); addAnimeFilterButton(); subscribeGlobalEnrich(); subscribeFullCardEnrich(); } }); }
        setInterval(function () { if (window.appready && $('.menu .menu__list').eq(0).length) addMenuButton(); }, 4000);
    }

    if (!window.plugin_animeworld_ready) startPlugin();
})();
