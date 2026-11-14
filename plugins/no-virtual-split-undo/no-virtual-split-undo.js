/**
 * no-virtual-split-undo.js
 * Зворотня міграція таймкодів після видалення no-virtual-split.js.
 *
 * Підключити ЗАМІСТЬ no-virtual-split.js. При першому відкритті кожного
 * серіалу переносить прогрес перегляду назад:
 *   S1:E105 (абс.) → S2:E1 (вірт.) — як зберігала оригінальна Lampa.
 * Після обходу всіх серіалів — видалити цей плагін з розширень.
 */
(function () {
    'use strict';

    if (window.plugin_no_virtual_split_undo_loaded) return;
    window.plugin_no_virtual_split_undo_loaded = true;

    var timer = setInterval(function () {
        if (typeof Lampa === 'undefined') return;
        if (typeof Lampa.Utils === 'undefined') return;
        if (typeof Lampa.Utils.splitEpisodesIntoSeasons !== 'function') return;
        clearInterval(timer);

        var _original = Lampa.Utils.splitEpisodesIntoSeasons;

        // ─── Допоміжні функції (ідентичні no-virtual-split.js) ────────────

        function dateToDays(date) {
            if (!date || typeof date !== 'string') return 0;
            var p = date.split('-');
            return p.length === 3 ? +p[0] * 365 + +p[1] * 30 + +p[2] : 0;
        }

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

        function getTimelineStorageKey() {
            try {
                var a = Lampa.Account;
                if (a && a.Permit && a.Permit.sync && a.Permit.account && a.Permit.account.profile)
                    return 'file_view_' + a.Permit.account.profile.id;
            } catch (e) {}
            return 'file_view';
        }

        // ─── Зворотня міграція ─────────────────────────────────────────────

        function tryReverseMigrate(episodes, gap) {
            try {
                var act = Lampa.Activity && Lampa.Activity.active && Lampa.Activity.active();
                var movie = act && act.movie;
                if (!movie) return;

                var name = movie.original_name || movie.original_title;
                if (!name) return;

                // Прапор прямої міграції: якщо відсутній — цей серіал не мігрувався, пропускаємо
                var flagKey = 'novs_mig_' + Lampa.Utils.hash(name);
                if (!Lampa.Storage.get(flagKey, false)) return;

                var mapping = calcOldMapping(episodes, gap);
                if (!mapping.length) {
                    // Вірт. розбивки не було — просто очищуємо прапор
                    Lampa.Storage.set(flagKey, false);
                    return;
                }

                var stKey = getTimelineStorageKey();
                var tv = Lampa.Storage.get(stKey, {});
                var migrated = 0;

                mapping.forEach(function (m) {
                    // Поточний (абс.) хеш: S1:EabsEp
                    var newHash = Lampa.Utils.hash([1, '', m.absEp, name].join(''));

                    // Старий (вірт.) хеш: SvSeason:EvEp
                    var sep = m.vSeason > 10 ? ':' : '';
                    var oldHash = Lampa.Utils.hash([m.vSeason, sep, m.vEp, name].join(''));

                    if (tv[newHash] && !tv[oldHash]) {
                        tv[oldHash] = tv[newHash];
                        delete tv[newHash];
                        migrated++;
                    }
                });

                // Знімаємо прапор — серіал повернуто до вірт. хешів
                Lampa.Storage.set(flagKey, false);

                if (migrated > 0) {
                    Lampa.Storage.set(stKey, tv);
                    if (Lampa.Timeline && typeof Lampa.Timeline.read === 'function')
                        Lampa.Timeline.read(true);
                    console.log('[no-virtual-split-undo] Повернуто таймкодів:', migrated, 'для', name);
                }
            } catch (e) {
                console.error('[no-virtual-split-undo] Помилка реверс-міграції:', e);
            }
        }

        // ─── Перехоплення + виклик оригіналу ──────────────────────────────

        Lampa.Utils.splitEpisodesIntoSeasons = function (episodes, gap) {
            if (Array.isArray(episodes) && episodes.length) {
                tryReverseMigrate(episodes, gap || 90);
            }
            return _original.call(this, episodes, gap);
        };

        console.log('[no-virtual-split-undo] Увімкнено. Відкрий кожен серіал для реверсу таймкодів.');
    }, 100);
})();
