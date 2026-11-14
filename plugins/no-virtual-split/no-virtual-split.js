/**
 * no-virtual-split.js
 * Вимикає віртуальну розбивку серій на сезони в Lampa.
 *
 * Lampa за замовчуванням ділить серії сезону/1 на "віртуальні" сезони
 * якщо між ними є розрив > 90 днів (splitEpisodesIntoSeasons).
 * Цей плагін перевизначає функцію так, щоб всі серії залишались в S1
 * і відображались одним списком — відповідно до структури TMDB.
 *
 * Торкається тільки серіалів, де Lampa зараз штучно ділить.
 * Звичайні багатосезонні серіали (кілька TMDB-сезонів) — не змінюються.
 *
 * При першому відкритті кожного серіалу автоматично мігрує збережений
 * прогрес перегляду зі старих (вірт.) хешів на нові (абсолютні) хеші.
 */
(function () {
    'use strict';

    if (window.plugin_no_virtual_split_loaded) return;
    window.plugin_no_virtual_split_loaded = true;

    var timer = setInterval(function () {
        if (typeof Lampa === 'undefined') return;
        if (typeof Lampa.Utils === 'undefined') return;
        if (typeof Lampa.Utils.splitEpisodesIntoSeasons !== 'function') return;
        clearInterval(timer);

        // ─── Допоміжні функції ─────────────────────────────────────────────

        function dateToDays(date) {
            if (!date || typeof date !== 'string') return 0;
            var p = date.split('-');
            return p.length === 3 ? +p[0] * 365 + +p[1] * 30 + +p[2] : 0;
        }

        // Повертає маппінг для серій, які потрапили у вірт. сезони > 1:
        // [ { absEp: <оригін. номер>, vSeason: <вірт.сезон>, vEp: <відн. номер> }, ... ]
        function calcOldMapping(episodes, gap) {
            gap = gap || 90;
            var sorted = episodes.slice().sort(function (a, b) { return a.episode_number - b.episode_number; });
            var vSeason = 1, lastDay = 0, vEpCount = {};
            var mapping = [];
            for (var i = 0; i < sorted.length; i++) {
                var ep = sorted[i];
                var day = dateToDays(ep.air_date);
                if (day > 0 && lastDay > 0 && day - lastDay > gap) vSeason++;
                if (day > 0) lastDay = day;
                if (!vEpCount[vSeason]) vEpCount[vSeason] = 0;
                vEpCount[vSeason]++;
                if (vSeason > 1) {
                    mapping.push({ absEp: ep.episode_number, vSeason: vSeason, vEp: vEpCount[vSeason] });
                }
            }
            return mapping;
        }

        // Storage-ключ для Timeline (враховує Premium-профіль).
        // Формула має збігатись з rework/src/interaction/timeline.js:43
        // та season-normalizer.js:getTimelineStorageKey — три копії, тримати синхронно.
        function getTimelineStorageKey() {
            try {
                var a = Lampa.Account;
                if (a && a.Permit && a.Permit.sync && a.Permit.account && a.Permit.account.profile)
                    return 'file_view_' + a.Permit.account.profile.id;
            } catch (e) {}
            return 'file_view';
        }

        // Одноразова міграція таймкодів для поточного серіалу
        function tryMigrate(episodes, gap) {
            try {
                var act = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
                var movie = act && act.movie;
                if (!movie) return;

                var name = movie.original_name || movie.original_title;
                if (!name) return;

                // Прапор: вже мігровано цей серіал
                var flagKey = 'novs_mig_' + Lampa.Utils.hash(name);
                if (Lampa.Storage.get(flagKey, false)) return;
                Lampa.Storage.set(flagKey, true); // встановлюємо одразу, щоб не повторювати

                var mapping = calcOldMapping(episodes, gap);
                if (!mapping.length) return; // вірт. розбивки не було — нічого мігрувати

                var stKey = getTimelineStorageKey();
                var tv = Lampa.Storage.get(stKey, {});
                var migrated = 0;

                mapping.forEach(function (m) {
                    // Старий хеш: [vSeason][vEp][name]  (формат Lampa: season > 10 → ставить ':')
                    var sep = m.vSeason > 10 ? ':' : '';
                    var oldHash = Lampa.Utils.hash([m.vSeason, sep, m.vEp, name].join(''));

                    // Новий хеш: [1][absEp][name]
                    var newHash = Lampa.Utils.hash([1, '', m.absEp, name].join(''));

                    if (tv[oldHash] && !tv[newHash]) {
                        tv[newHash] = tv[oldHash];
                        delete tv[oldHash];
                        migrated++;
                    }
                });

                if (migrated > 0) {
                    Lampa.Storage.set(stKey, tv);
                    // Оновлюємо внутрішній кеш Timeline (без broadcast-події)
                    if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function')
                        Lampa.Timeline.read(true);
                    console.log('[no-virtual-split] Мігровано таймкодів:', migrated, 'для', name);
                }
            } catch (e) {
                console.error('[no-virtual-split] Помилка міграції:', e);
            }
        }

        // ─── Override splitEpisodesIntoSeasons ─────────────────────────────

        // Зберігаємо попередню функцію і викликаємо її (ігноруючи результат),
        // щоб сторонні обгортки (наприклад season-normalizer.js) спрацювали
        // незалежно від порядку завантаження плагінів.
        var _prevSplit = Lampa.Utils.splitEpisodesIntoSeasons;
        Lampa.Utils.splitEpisodesIntoSeasons = function (episodes, gap) {
            if (!Array.isArray(episodes) || !episodes.length) return {};
            if (_prevSplit) try { _prevSplit(episodes, gap); } catch (e) {}
            tryMigrate(episodes, gap || 90);
            return { 1: episodes };
        };

        console.log('[no-virtual-split] Увімкнено.');
    }, 100);
})();
