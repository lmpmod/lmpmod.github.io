(function () {
    'use strict';

    /**
     *  alt-names v1.1
     *
     *  Історія версій:
     *   1.1 — регістронезалежне порівняння `type` транслітерацій: TMDB віддає
     *         "romanization" з малої, а список був з великої, тож збіг не
     *         спрацьовував ніколи (напр. movie/550 → RU "Boytsovskiy klub").
     *   1.0 — початкова версія.
     *
     *  Додає альтернативні назви фільму/серіалу різними мовами в меню "Уточнити"
     *  при пошуку — і в торентах, і в онлайн-балансерах (lampac).
     *
     *  Працює через одне поле — movie.names, яке штатний Lampa.Filter показує
     *  окремим блоком "Альтернативні назви". Заповнюється при відкритті повної
     *  картки, тому діє скрізь, куди ця картка потім передається.
     *
     *  Повний опис — README.md поруч із цим файлом.
     */

    if (window.alt_names_loaded) return;
    window.alt_names_loaded = true;

    var CACHE_KEY = 'alt_names_cache';
    var CACHE_TTL = 30 * 24 * 60 * 60 * 1000; // 30 днів: назви практично не змінюються

    // Мови задаються ОДНИМ полем — списком кодів через кому. Окремих перемикачів
    // на мову навмисно немає: поле дає і вибір, і порядок показу, і будь-які коди
    // без обмеження набором. За замовчуванням порожнє — тобто плагін не додає
    // жодної мовної назви, поки користувач сам не вкаже потрібні.
    var DEFAULTS = {
        alt_names_langs: '',
        alt_names_translit: true,
        alt_names_alternative: false
    };

    // Типи транслітерації в alternative_titles (поле `type`). Найцінніше для
    // трекерів: "환혼" там не знайдеш, а "Hwanhon" — так. Список запозичений
    // з title-mod.js, який використовує його для показу Romaji на картці.
    //
    // Значення тут ТІЛЬКИ в нижньому регістрі, а порівняння йде через
    // .toLowerCase(): у TMDB поле `type` вільне, редактори пишуть його
    // як заманеться, і реально трапляється саме "romanization" з малої
    // (напр. movie/550 → RU "Boytsovskiy klub", UA "Biytsivsʹkyy klub").
    var TRANSLIT_TYPES = [
        'transliteration', 'romaji', 'romanization', 'latynization',
        'pinyin', 'kana', 'romaji_japanese', 'romaji_korean', 'romaji_chinese',
        'latinization'
    ];

    // Не-латинські писемності: кирилиця, кана, CJK, хангиль, арабська, тайська,
    // деванагарі, іврит, грецька. Потрібно, щоб упізнати транслітерацію в
    // alternative_titles, коли TMDB не проставив полю `type` значення.
    var NON_LATIN = /[Ѐ-ӿ぀-ヿ㐀-䶿一-鿿豈-﫿가-힯؀-ۿ฀-๿ऀ-ॿ֐-׿Ͱ-Ͽ]/;

    // Мова -> країни, для запасного пошуку назви в alternative_titles, коли
    // translations для цієї мови нічого не дав. Для мов поза списком береться
    // код у верхньому регістрі (pl -> PL, de -> DE).
    var LANG_COUNTRIES = {
        en: ['US', 'GB'],
        uk: ['UA'],
        ru: ['RU'],
        ja: ['JP'],
        ko: ['KR'],
        zh: ['CN', 'TW', 'HK'],
        cs: ['CZ'],
        da: ['DK'],
        el: ['GR'],
        et: ['EE'],
        sv: ['SE'],
        he: ['IL'],
        fa: ['IR']
    };

    function setting(name) {
        return Lampa.Storage.get(name, DEFAULTS[name]);
    }

    // Lampa.SettingsApi.addParam({type:'trigger'}) сам у Storage нічого не пише,
    // тож дефолти проставляємо явно — інакше перший запуск бачить undefined.
    function ensureDefaults() {
        for (var key in DEFAULTS) {
            if (Lampa.Storage.get(key, '__none__') === '__none__') {
                Lampa.Storage.set(key, DEFAULTS[key]);
            }
        }
    }

    function addSettings() {
        Lampa.SettingsApi.addComponent({
            component: 'alt_names',
            name: 'Альтернативні назви',
            icon: '<svg height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M12.87 15.07l-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7l1.62-4.33L19.12 17h-3.24z" fill="currentColor"/></svg>'
        });

        // values і default обовʼязкові навіть для порожнього input: SettingsApi
        // реєструє їх через Params.select(name, values, default), а Params.update()
        // потім робить values[name][key] — на undefined це падає з
        // "Cannot read properties of undefined (reading 'undefined')" і ламає
        // відкриття всього розділу налаштувань. values:'' (рядок) вмикає в update()
        // гілку, яка просто показує збережене значення.
        Lampa.SettingsApi.addParam({
            component: 'alt_names',
            param: { name: 'alt_names_langs', type: 'input', values: '', default: '', placeholder: 'напр. en,pl,de' },
            field: {
                name: 'Додаткові мови',
                description: 'Коди мов через кому, у тому порядку, в якому показувати: en — англійська, uk — українська, pl, de, fr тощо. Порожньо — мовних назв не додається'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'alt_names',
            param: { name: 'alt_names_translit', type: 'trigger', default: DEFAULTS.alt_names_translit },
            field: {
                name: 'Транслітерація',
                description: 'Латинкою: Romaji для японської, Pinyin для китайської тощо. Для азійського контенту часто єдиний варіант, під яким реліз знайдеться на трекері'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'alt_names',
            param: { name: 'alt_names_alternative', type: 'trigger', default: DEFAULTS.alt_names_alternative },
            field: {
                name: 'Альтернативні написання',
                description: 'Додавати ще й alternative_titles — робочі та прокатні назви. Показуються лише для країн обраних мов і країни оригіналу, бо в цьому списку TMDB немає поля мови, лише країна'
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'alt_names',
            param: { name: 'alt_names_clear', type: 'button', default: '' },
            field: {
                name: 'Очистити кеш',
                description: 'Назви кешуються на 30 днів. Скидати треба лише якщо змінив набір мов і хочеш побачити результат одразу на вже відкритих картках'
            },
            onChange: function () {
                Lampa.Storage.set(CACHE_KEY, {});
                Lampa.Noty.show('Кеш альтернативних назв очищено');
            }
        });
    }

    // Коди мов у порядку, вказаному користувачем у полі "Мови"
    function wantedLangs() {
        var raw = (Lampa.Storage.get('alt_names_langs', '') || '').trim();
        if (!raw) return [];

        var list = [];

        raw.split(',').forEach(function (code) {
            code = code.trim().toLowerCase();
            if (code && list.indexOf(code) === -1) list.push(code);
        });

        return list;
    }

    function getCache() {
        return Lampa.Storage.get(CACHE_KEY, {});
    }

    function readCache(key) {
        var cache = getCache();
        var item = cache[key];
        if (item && item.time && (Date.now() - item.time) < CACHE_TTL) return item.names;
        return null;
    }

    function writeCache(key, names) {
        var cache = getCache();
        var now = Date.now();

        // принагідно чистимо протухле, щоб ключ не ріс нескінченно
        for (var k in cache) {
            if (!cache[k].time || (now - cache[k].time) >= CACHE_TTL) delete cache[k];
        }

        cache[key] = { names: names, time: now };
        Lampa.Storage.set(CACHE_KEY, cache);
    }

    function mediaType(movie) {
        if (movie.media_type) return movie.media_type;
        if (movie.name || movie.first_air_date || movie.number_of_seasons) return 'tv';
        return 'movie';
    }

    // Ставить назву з картки першою в списку. Свідомо ПОЗА кешем: плагіни на
    // кшталт animeworld і dorama підмінюють movie.name/title даними з Hikka,
    // Shikimori чи Jikan, і в кеш могла б осісти ще незбагачена назва.
    function withCardTitle(movie, names) {
        // Для серіалів канонічне поле — name, для фільмів — title. Порядок тут
        // принциповий: збагачення в animeworld/dorama пише саме в name, а в title
        // часто лишається англійська назва з TMDB. Якби брали title наперед, для
        // серіалів показувалася б англійська замість збагаченої локалізованої.
        var is_tv = mediaType(movie) === 'tv';
        var primary = ((is_tv ? movie.name : movie.title) || '').trim();
        var secondary = ((is_tv ? movie.title : movie.name) || '').trim();

        // Обидві назви з картки корисні: одна локалізована (часто збагачена),
        // друга зазвичай англійська. Ставимо на початок, primary першою.
        var head = [];
        if (primary) head.push(primary);
        if (secondary && secondary !== primary) head.push(secondary);

        if (!head.length) return names;

        var rest = names.filter(function (n) { return head.indexOf(n) === -1; });

        return head.concat(rest);
    }

    // movie.names робимо ГЕТТЕРОМ, а не звичайним полем. Причина: збагачення
    // назви в animeworld/dorama асинхронне (запити до Hikka, Shikimori, Jikan
    // тривають секунди) і відбувається на тій самій події full/complite, що й
    // наше заповнення — тобто цілком може завершитись ПІЗНІШЕ. Звичайне поле
    // зафіксувало б назву станом на момент запису й збагачення б не побачило.
    // Геттер натомість читає movie.title/name у момент, коли Lampa.Filter
    // будує меню "Уточнити" — там назва вже точно актуальна.
    function setNames(movie, network_names) {
        try {
            Object.defineProperty(movie, 'names', {
                configurable: true,
                enumerable: true,
                get: function () {
                    return withCardTitle(movie, network_names);
                }
            });
        }
        catch (e) {
            // якщо властивість чомусь не переозначити — лишаємо звичайне поле
            movie.names = withCardTitle(movie, network_names);
        }
    }

    // Збирає назви з відповіді TMDB. Порядок:
    //   1. назва з картки (може бути збагачена іншим плагіном)
    //   2. офіційний переклад TMDB мовою інтерфейсу
    //   3. переклади в порядку поля "Додаткові мови"
    //   4. альтернативні написання для дозволених країн
    //   5. транслітерації з явним type
    //   6. транслітерації без type (за евристикою)
    //
    // Оригінальна й локалізована назви навмисно НЕ додаються: Lampa й так показує
    // їх у блоці "Комбінації" того ж меню (склейки search_one/search_two з роком).
    // Плагін додає лише те, чого без нього не було б — інакше в меню були б
    // дублікати.
    function collectNames(movie, result, langs) {
        var names = [];

        // Уже показане Lampa — не дублюємо, але враховуємо при перевірці збігів
        var known = [];
        [movie.original_title, movie.original_name, movie.title, movie.name].forEach(function (v) {
            if (v) known.push(('' + v).trim());
        });

        // force — дозволяє додати назву, навіть якщо вона збігається з тим, що
        // Lampa вже показує в "Комбінаціях". Потрібно лише для локалізованої назви
        // (пункт 1): її зручно мати першою в блоці, не шукаючи серед комбінацій.
        // Захист від дублів усередині самого блоку лишається в будь-якому разі.
        function push(value, force) {
            if (!value) return;
            value = ('' + value).trim();
            if (!value) return;
            if (!force && known.indexOf(value) !== -1) return;
            if (names.indexOf(value) !== -1) return;
            names.push(value);
        }

        var is_tv = mediaType(movie) === 'tv';
        var translations = (result && result.translations && result.translations.translations) || [];
        // для tv поле зветься results, для movie — titles
        var alt = (result && result.alternative_titles &&
            (result.alternative_titles.results || result.alternative_titles.titles)) || [];

        // Додає переклад для однієї мови. Якщо офіційного перекладу немає —
        // запасний варіант із alternative_titles за країною цієї мови.
        // Повертає true, якщо щось додалося.
        function pushTranslation(code, force) {
            if (!code) return false;

            var before = names.length;

            translations.forEach(function (tr) {
                // Перевіряємо обидва коди: у translations трапляються записи, де
                // мова задана лише через країну (прийом із title-mod.js).
                if (tr.iso_639_1 !== code) return;
                var data = tr.data || {};
                push(is_tv ? (data.name || data.title) : (data.title || data.name), force);
            });

            if (names.length === before) {
                var countries = LANG_COUNTRIES[code] || [code.toUpperCase()];
                alt.forEach(function (a) {
                    if (countries.indexOf((a.iso_3166_1 || '').toUpperCase()) !== -1) push(a.title, force);
                });
            }

            return names.length > before;
        }

        // 1. Назву з самої картки тут НЕ додаємо — її підставляє setNames()/withCardTitle()
        //    поза кешем (див. коментар там).

        // 2. Офіційний переклад TMDB мовою інтерфейсу. Якщо збігається з назвою
        //    на картці — відсіється як дублікат; у список потрапляє лише коли
        //    справді відрізняється (напр. картку збагатив інший плагін).
        pushTranslation(Lampa.Storage.field('language'), true);

        // 3. Мови з поля "Додаткові мови" — саме в тому порядку, що вказав
        //    користувач, а не в порядку відповіді TMDB.
        //    Обгортка, а не langs.forEach(pushTranslation): forEach передав би
        //    індекс другим аргументом, і з другої мови force став би truthy.
        langs.forEach(function (code) { pushTranslation(code); });

        // 4. Альтернативні написання — лише для країн, повʼязаних із цим тайтулом і
        // з мовами, які цікавлять користувача. У alternative_titles немає поля
        // мови, є тільки iso_3166_1, тож фільтруємо за країною — інакше сюди
        // сиплеться весь світовий прокат (20-50 назв) і меню стає нечитабельним.
        // Вивести їх у кінець усього меню, після "Комбінацій", не вийде: порядок
        // блоків жорстко заданий у Lampa.Filter.selectSearch().
        if (setting('alt_names_alternative')) {
            var allowed = [];

            function allow(country) {
                country = (country || '').toUpperCase();
                if (country && allowed.indexOf(country) === -1) allowed.push(country);
            }

            function allowByLang(code) {
                if (!code) return;
                (LANG_COUNTRIES[code] || [code.toUpperCase()]).forEach(allow);
            }

            // мови з налаштувань
            langs.forEach(allowByLang);

            // мова інтерфейсу — користувач не має вписувати її вручну
            allowByLang(Lampa.Storage.field('language'));

            // країна й мова оригіналу: там лежать питомі написання назви
            (movie.origin_country || []).forEach(allow);
            allowByLang(movie.original_language);

            alt.forEach(function (a) {
                if (allowed.indexOf((a.iso_3166_1 || '').toUpperCase()) !== -1) push(a.title);
            });
        }

        if (setting('alt_names_translit')) {
            // 5. Транслітерації з явно вказаним типом
            alt.forEach(function (a) {
                if (a.type && TRANSLIT_TYPES.indexOf(a.type.toLowerCase()) !== -1) push(a.title);
            });

            // 6. Транслітерації без типу: TMDB часто лишає `type` порожнім навіть
            //    для очевидної романізації. Приклад — tv/127529 "사냥개들", де
            //    alternative_titles має KR: "Sanyanggaedeul" з type: "".
            //    Розпізнаємо за ознакою: оригінал НЕ латиницею, а назва для країни
            //    оригіналу — латиницею.
            var orig_name = movie.original_name || movie.original_title || '';
            if (NON_LATIN.test(orig_name)) {
                var orig_countries = (movie.origin_country && movie.origin_country.length)
                    ? movie.origin_country
                    : (LANG_COUNTRIES[movie.original_language] || []);

                alt.forEach(function (a) {
                    if (a.type && TRANSLIT_TYPES.indexOf(a.type.toLowerCase()) !== -1) return; // вже додали вище
                    if (orig_countries.indexOf((a.iso_3166_1 || '').toUpperCase()) === -1) return;
                    if (a.title && !NON_LATIN.test(a.title)) push(a.title);
                });
            }
        }

        return names;
    }

    function fillNames(movie) {
        if (!movie || !movie.id) return;

        var langs = wantedLangs();
        if (!langs.length && !setting('alt_names_translit') && !setting('alt_names_alternative')) return;

        var type = mediaType(movie);
        // Ключ кешу включає набір мов і обидва прапорці: зміна налаштувань має
        // давати новий результат, а не віддавати старий список із кешу.
        // Мова інтерфейсу теж у ключі: вона впливає на набір країн для
        // альтернативних написань, тож після її зміни потрібен свіжий список.
        var key = type + '_' + movie.id + '_' + langs.join('-') +
            '_' + (Lampa.Storage.field('language') || '') +
            (setting('alt_names_translit') ? '_tl' : '') +
            (setting('alt_names_alternative') ? '_alt' : '');

        var cached = readCache(key);
        if (cached) {
            setNames(movie, cached);
            return;
        }

        // alternative_titles запитуємо завжди: вони потрібні і для транслітерації,
        // і як запасне джерело назв для мов, яких немає в translations.
        var url = Lampa.TMDB.api(type + '/' + movie.id + '?api_key=' + Lampa.TMDB.key() + '&language=en&append_to_response=translations,alternative_titles');

        var network = new Lampa.Reguest();

        network.silent(url, function (result) {
            try {
                var names = collectNames(movie, result, langs);

                // У кеш — лише мережева частина, без назви з картки
                if (names.length) writeCache(key, names);

                setNames(movie, names);
            } catch (e) {}
        }, function () {});
    }

    function startPlugin() {
        ensureDefaults();
        addSettings();

        // Заповнюємо movie.names на повній картці — саме цей об'єкт передається
        // далі і в торенти (Activity.push({movie: _this.card})), і в онлайн
        // (lampac plugin.js: Activity.push({movie: e.movie}) з e.data.movie),
        // без клонування. А штатний Lampa.Filter, спільний для обох компонентів,
        // показує movie.names блоком "Альтернативні назви".
        Lampa.Listener.follow('full', function (e) {
            if (e.type !== 'complite') return;
            if (!e.data || !e.data.movie) return;
            fillNames(e.data.movie);
        });
    }

    var timer = setInterval(function () {
        if (typeof Lampa === 'undefined') return;
        if (!Lampa.SettingsApi || !Lampa.Listener || !Lampa.TMDB || !Lampa.Reguest) return;
        clearInterval(timer);
        startPlugin();
    }, 100);
})();
