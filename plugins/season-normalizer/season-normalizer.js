/**
 * season-normalizer.js
 *
 * Проблема: для серіалів з одним сезоном у TMDB різні джерела балансера
 * можуть передавати один і той самий абсолютний номер епізоду під різними
 * номерами сезону (S1, S2, S3...). Lampa записує таймкод із сезоном від
 * джерела, а бейдж "переглянуто" шукає лише S1:Exx — тому епізоди,
 * переглянуті з S2/S3-джерел, не відмічаються.
 *
 * Рішення: при відкритті списку епізодів копіює знайдені таймкоди
 * S2/S3/S4/S5:Exx → S1:Exx, якщо S1:Exx відсутній.
 *
 * Захисти від помилкового копіювання:
 *   1. Лише для серіалів з number_of_seasons === 1 у TMDB.
 *   2. Тільки епізоди, що існують у TMDB-списку (з масиву episodes[]).
 *   3. Не перезаписує вже наявний S1:Exx.
 *   4. Сумісний з no-virtual-split.js — правильно ланцюгує виклики.
 */
(function () {
    'use strict';

    if (window.plugin_season_normalizer_loaded) return;
    window.plugin_season_normalizer_loaded = true;

    var timer = setInterval(function () {
        if (typeof Lampa === 'undefined') return;
        if (typeof Lampa.Utils === 'undefined') return;
        if (typeof Lampa.Utils.splitEpisodesIntoSeasons !== 'function') return;
        clearInterval(timer);

        // Формула має збігатись з rework/src/interaction/timeline.js:43
        // та no-virtual-split.js:getTimelineStorageKey — три копії, тримати синхронно.
        function getTimelineStorageKey() {
            try {
                var a = Lampa.Account;
                if (a && a.Permit && a.Permit.sync && a.Permit.account && a.Permit.account.profile)
                    return 'file_view_' + a.Permit.account.profile.id;
            } catch (e) {}
            return 'file_view';
        }

        function tryNormalize(episodes) {
            try {
                var act = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
                var movie = act && act.movie;

                // Тільки для серіалів з одним сезоном у TMDB
                if (!movie || movie.number_of_seasons !== 1) return;

                var name = movie.original_name || movie.original_title;
                if (!name) return;

                // Множина валідних TMDB-номерів епізодів із поточного списку
                var validEps = {};
                for (var i = 0; i < episodes.length; i++) {
                    var n = episodes[i].episode_number;
                    if (n) validEps[n] = true;
                }

                var stKey = getTimelineStorageKey();
                var tv = Lampa.Storage.get(stKey, {});
                var migrated = 0;

                for (var epStr in validEps) {
                    var ep = parseInt(epStr);

                    // Перевірка 3: не перезаписувати вже правильний S1:Exx
                    var s1Hash = Lampa.Utils.hash([1, '', ep, name].join(''));
                    if (tv[s1Hash]) continue;

                    // Шукаємо той самий ep у S2–S5
                    for (var altS = 2; altS <= 5; altS++) {
                        var altSep = altS > 10 ? ':' : '';
                        var altHash = Lampa.Utils.hash([altS, altSep, ep, name].join(''));
                        if (tv[altHash]) {
                            tv[s1Hash] = tv[altHash];
                            migrated++;
                            break; // беремо перше знайдене джерело
                        }
                    }
                }

                if (migrated > 0) {
                    Lampa.Storage.set(stKey, tv);
                    if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function')
                        Lampa.Timeline.read(true);
                    console.log('[season-normalizer] Нормалізовано', migrated, 'таймкодів для', name);
                }
            } catch (e) {
                console.error('[season-normalizer] Помилка:', e);
            }
        }

        // Ланцюгуємо поверх поточного splitEpisodesIntoSeasons.
        // Якщо no-virtual-split.js теж підключений — виклики правильно
        // передаються далі незалежно від порядку завантаження плагінів.
        var _orig = Lampa.Utils.splitEpisodesIntoSeasons;
        Lampa.Utils.splitEpisodesIntoSeasons = function (episodes, gap) {
            if (Array.isArray(episodes) && episodes.length) tryNormalize(episodes);
            return _orig(episodes, gap);
        };

        console.log('[season-normalizer] Увімкнено.');
    }, 100);
})();
