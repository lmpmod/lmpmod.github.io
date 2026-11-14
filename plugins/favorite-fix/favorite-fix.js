(function () {
    'use strict';

    /**
     *  favorite-fix v1.4.0
     *
     *  Три частини:
     *
     *  1. Патч Lampa.Utils.clearCard — щоб на картках Favorite (історія, закладки)
     *     не губились два поля, які Lampa інакше зрізає при кожному збереженні:
     *       - genre_ids           — без нього не відфільтрувати історію за жанром;
     *       - last_episode_to_air — без нього не знати, де фінал серіалу.
     *  2. Три патчі для стрічки "Продовжити перегляд":
     *       - patchCaughtUp        — розширює Favorite.caughtUp (використовується
     *                                новим judge() Siaivo) підтримкою last_episode_to_air
     *                                для завершених багатосезонних серіалів.
     *       - patchContinues       — запобіжник для Favorite.continues() (fallback-шлях
     *                                коли TimeTable недоступний, фільми).
     *       - patchContentRowsCall — запобіжник на рівні ContentRows (останній рубіж,
     *                                незалежний від внутрішньої реалізації рядка).
     *  3. Пункт налаштувань "Виправити старі картки" — дозаповнює з TMDB ті
     *     картки, що були збережені до встановлення плагіна (патчі на них не діють).
     */

    if (window.favorite_fix_loaded) return;
    window.favorite_fix_loaded = true;

    // Ті самі категорії, що й у Lampa.Favorite (favorite.js, масив category)
    var CATEGORY_KEYS = ['like', 'wath', 'book', 'history', 'look', 'viewed', 'scheduled', 'continued', 'thrown'];

    // Міграція навмисно продовжується у фоні, навіть якщо закрити вікно прогресу
    // (дані зберігаються після кожної картки, обривати нема сенсу). Але тоді пункт
    // налаштувань можна натиснути ще раз — цей прапорець не дає запустити другий
    // паралельний прогін: подвійні запити до TMDB і два ланцюги записів у той самий
    // Favorite.
    var migration_running = false;

    // Скільки чекати після останньої картки, перш ніж рапортувати "Готово" — щоб
    // асинхронні POST /bookmark/add від bookmark.js устигли долетіти до сервера
    // (детальніше — коментар у next()).
    var SYNC_GRACE_MS = 4000;

    // Відсоток перегляду останнього епізоду, з якого серіал вважається наздогнаним.
    // Те саме значення, що в рідному коді Lampa (ContinueWatch: viewed >= 90).
    var CAUGHT_UP_PERCENT = 90;

    // ── Частина 1: патч Lampa.Utils.clearCard ────────────────────────────────
    //
    // Патч працює, бо window.Lampa.Utils — та сама посилання на внутрішній об'єкт
    // Utils$1, а всі внутрішні виклики зроблені як Utils$1.clearCard(...) —
    // через об'єкт, не через локальну копію. Перевизначення властивості їх перехоплює.
    function patchClearCard() {
        if (!Lampa.Utils || typeof Lampa.Utils.clearCard !== 'function') return;
        if (Lampa.Utils.clearCard.__favorite_fix_patched) return; // ідемпотентність

        var original = Lampa.Utils.clearCard;

        var patched = function (card) {
            var result = original.apply(this, arguments);
            if (!card || !result) return result;

            // genre_ids — домаплюємо з genres (поле з іншою назвою на повній картці)
            if ((!result.genre_ids || !result.genre_ids.length) && Array.isArray(card.genres)) {
                result.genre_ids = card.genres.map(function (g) { return g.id; });
            }

            // last_episode_to_air — у card_fields його немає взагалі
            if (!result.last_episode_to_air && card.last_episode_to_air) {
                result.last_episode_to_air = card.last_episode_to_air;
            }

            return result;
        };

        patched.__favorite_fix_patched = true;
        Lampa.Utils.clearCard = patched;
    }

    // ── Частина 2: патч Lampa.Favorite.continues + ContentRows.call ─────────────
    //
    // Прибирає з "Продовжити перегляд" серіали, які вже наздогнано — всі випущені
    // серії переглянуто.
    //
    // Чому два рівні патчу:
    //
    //  a) patchContinues — патчує Lampa.Favorite.continues() (публічний API).
    //     Покриває: outer-guard рядка (якщо continues() повертає [], рядок не
    //     з'являється взагалі), MSX-плитки, всі зовнішні виклики continues().
    //     НЕ покриває: кастомну реєстрацію рядка Siaivo (app.min.js), де inner-
    //     функція ігнорує outer results і сама будує список з Favorite.get
    //     ({type:'history'}). Той рядок фільтрує лише онгоїнги з
    //     next_episode_to_air.episode_number > 1, а завершені серіали (де
    //     next_episode_to_air відсутній або порожній рядок) залишає.
    //
    //  b) patchContentRowsCall — обгортає кожен callback, що ContentRows.call
    //     вставляє в масив parts_data. Коли стрічка рендериться і callback
    //     повертає {title:'Продовжити перегляд', results:[...]}, фільтруємо results.
    //     Це перехоплення не залежить від внутрішньої реалізації рядка, тому
    //     працює з будь-якою версією Siaivo (оригінальна main, форк, кастомне
    //     сортування).
    //
    // Замінює appReplace-правило №2 з fix_vy_dyvylysya.md.
    // Повертає true, якщо тайтл вважається «наздогнаним» (показувати не треба).
    //
    // Фільми:   перевіряємо Timeline.view по original_title-хешу.
    // Серіали:
    //   next є, нова серія ще не вийшла (або дата невідома):
    //     episode_number > 1  -> попередній епізод
    //     episode_number == 1 -> last_episode_to_air (фінал минулого сезону)
    //   next є, нова серія вже вийшла -> перевіряємо саму нову серію
    //   next немає, last є   -> last_episode_to_air (ЗАВЕРШЕНИЙ серіал)
    //   Fallback 1-сезонний  -> season 1, number_of_episodes
    //
    // last_episode_to_air зберігається патчем clearCard; для старих карток — міграцією.
    function isCardCaughtUp(card) {
        if (!Lampa.Timeline) return false;

        var is_tv = card.number_of_seasons || card.first_air_date;

        // ── Фільми ──────────────────────────────────────────────────────────────
        if (!is_tv) {
            if (Lampa.Timeline.watched) return Lampa.Timeline.watched(card) >= CAUGHT_UP_PERCENT;
            if (!Lampa.Timeline.view || !card.original_title) return false;
            var v = Lampa.Timeline.view(Lampa.Utils.hash(card.original_title));
            return !!(v && v.percent >= CAUGHT_UP_PERCENT);
        }

        // ── Серіали ─────────────────────────────────────────────────────────────
        if (!Lampa.Timeline.watchedEpisode) return false;

        var next = card.next_episode_to_air;
        var last = card.last_episode_to_air;
        var now  = Date.now();

        if (next) {
            var nextAir = next.air_date ? Lampa.Utils.parseToDate(next.air_date).getTime() : 0;
            if (!nextAir || nextAir > now) {
                // Нова серія ще не вийшла: перевіряємо попередній епізод
                if (next.episode_number > 1)
                    return Lampa.Timeline.watchedEpisode(card, next.season_number, next.episode_number - 1) >= CAUGHT_UP_PERCENT;
                if (last)
                    return Lampa.Timeline.watchedEpisode(card, last.season_number, last.episode_number) >= CAUGHT_UP_PERCENT;
            } else {
                // Нова серія вже в ефірі: перевіряємо, чи подивився користувач її саму
                return Lampa.Timeline.watchedEpisode(card, next.season_number, next.episode_number) >= CAUGHT_UP_PERCENT;
            }
            return false;
        }

        if (last)
            return Lampa.Timeline.watchedEpisode(card, last.season_number, last.episode_number) >= CAUGHT_UP_PERCENT;

        // Fallback для 1-сезонних без last_episode_to_air
        if (card.number_of_seasons === 1 && card.number_of_episodes)
            return Lampa.Timeline.watchedEpisode(card, 1, card.number_of_episodes) >= CAUGHT_UP_PERCENT;

        return false;
    }

    function patchContinues() {
        if (!Lampa.Favorite || typeof Lampa.Favorite.continues !== 'function') return;
        if (Lampa.Favorite.continues.__favorite_fix_patched) return;

        var original = Lampa.Favorite.continues;

        var patched = function () {
            var result = original.apply(this, arguments);
            if (!Array.isArray(result)) return result;

            return result.filter(function (card) {
                return !isCardCaughtUp(card);
            });
        };

        patched.__favorite_fix_patched = true;
        Lampa.Favorite.continues = patched;
    }

    // Розширює Favorite.caughtUp (використовується judge() у новому Siaivo)
    // підтримкою last_episode_to_air для завершених багатосезонних серіалів.
    // lastAired() у Siaivo повертає null для таких серіалів, тому без цього патчу
    // judge() не приховує їх і вони залишаються у стрічці.
    function patchCaughtUp() {
        if (!Lampa.Favorite || typeof Lampa.Favorite.caughtUp !== 'function') return;
        if (Lampa.Favorite.caughtUp.__favorite_fix_patched) return;

        var original = Lampa.Favorite.caughtUp;

        var patched = function (card) {
            if (original.apply(this, arguments)) return true;
            if (!Lampa.Timeline || !Lampa.Timeline.watchedEpisode) return false;
            var last = card.last_episode_to_air;
            if (!last) return false;
            return Lampa.Timeline.watchedEpisode(card, last.season_number, last.episode_number) >= CAUGHT_UP_PERCENT;
        };

        patched.__favorite_fix_patched = true;
        Lampa.Favorite.caughtUp = patched;
    }

    // Перехоплює ContentRows.call і обгортає кожен callback стрічки
    // "Продовжити перегляд" фільтром caught-up карток.
    // Резервний рівень: покриває fallback-шлях (коли TimeTable недоступний і
    // Siaivo падає на Favorite.continues()) та старі версії Siaivo без judge().
    //
    // ВАЖЛИВО: ContentRows використовує Arrays.insert (не push), тому нові
    // callbacks вставляються на довільні позиції (index: 0 → на початок).
    // Snapshot дозволяє знайти їх незалежно від позиції.
    function patchContentRowsCall() {
        if (!Lampa.ContentRows || typeof Lampa.ContentRows.call !== 'function') return;
        if (Lampa.ContentRows.call.__favorite_fix_patched) return;

        var original = Lampa.ContentRows.call;

        var patched = function (screen, params, calls) {
            var snapshot = calls.slice(); // знімок до виклику
            original.apply(this, arguments);

            // Знаходимо нові елементи, порівнюючи зі знімком
            for (var i = 0; i < calls.length; i++) {
                var fn = calls[i];
                if (typeof fn !== 'function') continue;
                if (snapshot.indexOf(fn) !== -1) continue; // вже існував
                (function (origFn, idx) {
                    calls[idx] = function (call) {
                        origFn(function (data) {
                            if (data && Array.isArray(data.results) && Lampa.Lang &&
                                data.title === Lampa.Lang.translate('title_continue')) {
                                data.results = data.results.filter(function (card) {
                                    return !isCardCaughtUp(card);
                                });
                            }
                            call(data);
                        });
                    };
                })(fn, i);
            }
        };

        patched.__favorite_fix_patched = true;
        Lampa.ContentRows.call = patched;
    }

    // ── Частина 3: міграція старих карток ────────────────────────────────────

    function addSettings() {
        if (!Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: 'favorite_fix',
            name: 'Favorite Fix',
            icon: '<svg height="24" viewBox="0 0 24 24" width="24" xmlns="http://www.w3.org/2000/svg"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z" fill="currentColor"/></svg>'
        });

        // type:'button' + onChange — штатний шлях (той самий, що в channels_sort.js).
        // НЕ type:'static' з власним item.on('hover:enter click') — див. README.md,
        // розділ "Три правила UI".
        Lampa.SettingsApi.addParam({
            component: 'favorite_fix',
            param: { name: 'favorite_fix_migrate', type: 'button', default: '' },
            field: {
                name: 'Виправити старі картки',
                description: 'Домаплює жанр (genre_ids), а серіалам — last_episode_to_air і статус, для карток історії/закладок, збережених до встановлення плагіна. Новим карткам це вже не потрібно.'
            },
            onChange: openConfirmModal
        });
    }

    // Повертаємо керування в налаштування, звідки прийшли (так само робить
    // channels_sort.js), а НЕ в 'content': Controller.toggle('content') запускає
    // toContent() (core/controller.js), який навмисно "згортає все" — до 10 разів
    // смикає back() поточного контролера й примусово знімає settings--open з body.
    // З відкритих налаштувань це лишає керування в поламаному стані (на TV "назад"
    // потім потрапляє в меню Вихід).
    function closeModal() {
        Lampa.Modal.close();
        Lampa.Controller.toggle('settings_component');
    }

    function openConfirmModal() {
        if (migration_running) {
            Lampa.Noty.show('Виправлення вже виконується — дочекайтесь завершення.');
            return;
        }

        Lampa.Modal.open({
            title: 'Виправлення карток',
            html: $('<div class="about" style="padding:10px;font-size:1.2em;line-height:1.4;">Пройде по історії та закладках і для карток, яким бракує даних, запросить їх з TMDB (по одному запиту на картку, з паузою між запитами). Дописує жанр (genre_ids), а серіалам — інформацію про останній вийшовший епізод і статус. Оновлені картки одразу зберігаються локально й, якщо на цьому пристрої активна синхронізація з lampac, надсилаються на сервер тим самим шляхом, що й звичайне додавання в закладки.</div>'),
            buttons: [
                {
                    name: 'Запустити',
                    onSelect: function () {
                        // Закриваємо цю модалку й відкриваємо окрему для прогресу —
                        // замість підміни вмісту тієї самої (Lampa.Modal.update()
                        // зніс би й кнопки buttons:, лишивши вікно без цілі фокуса).
                        Lampa.Modal.close();
                        openProgressModal();
                    }
                },
                { name: 'Скасувати', onSelect: closeModal }
            ],
            onBack: closeModal
        });
    }

    function openProgressModal() {
        var $progress = buildProgressHtml();

        Lampa.Modal.open({
            title: 'Виправлення карток',
            html: $progress,
            buttons: [
                { name: 'Закрити', onSelect: closeModal }
            ],
            onBack: closeModal
        });

        startMigration($progress);
    }

    function buildProgressHtml() {
        return $(
            '<div style="padding:10px 6px;">' +
                '<div class="ffx-status" style="font-size:1.15em;line-height:1.4;margin-bottom:14px;">Підготовка…</div>' +
                '<div style="height:10px;border-radius:5px;background:rgba(255,255,255,.15);overflow:hidden;">' +
                    '<div class="ffx-bar" style="height:100%;width:0%;background:#41a4f5;transition:width .2s linear;"></div>' +
                '</div>' +
                '<div class="ffx-current" style="font-size:.85em;opacity:.6;margin-top:10px;"></div>' +
            '</div>'
        );
    }

    function updateProgress($body, processed, total, patched, failed, card) {
        var pct = total ? Math.round(processed / total * 100) : 100;
        $body.find('.ffx-status').text('Оброблено ' + processed + ' з ' + total + ' (' + pct + '%)');
        $body.find('.ffx-bar').css('width', pct + '%');
        var title = card ? (card.name || card.title || card.original_name || card.original_title || '') : '';
        $body.find('.ffx-current').text('Виправлено: ' + patched + ' · без результату: ' + failed + (title ? ' · остання: ' + title : ''));
    }

    function guessMediaType(card) {
        if (card.media_type) return card.media_type;
        if (card.first_air_date || card.name || card.number_of_seasons) return 'tv';
        return 'movie';
    }

    function isTvShow(card) {
        return !!(card.number_of_seasons || card.first_air_date || (!card.release_date && !card.title));
    }

    // Чи бракує картці бодай чогось із того, що ми вміємо дописати. Обидві перевірки
    // тут навмисно разом: дані для них приходять з ОДНОГО запиту до TMDB, тож немає
    // сенсу ганяти картку двічі.
    function needsFix(card) {
        if (!card.genre_ids || !card.genre_ids.length) return true;
        if (isTvShow(card) && (!card.last_episode_to_air || !card.status)) return true;
        return false;
    }

    // Категорія, в якій справді лежить id картки — потрібна лише для того, щоб
    // подія 'add' пішла з коректним "where" (інакше сервер міг би помилково
    // додати картку в категорію, до якої вона не належить).
    function findCardCategory(data, id) {
        for (var i = 0; i < CATEGORY_KEYS.length; i++) {
            var cat = CATEGORY_KEYS[i];
            if (Array.isArray(data[cat]) && data[cat].indexOf(id) !== -1) return cat;
        }
        return null;
    }

    // Пошук картки за id у даних Favorite (звичайний for, без Array.prototype.find —
    // на старих Smart TV його може не бути).
    function findCardById(data, id) {
        var list = data.card || [];
        for (var i = 0; i < list.length; i++) {
            if (list[i].id == id) return list[i];
        }
        return null;
    }

    // Застосовує до картки все, що вдалося дістати з відповіді TMDB.
    // Повертає true, якщо щось справді змінилось.
    function applyTmdbData(card, result) {
        var changed = false;

        if ((!card.genre_ids || !card.genre_ids.length) && Array.isArray(result.genres) && result.genres.length) {
            card.genre_ids = result.genres.map(function (g) { return g.id; });
            changed = true;
        }

        if (isTvShow(card)) {
            var last = result.last_episode_to_air;

            if (last && !card.last_episode_to_air) {
                card.last_episode_to_air = {
                    id: last.id,
                    name: last.name,
                    episode_number: last.episode_number,
                    season_number: last.season_number,
                    air_date: last.air_date
                };
                changed = true;
            }

            if (result.status && !card.status) {
                card.status = result.status;
                changed = true;
            }
        }

        return changed;
    }

    function startMigration($body) {
        // Лише список id-кандидатів фіксується на старті — самі об'єкти карток і
        // Favorite.full() перечитуються заново на кожному кроці нижче (next()),
        // а не тримаються однією застарілою посиланням увесь прогін. Причина:
        // фонова синхронізація lampac (bookmark.js) може викликати
        // Lampa.Favorite.read(true) посеред довгої міграції (visibilitychange
        // після 10+ хв на вкладці, вхідна подія з іншого пристрою) — це повністю
        // замінює внутрішній стан Favorite новим об'єктом зі Storage, і робота зі
        // старою посиланням означала б запис застарілих даних поверх щойно
        // засинхронізованих (чи навпаки).
        var initialData = Lampa.Favorite.full();
        var candidateIds = (initialData.card || [])
            .filter(needsFix)
            .map(function (c) { return c.id; });

        if (!candidateIds.length) {
            $body.find('.ffx-status').text('Усі картки вже мають потрібні дані — виправляти нічого.');
            return;
        }

        var total = candidateIds.length;
        var patched = 0;
        var failed = 0;
        var processed = 0;

        migration_running = true;

        updateProgress($body, 0, total, 0, 0, null);

        function finish() {
            migration_running = false;

            // Перечитуємо сховище в пам'ять і посилаємо state:changed — без цього
            // стрічки ("Ви дивилися", "Продовжити перегляд") не побачать змін до
            // наступного запуску застосунку.
            Lampa.Favorite.read();

            if (Lampa.Activity.active() && Lampa.Activity.active().component === 'main') {
                Lampa.Activity.refresh();
            }

            $body.find('.ffx-status').text('Готово. Виправлено: ' + patched + ', без результату: ' + failed + '.');
            $body.find('.ffx-bar').css('width', '100%');
            $body.find('.ffx-current').text('');

            Lampa.Noty.show('Виправлення завершено. Виправлено: ' + patched + ', без результату: ' + failed + '.');
        }

        function next() {
            if (processed >= total) {
                // Не рапортуємо "Готово" одразу: подія 'add' лише СТАРТУЄ асинхронний
                // POST /bookmark/add у bookmark.js, і останні запити в цей момент ще
                // в польоті. Якщо користувач перезавантажить сторінку зараз, вони
                // обірвуться — на сервері лишиться стара версія картки, і наступний
                // pullFromServer() (він виконується при кожному старті й замінює
                // локальний favorite СЕРВЕРНИМ цілком) поверне її назад без наших
                // полів. Саме через це міграцію доводилось запускати по кілька разів.
                if (patched) {
                    $body.find('.ffx-status').text('Синхронізація з сервером…');
                    $body.find('.ffx-current').text('Не закривайте застосунок кілька секунд.');
                    setTimeout(finish, SYNC_GRACE_MS);
                }
                else finish();
                return;
            }

            var id = candidateIds[processed];
            processed++;

            // Свіжа картка станом саме на цей момент — не з початкового знімку.
            var data = Lampa.Favorite.full();
            var card = findCardById(data, id);

            if (!card || !needsFix(card)) {
                // картку прибрано з Favorite, або дані вже з'явились звідкись інде
                // (наприклад, синхронізація з іншого пристрою) — пропускаємо
                // без зайвого запиту й без лічильника невдач.
                updateProgress($body, processed, total, patched, failed, card);
                setTimeout(next, 300);
                return;
            }

            var type = guessMediaType(card);
            var url = Lampa.TMDB.api(type + '/' + card.id + '?api_key=' + Lampa.TMDB.key() + '&language=' + (Lampa.Storage.field('tmdb_lang') || Lampa.Storage.field('language')));

            Lampa.Network.silent(url, function (result) {
                var freshCard = null;

                // try/catch навколо обробки однієї картки: без нього виняток
                // (найімовірніший — QuotaExceededError від Storage.set на великій
                // історії) обірвав би весь ланцюг next(), лишивши migration_running
                // назавжди true — кнопка більше не спрацювала б до перезапуску.
                try {
                    // Перечитуємо ще раз безпосередньо перед записом — між відправкою
                    // запиту й приходом відповіді дані теж могли змінитися.
                    var freshData = Lampa.Favorite.full();
                    freshCard = findCardById(freshData, id);

                    if (freshCard && result && applyTmdbData(freshCard, result)) {
                        // Зберігаємо одразу після кожної вдалої картки — щоб прогрес не
                        // губився, якщо застосунок на TV згорнуть/вб'ють посеред міграції.
                        Lampa.Storage.set('favorite', freshData);

                        // Якщо активна синхронізація lampac (bookmark.js) — надсилаємо
                        // оновлену картку на сервер тим самим шляхом, що й звичайне
                        // додавання в закладки (детальніше — README.md).
                        var cat = findCardCategory(freshData, freshCard.id);
                        if (cat) Lampa.Favorite.listener.send('add', { where: cat, card: freshCard });

                        patched++;
                    } else {
                        failed++;
                    }
                } catch (e) {
                    failed++;
                }

                updateProgress($body, processed, total, patched, failed, freshCard || card);
                setTimeout(next, 300); // пауза між запитами, щоб не впертись у ліміти TMDB
            }, function () {
                failed++;
                updateProgress($body, processed, total, patched, failed, card);
                setTimeout(next, 300);
            });
        }

        next();
    }

    // clearCard патчуємо ЯКОМОГА РАНІШЕ (не чекаючи appready): має діяти до першого
    // збереження чи відправки картки.
    patchClearCard();

    // Ранні спроби: якщо Lampa вже ініціалізована на момент завантаження плагіна.
    patchContinues();
    patchCaughtUp();
    patchContentRowsCall();

    // Основна ініціалізація — виконується після готовності Lampa. Повторює патчі
    // (ідемпотентно), потім через Favorite.read() ініціює state:changed →
    // Activity.refresh() → ContentRows.call() із вже патченою функцією, що
    // гарантує правильний рендер стрічки навіть якщо головний екран встиг
    // відрендеритись до завантаження плагіна.
    function onAppReady() {
        patchContinues();
        patchCaughtUp();
        patchContentRowsCall();
        if (Lampa.Favorite && typeof Lampa.Favorite.read === 'function') Lampa.Favorite.read();
        addSettings();
    }

    if (window.appready) onAppReady();
    else Lampa.Listener.follow('app', function (e) { if (e.type == 'ready') onAppReady(); });
})();
