(function () {
    'use strict';

    /**
     * Дорама / Asian Dramas
     * Версія: 1.8.1
     * Опис: Добірки популярних азійських дорам (корейські, китайські, японські)
     * Оновлено:
     *  v1.8.1:
     *   - "Продовжити перегляд" більше не показує наздогнані серіали (усі випущені
     *     серії переглянуто) — рахуємо відсоток останнього релевантного епізоду
     *     через Lampa.Timeline.watchedEpisode, поріг 90% як у рідній стрічці Lampa.
     *     Покриває і завершені серіали (немає next_episode_to_air), яких рідна
     *     логіка клієнта не враховує.
     *   - Критерій дорами в цьому ряду більше не вимагає жанру 18 (Drama): багато
     *     дорам на TMDB його не мають (напр. "Алхімія душ" — Sci-Fi & Fantasy +
     *     Action & Adventure) і через це не потрапляли в ряд. Тепер критерій той
     *     самий, що й у категоріях плагіна: без жанру 16 + мова ko/zh/ja.
     *  v1.8.0:
     *   - Ряд "Продовжити перегляд": локально з історії перегляду (Favorite), без
     *     звернень до мережі. Фільтр за жанром 18 (Drama, без 16 — щоб не зачепити
     *     аніме з драматичним сюжетом) і мовою ko/zh/ja. Потребує genre_ids на
     *     картці (плагін favorite-fix) — без нього картка просто не
     *     показується в ряду.
     *  v1.7.0:
     *   - прибрано донхуа (китайську анімацію) з дорам
     *  v1.6.5 і раніше:
     *   - покращено контраст підсвічування курсора (поточного рядка) в фільтрі
     *   - Додано кнопку фільтра (країни, жанри, ключові слова, рік) та сортування (популяні на початку, рейтинг від високого, нові/старі на початку)
     *   - Налаштування вимкнення.увімкнення пошуку назв RU/EN при відсутності українських
     *   - Збереження назв в кеші для оптимізації запитів
     *   - налаштування порядку та видимості категорій
     *   - рефакторинг: Lampa.Api.sources
     *   - виправлено фільтри категорій (romance, historical/fantasy, detective)
     *   - змінено "Нещодавно додані" - замість 'ko' тепер додано всі мови
     *   - додано категорії: Екшн та пригоди, Медичні драми, Фентезійні, Історичні, Netflix/tvN/JTBC
     *   - додано категорії, "Детективи" та "Комедії"
     *   - замінено нескінченний setInterval на рекурсивний setTimeout з лічильником спроб
     *   - аніме виключено з дорам, топ донхуа замінено на популярні
     *   - автоматичне масштабування (cols--6) та вертикальні постери
     *  v1.6.1-v1.6.4:
     *   - виправлення дрібних помилок
     *   - Поліфіл Array.prototype.find для сумісності зі старими Smart TV (ES5)
     *   - Мультиформатний кеш: зберігає uk/ru/en назви одночасно, applyBestTitle обирає за поточними налаштуваннями
     *   - Очищення подвійних слешів у посиланнях зображень (item.img)
     *   - Редактор категорій: кнопки згруповано праворуч, назви не обрізаються, розумний скрол
     *   - Час зберігання кешу: додано варіанти 14 днів та 1 місяць
     *  v1.6.5:
     *   - виправлено стилі, щоб не перетиналися з іншими розширеннями
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

    // Відсоток перегляду останнього епізоду, з якого серіал вважається наздогнаним
    // і зникає з "Продовжити перегляд". Те саме значення, що в рідній стрічці Lampa
    // (app.min.js, ContinueWatch: ongoing.filter(c => c.viewed >= 90)).
    var CAUGHT_UP_PERCENT = 90;

    var DORAMA_CONFIG = {
        'dorama': {
            title: 'Дорама',
            icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.94-.49-7-3.85-7-7.93s3.06-7.44 7-7.93V17.93zm2-13.86c3.94.49 7 3.85 7 7.93s-3.06 7.44-7 7.93V4.07z"/></svg>',
            categories: [
                {
                    "id": "dorama_popular_now",
                    "title": "Популярні дорами зараз",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "18",
                        "without_genres": "16",
                        "sort_by": "popularity.desc",
                        "vote_count.gte": "30"
                    }
                },
                /* {
                    "id": "dorama_new_korean",
                    "title": "Нові корейські дорами",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko",
                        "with_genres": "18",
                        "without_genres": "16",
                        "sort_by": "first_air_date.desc",
                        "first_air_date.lte": "{current_date}",
                        "vote_count.gte": "3"
                    }
                }, */
                {
                    "id": "dorama_recently_added",
                    "title": "Нещодавно додані",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "18",
                        "without_genres": "16",
                        "sort_by": "first_air_date.desc",
                        "first_air_date.lte": "{current_date}",
                        "vote_count.gte": "3"
                    }
                },
                {
                    "id": "dorama_top_rated",
                    "title": "Найкращі дорами (високий рейтинг)",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "18",
                        "without_genres": "16",
                        "sort_by": "vote_average.desc",
                        "vote_average.gte": "7.8",
                        "vote_count.gte": "200"
                    }
                },
                {
                    "id": "dorama_top_korean",
                    "title": "Топ корейських дорам",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko",
                        "with_genres": "18",
                        "without_genres": "16",
                        "sort_by": "vote_average.desc",
                        "vote_average.gte": "7.5",
                        "vote_count.gte": "500"
                    }
                },
                {
                    "id": "dorama_romantic",
                    "title": "Романтичні дорами",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "18",
                        "without_genres": "16",
                        "with_keywords": "9840|9673",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_action_adventure",
                    "title": "Екшн та пригоди",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "10759,18",
                        "without_genres": "16",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_medical",
                    "title": "Медичні драми",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "18",
                        "without_genres": "16",
                        "with_keywords": "258786|13005",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_fantasy",
                    "title": "Фентезійні дорами",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "10765,18",
                        "without_genres": "16",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_historical",
                    "title": "Історичні та епохальні дорами",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "18",
                        "without_genres": "16",
                        "with_keywords": "276158|12995|15060|3998|3996|191599",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_law_detective",
                    "title": "Юриспруденція, детективи та кримінал",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "9648|80",
                        "without_genres": "16",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_comedy",
                    "title": "Комедійні дорами",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "18,35",
                        "without_genres": "16",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_cdrama",
                    "title": "Китайські дорами (C-drama)",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "zh",
                        "with_genres": "18",
                        "without_genres": "16",
                        "sort_by": "popularity.desc",
                        "vote_count.gte": "20"
                    }
                },
                {
                    "id": "dorama_jdrama",
                    "title": "Японські дорами (J-drama)",
                    "url": "discover/tv",
                    "params": {
                        "with_original_language": "ja",
                        "with_genres": "18",
                        "without_genres": "16",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_viki",
                    "title": "Дорами на Viki / Rakuten",
                    "url": "discover/tv",
                    "params": {
                        "with_watch_providers": "126",
                        "watch_region": "UA",
                        "without_genres": "16",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_netflix",
                    "title": "Дорами на Netflix",
                    "url": "discover/tv",
                    "params": {
                        "with_networks": "213",
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "18",
                        "without_genres": "16",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_tvn",
                    "title": "Дорами на tvN",
                    "url": "discover/tv",
                    "params": {
                        "with_networks": "866",
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "18",
                        "without_genres": "16",
                        "sort_by": "popularity.desc"
                    }
                },
                {
                    "id": "dorama_jtbc",
                    "title": "Дорами на JTBC",
                    "url": "discover/tv",
                    "params": {
                        "with_networks": "885",
                        "with_original_language": "ko|zh|ja",
                        "with_genres": "18",
                        "without_genres": "16",
                        "sort_by": "popularity.desc"
                    }
                }
            ]
        }
    };

    var DORAMA_FILTER_LANGUAGES = [
        { id: 'ko', title: 'Корея' },
        { id: 'zh', title: 'Китай' },
        { id: 'ja', title: 'Японія' }
    ];

    // Жанр "Драма" (18) завжди присутній в URL, тут лише додаткові
    var DORAMA_FILTER_GENRES = [
        { id: '35',    title: 'Комедія' },
        { id: '10751', title: 'Сімейний' },
        { id: '10759', title: 'Екшн та пригоди' },
        { id: '10765', title: 'Фентезі та фантастика' },
        { id: '9648',  title: 'Детектив' },
        { id: '80',    title: 'Кримінал' },
        { id: '10768', title: 'Політика та війна' },
        { id: '10762', title: 'Дитячий' }
    ];

    var DORAMA_FILTER_KEYWORDS = [
        { id: '9840|9673',                      title: 'Романтика' },
        { id: '258786|13005',                   title: 'Медична драма' },
        { id: '276158|12995|15060|3996|191599', title: 'Двір/Королівство' },
        { id: '3998|184656',                    title: 'Бойові мистецтва' },
        { id: '9748',                           title: 'Помста' },
        { id: '162846|6152',                    title: 'Привиди' },
        { id: '5484|194421|12320|357276',       title: 'Реінкарнація' },
        { id: '4379|10854',                     title: 'Подорож у часі' },
        { id: '2692|4491',                      title: 'Шлюб за контрактом' },
        { id: '182325|1438',                    title: 'Офісний роман' },
        { id: '1453|11469',                     title: 'Амнезія' },
        { id: '3149|10391',                     title: 'Гангстер' },
        { id: '470|4289',                       title: 'Шпигун' },
        { id: '12565|10714',                    title: 'Психотрилер' },
        { id: '237451|33465|243230',            title: 'Паралельний світ' },
        { id: '9882|14626',                     title: 'Космос' }
    ];

    var DORAMA_FILTER_SORTS = [
        { id: 'popularity.desc',     title: 'Популярні',        voteCount: 50  },
        { id: 'vote_average.desc',   title: 'Рейтинг ↓',       voteCount: 150 },
        { id: 'first_air_date.desc', title: 'Нові спочатку',   voteCount: 3   },
        { id: 'first_air_date.asc',  title: 'Старіші спочатку', voteCount: 5   }
    ];

    function getCategorySettings() {
        var categories = DORAMA_CONFIG.dorama.categories;
        var saved = Lampa.Storage.get('dorama_categories_state', []);

        if (!saved.length) {
            saved = categories.map(function (c) { return { id: c.id, visible: true }; });
        }

        var result = [];
        saved.forEach(function (s) {
            if (categories.find(function (c) { return c.id === s.id; })) {
                result.push(s);
            }
        });
        categories.forEach(function (c) {
            if (!result.find(function (r) { return r.id === c.id; })) {
                result.push({ id: c.id, visible: true });
            }
        });

        return result;
    }

    function getEnabledCategories() {
        var settings = getCategorySettings();
        var categories = DORAMA_CONFIG.dorama.categories;

        var result = [];
        settings.forEach(function (s) {
            if (s.visible) {
                var cat = categories.find(function (c) { return c.id === s.id; });
                if (cat) result.push(cat);
            }
        });

        return result;
    }

    function openCategoriesEditor() {
        var settings = getCategorySettings();
        var categories = DORAMA_CONFIG.dorama.categories;
        var list = $('<div class="menu-edit-list dr-list dr-cat-list"></div>');

        function updateOrder() {
            var newOrder = [];
            list.find('.menu-edit-list__item').each(function () {
                var id = $(this).data('id');
                var isVisible = $(this).find('.dot').attr('opacity') === '1';
                newOrder.push({ id: id, visible: isVisible });
            });
            Lampa.Storage.set('dorama_categories_state', newOrder);
        }

        settings.forEach(function (item) {
            var cat = categories.find(function (c) { return c.id === item.id; });
            if (!cat) return;

            var row = $('<div class="menu-edit-list__item' + (item.visible ? '' : ' item-hidden') + '" data-id="' + item.id + '">' +
                '<div class="menu-edit-list__title">' + cat.title + '</div>' +
                '<div class="dr-btns">' +
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

            row.find('.move-up').on('hover:enter', function () {
                var prev = row.prev('.menu-edit-list__item');
                if (prev.length) { row.insertBefore(prev); updateOrder(); scrollIfNeeded(row); }
            });
            row.find('.move-down').on('hover:enter', function () {
                var next = row.next('.menu-edit-list__item');
                if (next.length) { row.insertAfter(next); updateOrder(); scrollIfNeeded(row); }
            });
            row.find('.menu-edit-list__toggle').on('hover:enter', function () {
                var dot = row.find('.dot');
                var isVisible = dot.attr('opacity') === '1';
                dot.attr('opacity', isVisible ? '0' : '1');
                if (isVisible) row.addClass('item-hidden'); else row.removeClass('item-hidden');
                updateOrder();
            });

            list.append(row);
        });

        var resetBtn = $('<div class="selector folder-reset-button">Скинути за замовчуванням</div>');
        resetBtn.on('hover:enter', function () {
            Lampa.Storage.set('dorama_categories_state', []);
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
            onBack: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle('settings');
                refreshIfActive();
            }
        });

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
        if (active && active.component === 'category' && active.source === 'dorama') {
            Lampa.Noty.show('Застосування налаштувань...');
            setTimeout(function () { window.location.reload(); }, 200);
        }
    }

    function getDefaultFilter() {
        return { languages: ['ko', 'zh', 'ja'], genres: [], keywords: [], sort: 'popularity.desc', year_from: 0, year_to: 0 };
    }

    function buildFilterUrl(filter) {
        var params = [];
        // Країна: порожній або повний список = ko|zh|ja; частковий = лише вибрані
        var langs = filter.languages || [];
        var effectiveLangs = langs.length > 0 ? langs : DORAMA_FILTER_LANGUAGES.map(function (l) { return l.id; });
        params.push('with_original_language=' + effectiveLangs.join('|'));
        // Жанр 18 (Драма) завжди; додаткові — через AND (кома)
        var userGenres = filter.genres || [];
        params.push('with_genres=' + ['18'].concat(userGenres).join(','));
        params.push('without_genres=16');
        var kws = filter.keywords || [];
        if (kws.length) params.push('with_keywords=' + kws.join('|'));
        // Сортування + відповідний мінімум голосів
        var sortObj = DORAMA_FILTER_SORTS.filter(function (s) { return s.id === filter.sort; })[0];
        params.push('sort_by=' + (filter.sort || 'popularity.desc'));
        params.push('vote_count.gte=' + (sortObj ? sortObj.voteCount : 5));
        // Діапазон років
        if (filter.year_from) params.push('first_air_date.gte=' + filter.year_from + '-01-01');
        if (filter.year_to)   params.push('first_air_date.lte=' + filter.year_to + '-12-31');
        return 'discover/tv?' + params.join('&');
    }

    function openFilterEditor(currentFilter, onApply) {
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
            if (!filter.languages.length || filter.languages.length === DORAMA_FILTER_LANGUAGES.length) return 'Усі';
            return getSummary(filter.languages, DORAMA_FILTER_LANGUAGES);
        }

        function getSortTitle() {
            var s = DORAMA_FILTER_SORTS.filter(function (x) { return x.id === filter.sort; })[0];
            return s ? s.title : filter.sort;
        }

        function getYearSummary() {
            var from = filter.year_from, to = filter.year_to;
            if (!from && !to) return 'Будь-який';
            if (from && to) return from + '–' + to;
            return from ? 'з ' + from : 'до ' + to;
        }

        // Підмодалка з тоглами (країна / жанри / ключові слова)
        function openSubToggle(title, items, selectedArr, onBack) {
            var wrap = $('<div class="menu-edit-list dr-list"></div>');
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

        // Підмодалка сортування (вибір одразу закриває)
        function openSubSort(onBack) {
            var wrap = $('<div class="menu-edit-list dr-list"></div>');
            DORAMA_FILTER_SORTS.forEach(function (sort) {
                var isSelected = filter.sort === sort.id;
                var row = $('<div class="menu-edit-list__item dorama-sort-row selector' + (isSelected ? '' : ' item-hidden') + '">' +
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

        // Вибір одного року (список з "Будь-який" + роки від поточного до 1990)
        function openYearPicker(title, currentVal, onBack) {
            var wrap = $('<div class="menu-edit-list dr-list"></div>');
            var thisYear = new Date().getFullYear();
            var years = [{ id: 0, title: 'Будь-який' }];
            for (var y = thisYear; y >= 1990; y--) years.push({ id: y, title: String(y) });
            years.forEach(function (year) {
                var isSelected = year.id === currentVal;
                var row = $('<div class="menu-edit-list__item dorama-sort-row selector' + (isSelected ? '' : ' item-hidden') + '">' +
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

        // Підмодалка діапазону років (Від / До)
        function openSubYear(onBack) {
            var wrap = $('<div class="menu-edit-list dr-list"></div>');

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

        // Головне вікно фільтру
        function openMainModal() {
            var wrap = $('<div class="menu-edit-list dr-list"></div>');

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
                openSubToggle('Країна', DORAMA_FILTER_LANGUAGES, filter.languages, openMainModal);
            });

            addNavRow('Жанри', getSummary(filter.genres, DORAMA_FILTER_GENRES) || '—').on('hover:enter', function () {
                Lampa.Modal.close();
                openSubToggle('Жанри', DORAMA_FILTER_GENRES, filter.genres, openMainModal);
            });

            addNavRow('Ключові слова', getSummary(filter.keywords, DORAMA_FILTER_KEYWORDS) || '—').on('hover:enter', function () {
                Lampa.Modal.close();
                openSubToggle('Ключові слова', DORAMA_FILTER_KEYWORDS, filter.keywords, openMainModal);
            });

            addNavRow('Сортування', getSortTitle()).on('hover:enter', function () {
                Lampa.Modal.close();
                openSubSort(openMainModal);
            });

            addNavRow('Рік', getYearSummary()).on('hover:enter', function () {
                Lampa.Modal.close();
                openSubYear(openMainModal);
            });

            var applyBtn = $('<div class="selector folder-reset-button dorama-filter-apply">Застосувати фільтр</div>');
            applyBtn.on('hover:enter', function () {
                Lampa.Storage.set('dorama_filter', filter);
                Lampa.Modal.close();
                if (onApply) onApply(filter);
            });
            wrap.append(applyBtn);

            var resetBtn = $('<div class="selector folder-reset-button">Скинути фільтр</div>');
            resetBtn.on('hover:enter', function () {
                Lampa.Storage.set('dorama_filter', getDefaultFilter());
                Lampa.Modal.close();
                Lampa.Controller.toggle('content');
                Lampa.Noty.show('Фільтр скинуто');
            });
            wrap.append(resetBtn);

            Lampa.Modal.open({
                title: 'Фільтр дорам',
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

    var DoramaHelper = {
        getMediaType: function (item) {
            if (item.media_type) return item.media_type;
            if (item.first_air_date || item.name || item.number_of_seasons) return 'tv';
            return 'movie';
        },

        isLocalized: function (text) {
            return !!text && /[а-яА-ЯіїєґІЇЄҐ]/.test(text);
        },

        extractId: function (id) {
            if (!id) return null;
            var m = String(id).match(/(\d+)/);
            return m ? m[1] : null;
        },

        fetchTMDBTranslations: function (item, callback) {
            var type = this.getMediaType(item);
            var url = Lampa.TMDB.api(type + '/' + item.id + '/translations?api_key=' + Lampa.TMDB.key());
            var net = new Lampa.Reguest();
            net.silent(url, function (data) {
                var tr = (data && data.translations) || [];
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

        getTtl: function () {
            var h = parseInt(Lampa.Storage.get('dorama_cache_ttl', '24'), 10);
            return (isNaN(h) || h <= 0) ? 0 : h * 3600000;
        },

        getCache: function () { return Lampa.Storage.get('dorama_title_cache', {}); },

        // Зберігає всі знайдені назви {uk, ru, en} в кеші
        setCache: function (key, data) {
            var ttl = this.getTtl();
            if (!ttl) return;
            var cache = this.getCache();
            var entry = { timestamp: Date.now() };
            if (data.uk) { entry.uk = data.uk; entry.uk_ov = data.uk_ov || ''; }
            if (data.ru) { entry.ru = data.ru; entry.ru_ov = data.ru_ov || ''; }
            if (data.en) { entry.en = data.en; entry.en_ov = data.en_ov || ''; }
            cache[key] = entry;
            var now = Date.now();
            for (var k in cache) { if (now - cache[k].timestamp > ttl) delete cache[k]; }
            Lampa.Storage.set('dorama_title_cache', cache);
        },

        // Обирає найкращу назву з кешованого запису за поточними налаштуваннями
        applyBestTitle: function (item, entry) {
            var ru_enabled = Lampa.Storage.get('dorama_fallback_ru', true);
            var en_enabled = Lampa.Storage.get('dorama_fallback_en', true);
            var title = null, overview = null;

            if (entry.uk)                    { title = entry.uk; overview = entry.uk_ov; }
            else if (ru_enabled && entry.ru) { title = entry.ru; overview = entry.ru_ov; }
            else if (en_enabled && entry.en) { title = entry.en; overview = entry.en_ov; }
            else if (entry.title)            { title = entry.title; overview = entry.overview; } // старий формат

            if (title) { if (item.name !== undefined) item.name = title; else item.title = title; }
            if (overview) item.overview = overview;
        },

        enrichItem: function (item, callback) {
            var _this = this;
            var id = _this.extractId(item.id || item.tmdb_id);
            var type = _this.getMediaType(item);
            var cacheKey = id + '_' + type;
            var ttl = _this.getTtl();

            if (item.poster_path) item.poster_path = item.poster_path.replace(/^\/+/, '');
            if (item.backdrop_path) item.backdrop_path = item.backdrop_path.replace(/^\/+/, '');
            if (item.img) item.img = item.img.replace(/\/+/g, '/').replace(':/', '://');

            if (ttl) {
                var cached = _this.getCache()[cacheKey];
                if (cached && (Date.now() - cached.timestamp < ttl)) {
                    _this.applyBestTitle(item, cached);
                    return callback();
                }
            }

            var currentTitle = item.name || item.title;
            if (_this.isLocalized(currentTitle) && _this.isLocalized(item.overview)) {
                return callback();
            }

            _this.fetchTMDBTranslations(item, function (tr) {
                var toCache = {};
                if (tr.uk) { toCache.uk = tr.uk.title; toCache.uk_ov = tr.uk.overview || ''; }
                if (tr.ru) { toCache.ru = tr.ru.title; toCache.ru_ov = tr.ru.overview || ''; }
                if (tr.en) { toCache.en = tr.en.title; toCache.en_ov = tr.en.overview || ''; }
                _this.setCache(cacheKey, toCache);
                _this.applyBestTitle(item, toCache);
                callback();
            });
        },

        mapWithLimit: function (items, limit, worker, callback) {
            var index = 0, active = 0, done = 0;
            if (!items.length) return callback();
            function next() {
                if (done >= items.length) { if (callback) callback(); return; }
                while (active < limit && index < items.length) {
                    (function (idx) {
                        active++;
                        worker(items[idx], function () { active--; done++; next(); });
                    })(index++);
                }
            }
            next();
        },

        enrichList: function (list, callback) {
            this.mapWithLimit(list, 8, this.enrichItem.bind(this), callback);
        },

        // Критерій дорами — той самий, що й у самих категоріях цього плагіна:
        // without_genres=16 + with_original_language=ko|zh|ja. Тобто азійський
        // НЕ-анімаційний серіал.
        //
        // Жанр 18 (Drama) свідомо НЕ вимагається, хоч і стоїть у більшості категорій:
        // там він звужує конкретну добірку, а не визначає, що таке дорама. Купа дорам
        // на TMDB узагалі без 18 — напр. "Алхімія душ" це Sci-Fi & Fantasy +
        // Action & Adventure. З вимогою 18 такі серіали просто не потрапляли в ряд.
        //
        // Жанр 16 (Animation) — навпаки, надійний сигнал медіуму: якщо він є, це
        // аніме/донхуа, не дорама (дзеркально до AnimeWorldHelper.isAnimeByGenre).
        //
        // genre_ids на картці зберігається плагіном favorite-fix; свідомо
        // без відкату на саму лише мову за відсутності genre_ids — інакше не
        // відрізнити дораму від аніме тією ж мовою.
        isDoramaByGenre: function (item) {
            if (!Array.isArray(item.genre_ids)) return false;
            if (item.genre_ids.indexOf(16) !== -1) return false;
            var lang = item.original_language;
            return lang === 'ko' || lang === 'zh' || lang === 'ja';
        },

        // Відсоток перегляду останнього релевантного епізоду серіалу — щоб прибрати
        // з "Продовжити перегляд" те, що вже наздогнано (усі випущені серії
        // переглянуто). Рідна стрічка Lampa рахує це сама
        // (ContinueWatch у app.min.js: ongoing -> caught_up при viewed >= 90), але
        // наш ряд будується власним кодом із Favorite, тож ту саму логіку треба
        // повторити тут. Варіант розширений, як в appReplace-патчі до клієнта
        // (favorite-fix/fix_vy_dyvylysya.md) — рідний покриває лише онгоїнги з
        // next_episode_to_air.episode_number > 1, а нам потрібні ще й завершені:
        //
        //   next є, episode_number > 1  -> попередній епізод поточного сезону
        //   next є, episode_number == 1 -> last_episode_to_air (фінал минулого сезону)
        //   next немає, last є          -> last_episode_to_air (завершений серіал)
        //   немає обох                  -> 0 (нема чим міряти, показуємо)
        //
        // last_episode_to_air на картці зберігається завдяки правилу 1 того ж
        // appReplace-патчу (додає поле в card_fields clearCard); без нього метод
        // поверне 0 і поведінка буде як раніше.
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

        // Ряд "Продовжити перегляд": локально, без мережі — з історії перегляду
        // (Favorite), відфільтрованої до дорам за жанром 18 (Drama, без 16) і мовою
        // ko/zh/ja, без вже переглянутого (viewed) чи закинутого (thrown) і без
        // наздогнаних (усі випущені серії переглянуто).
        buildContinueWatchingRow: function () {
            var history = Lampa.Favorite.get({ type: 'history' }) || [];
            if (!history.length) return null;

            var viewed = Lampa.Favorite.get({ type: 'viewed' }) || [];
            var thrown = Lampa.Favorite.get({ type: 'thrown' }) || [];

            var results = history.filter(function (item) {
                if (!DoramaHelper.isDoramaByGenre(item)) return false;
                var isViewed = viewed.some(function (v) { return v.id == item.id; });
                var isThrown = thrown.some(function (t) { return t.id == item.id; });
                if (isViewed || isThrown) return false;
                // той самий поріг, що й у рідній стрічці Lampa
                return DoramaHelper.watchedLastEpisodePercent(item) < CAUGHT_UP_PERCENT;
            }).slice(0, 20);

            if (!results.length) return null;

            return { results: results, title: 'Продовжити перегляд', nomore: true, url: 'dorama:continue_watch' };
        }
    };

    function isDoramaUrl(url) {
        return url &&
            url.indexOf('discover/tv?') === 0 &&
            url.indexOf('without_genres=16') >= 0;
    }

    function patchDoramaActivityRouting() {
        if (!Lampa.Activity || Lampa.Activity._doramaPatched) return;
        var originalPush = Lampa.Activity.push;
        Lampa.Activity.push = function (object) {
            if (object && object.component === 'category_full' && isDoramaUrl(object.url)) {
                object.source = 'dorama';
            }
            return originalPush.apply(this, arguments);
        };
        Lampa.Activity._doramaPatched = true;
    }

    function registerDoramaSource() {
        if (!Lampa.Api || !Lampa.Api.sources || !Lampa.Api.sources.tmdb) return false;
        if (Lampa.Api.sources.dorama) return true;
        patchDoramaActivityRouting();

        var tmdb = Lampa.Api.sources.tmdb;

        Lampa.Api.sources.dorama = {
            main: function (params, oncomplite, onerror) {
                Lampa.Api.sources.dorama.category(params, oncomplite, onerror);
            },
            category: function (params, oncomplite, onerror) {
                var categories = getEnabledCategories();
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
                    var continueRow = DoramaHelper.buildContinueWatchingRow();
                    if (continueRow) rows.unshift(continueRow);
                    if (!rows.length) { if (onerror) onerror(); return; }
                    var all_items = [];
                    rows.forEach(function (r) { all_items = all_items.concat(r.results); });
                    DoramaHelper.enrichList(all_items, function () { oncomplite(rows); });
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
                        DoramaHelper.enrichList(json.results, function () {
                            oncomplite(preparePage(json, params.url, params.page || 1));
                        });
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

    function startPlugin() {
        if (window.plugin_dorama_ready) return;
        window.plugin_dorama_ready = true;

        var styles = [
            '.dr-list.menu-edit-list { padding: 1em; }',
            '.dr-list .menu-edit-list__item { display: flex; align-items: center; margin: 0.3em 0; padding: 0.5em; background: rgba(255,255,255,0.05); border-radius: 5px; }',
            '.dr-list .menu-edit-list__title { flex: 1; min-width: 0; font-size: 1.1em; padding-left: 0.5em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
            '.dr-cat-list .menu-edit-list__title { flex: 1 !important; min-width: 0 !important; max-width: none !important; width: auto !important; }',
            '.dr-btns { display: flex; align-items: center; gap: 0.3em; flex-shrink: 0; margin-left: 0.5em; }',
            '.dr-list .menu-edit-list__move { width: 1.8em; height: 1.8em; display: flex; align-items: center; justify-content: center; cursor: pointer; font-weight: bold; user-select: none; background: rgba(255,255,255,0.1); border-radius: 3px; }',
            '.dr-list .menu-edit-list__move.focus { background: #fff; color: #000; }',
            '.dr-list .menu-edit-list__toggle { width: 1.8em; height: 1.8em; display: flex; align-items: center; justify-content: center; cursor: pointer; border: 2px solid rgba(255,255,255,0.5); border-radius: 3px; }',
            '.dr-list .menu-edit-list__item.selector.focus .menu-edit-list__toggle { border-color: #fff; background: rgba(255,255,255,0.2); }',
            '.dr-list .item-hidden { opacity: 0.4; }',
            '.dr-list .folder-reset-button { background: rgba(200,100,100,0.3); margin-top: 1em; border-radius: 5px; padding: 1em; text-align: center; cursor: pointer; }',
            '.dr-list .folder-reset-button.focus { background: #fff; color: #000; }',
            '.dr-list .filter-section-header { padding: 0.6em 0.5em 0.1em; font-size: 0.8em; font-weight: bold; opacity: 0.6; text-transform: uppercase; letter-spacing: 0.08em; }',
            '.dr-list .dorama-filter-apply { background: rgba(80,180,80,0.3) !important; }',
            '.dr-list .menu-edit-list__item.selector.focus { background: rgba(255,255,255,0.28); border-radius: 5px; }',
            '.dr-list .menu-edit-list__item.selector.focus .menu-edit-list__title { color: #fff; }',
            '.dr-list .dorama-sort-row .menu-edit-list__toggle { border: none; }',
            '.dr-list .menu-edit-list__summary { flex: 2; text-align: right; font-size: 0.85em; opacity: 0.55; padding-right: 0.4em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
            '.dr-list .menu-edit-list__arrow { font-size: 1.4em; line-height: 1; opacity: 0.45; padding-left: 0.2em; flex-shrink: 0; }',
            '.dr-list .menu-edit-list__item.selector.focus .menu-edit-list__summary { opacity: 0.9; }',
            '.dr-list .menu-edit-list__item.selector.focus .menu-edit-list__arrow { opacity: 0.9; }'
        ].join('');
        if (!document.getElementById('dorama-edit-styles')) {
            $('head').append('<style id="dorama-edit-styles">' + styles + '</style>');
        }

        function createSettings() {
            Lampa.SettingsApi.addComponent({
                component: 'dorama_settings',
                name: 'Дорама',
                icon: DORAMA_CONFIG.dorama.icon
            });
            Lampa.SettingsApi.addParam({
                component: 'dorama_settings',
                param: { name: 'dorama_categories_editor', type: 'static' },
                field: { name: 'Відображення та порядок категорій', description: 'Налаштувати список категорій на головній' },
                onRender: function (item) {
                    item.on('hover:enter', function () { openCategoriesEditor(); });
                }
            });

            Lampa.SettingsApi.addParam({
                component: 'dorama_settings',
                param: { name: 'dorama_cache_ttl', type: 'select', values: { '0': 'Вимкнути', '12': '12 годин', '24': '24 години', '48': '48 годин', '72': '72 години', '168': '7 днів', '336': '14 днів', '720': '1 місяць' }, default: '24' },
                field: { name: 'Час зберігання кешу', description: 'Як довго зберігати назви та описи локально' }
            });
            Lampa.SettingsApi.addParam({
                component: 'dorama_settings',
                param: { name: 'dorama_fallback_ru', type: 'trigger', default: true },
                field: { name: 'Пошук російською', description: 'Шукати назви та описи RU при відсутності UK' }
            });
            Lampa.SettingsApi.addParam({
                component: 'dorama_settings',
                param: { name: 'dorama_fallback_en', type: 'trigger', default: true },
                field: { name: 'Пошук англійською', description: 'Шукати назви та описи EN при відсутності UK' }
            });
            Lampa.SettingsApi.addParam({
                component: 'dorama_settings',
                param: { name: 'dorama_clear_cache', type: 'static' },
                field: { name: 'Очистити кеш метаданих', description: 'Видалити всі збережені назви та описи' },
                onRender: function (item) {
                    item.on('hover:enter', function () {
                        Lampa.Storage.set('dorama_title_cache', {});
                        Lampa.Noty.show('Кеш метаданих очищено');
                        refreshIfActive();
                    });
                }
            });
        }

        function addMenuButton(attempt) {
            var menu = $('.menu .menu__list').eq(0);
            if (!menu.length) {
                if ((attempt || 0) < 40) {
                    setTimeout(function () { addMenuButton((attempt || 0) + 1); }, 250);
                }
                return;
            }
            if (menu.find('.menu__item[data-sid="dorama"]').length) return;

            var btn = $('<li class="menu__item selector" data-action="dorama_action" data-sid="dorama">' +
                '<div class="menu__ico">' + DORAMA_CONFIG.dorama.icon + '</div>' +
                '<div class="menu__text">' + DORAMA_CONFIG.dorama.title + '</div>' +
                '</li>');

            btn.on('hover:enter', function () {
                registerDoramaSource();
                Lampa.Activity.push({
                    title: DORAMA_CONFIG.dorama.title,
                    component: 'category',
                    source: 'dorama',
                    url: 'tv',
                    card_type: true,
                    page: 1
                });
            });

            menu.append(btn);
        }

        function addFilterButton() {
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
                var savedFilter = Lampa.Storage.get('dorama_filter', getDefaultFilter());
                openFilterEditor(savedFilter, function (filter) {
                    Lampa.Activity.push({
                        title: 'Фільтр',
                        component: 'category_full',
                        source: 'dorama',
                        url: buildFilterUrl(filter),
                        dorama_filter: true,
                        card_type: true,
                        page: 1
                    });
                });
            });

            $('.head .open--search').after(button);

            function isFilterActivity(obj) {
                if (!obj) return false;
                if (obj.component === 'category' && obj.source === 'dorama') return true;
                if (obj.component !== 'category_full' || obj.source !== 'dorama') return false;
                if (obj.dorama_filter) return true;
                // Після перезавантаження сторінки: dorama_filter не зберігається в URL — порівнюємо URL
                var saved = Lampa.Storage.get('dorama_filter', null);
                return !!(saved && obj.url === buildFilterUrl(saved));
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

        if (window.appready) {
            registerDoramaSource();
            addMenuButton();
            createSettings();
            addFilterButton();
        } else {
            Lampa.Listener.follow('app', function (e) {
                if (e.type == 'ready') {
                    registerDoramaSource();
                    addMenuButton();
                    createSettings();
                    addFilterButton();
                }
            });
        }
    }

    if (!window.plugin_dorama_ready) startPlugin();
})();
