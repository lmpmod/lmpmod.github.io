/**
 * Плагін «Ремап епізодів» (Episode Remap) для Lampa
 * Версія: 1.2.2
 * Призначення: Гнучке зіставлення та корекція нумерації сезонів/серій між балансерами (Kodik, HDRezka тощо) та базою TMDB.
 */
(function () {
    'use strict';

    var PLUGIN_VERSION = '1.2.2';

    // Захист від повторного завантаження плагіна
    if (window.lampa_episode_remap_loaded) return;
    window.lampa_episode_remap_loaded = true;

    // Зарезервовані типи правил (назва джерела не може збігатися з цими словами)
    var RESERVED_RULE_TYPES = ['offset', 'start', 'abs', 'map'];

    // Іконка плагіна — спільна для розділу Налаштувань і пункту контекстного меню джерела
    var REMAP_ICON_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"></polyline><line x1="4" y1="20" x2="21" y2="3"></line><polyline points="21 16 21 21 16 21"></polyline><line x1="15" y1="15" x2="21" y2="21"></line><line x1="4" y1="4" x2="9" y2="9"></line></svg>';

    // Внутрішній стан та кеші
    var sourceHashMap = {};
    var currentActiveCard = null;
    var origTimelineView = null;
    var origTimelineUpdate = null;

    /**
     * Перевірка, чи увімкнено функціонал ремапінгу в налаштуваннях
     */
    function isRemapEnabled() {
        return typeof Lampa !== 'undefined' && Lampa.Storage ? Lampa.Storage.get('remap_enabled', true) : true;
    }

    /**
     * Безпечне отримання назви тайтлу TMDB для генерації хешу
     * Для серіалів TMDB повертає original_name, для фільмів original_title.
     */
    function getCardTitle(card) {
        if (!card) return '';
        return (card.original_name || card.original_title || card.title || card.name || '').trim();
    }

    /**
     * Отримання числового ID тайтлу TMDB
     */
    function getCardId(card) {
        if (!card) return 0;
        var id = card.id || (card.movie && card.movie.id) || (card.card && card.card.id);
        return parseInt(id, 10) || 0;
    }

    /**
     * Каскадне надійне отримання поточної картки тайтлу TMDB
     */
    function detectActiveCard(fallback) {
        if (fallback && (fallback.id || fallback.original_name || fallback.number_of_seasons)) {
            currentActiveCard = fallback;
            return fallback;
        }

        // Реальна активна активність — авторитетне джерело "що зараз на екрані". Перевіряємо
        // її ПЕРШОЮ, до кешу currentActiveCard: якщо спершу перевіряти кеш, застаріла картка
        // з попереднього тайтла (лишена там минулим викликом) "виграє" навіть тоді, коли
        // користувач уже перейшов на інший тайтл — кеш ніколи не встигає інвалідуватись.
        if (typeof Lampa !== 'undefined' && Lampa.Activity) {
            var act = Lampa.Activity.active ? Lampa.Activity.active() : null;
            if (act) {
                var c = act.card || act.movie;
                if (c && (c.id || c.original_name || c.number_of_seasons)) {
                    currentActiveCard = c;
                    return c;
                }
            }
        }

        if (currentActiveCard && (currentActiveCard.id || currentActiveCard.number_of_seasons)) {
            return currentActiveCard;
        }

        if (typeof Lampa !== 'undefined' && Lampa.Activity && Lampa.Activity.all) {
            var all = Lampa.Activity.all();
            for (var i = all.length - 1; i >= 0; i--) {
                var ac = all[i].card || all[i].movie;
                if (ac && (ac.id || ac.original_name || ac.number_of_seasons)) {
                    currentActiveCard = ac;
                    return ac;
                }
            }
        }
        return currentActiveCard;
    }

    /**
     * Розрахунок канонічного хешу епізоду Lampa
     * Відповідає внутрішній формулі ядра Lampa (app.min.js:32162):
     * season > 10 ? ':' : ''
     */
    function calculateEpisodeHash(title, season, episode) {
        var s = parseInt(season, 10) || 1;
        var e = parseInt(episode, 10) || 1;
        var sep = s > 10 ? ':' : '';
        return String(Lampa.Utils.hash([s, sep, e, title].join('')));
    }

    /**
     * Каскадне визначення поточного активного балансера
     */
    function getActiveBalanser(element) {
        // 1. Властивість об'єкта елемента
        if (element) {
            var eb = element.balanser || element.source || element.balans;
            if (eb) return String(eb).toLowerCase().trim();
        }

        // 2. Ключі у Storage від Lampac Online (online_last_balanser, online_balanser, active_balanser)
        if (typeof Lampa !== 'undefined' && Lampa.Storage) {
            var showId = getCardId(currentActiveCard || (element && element.card));
            if (showId) {
                var lastBal = Lampa.Storage.get('online_last_balanser', {});
                if (lastBal && lastBal[showId]) return String(lastBal[showId]).toLowerCase().trim();
            }
            var ob = Lampa.Storage.get('online_balanser', '');
            if (ob) return String(ob).toLowerCase().trim();

            var ab = Lampa.Storage.get('active_balanser', '');
            if (ab) return String(ab).toLowerCase().trim();
        }

        // 3. Поточна активність Lampa
        if (typeof Lampa !== 'undefined' && Lampa.Activity && Lampa.Activity.active) {
            var act = Lampa.Activity.active();
            if (act) {
                var actB = act.balanser || (act.component && act.component.balanser);
                if (actB) return String(actB).toLowerCase().trim();
            }
        }

        // 4. Фолбек за замовчуванням
        return 'all';
    }

    /**
     * Парсер окремого текстового правила з підтримкою colon-safe параметрів
     */
    function parseRule(ruleStr) {
        if (!ruleStr) return null;
        var raw = ruleStr.trim();
        if (!raw || raw.indexOf('#') === 0) return null;

        var parts = raw.split(':');
        if (parts.length < 2) return null;

        var id = parseInt(parts[0].trim(), 10);
        if (!id) return null;

        var scope = 'all';
        var type = 'map';
        var params = '';

        if (parts.length === 2) {
            // id:from>to (голий map для всіх джерел)
            scope = 'all';
            type = 'map';
            params = parts.slice(1).join(':').trim();
        } else if (parts.length === 3) {
            var token1 = parts[1].trim().toLowerCase();
            if (RESERVED_RULE_TYPES.indexOf(token1) !== -1) {
                // id:type:params (типізоване правило для всіх джерел)
                scope = 'all';
                type = token1;
                params = parts.slice(2).join(':').trim();
            } else {
                // id:source:params (голий map для вказаного джерела)
                scope = token1;
                type = 'map';
                params = parts.slice(2).join(':').trim();
            }
        } else {
            // 4+ токени: id:source:type:params (де params може містити ':')
            scope = parts[1].trim().toLowerCase();
            var token2 = parts[2].trim().toLowerCase();
            if (RESERVED_RULE_TYPES.indexOf(token2) !== -1) {
                type = token2;
                params = parts.slice(3).join(':').trim();
            } else {
                type = 'map';
                params = parts.slice(2).join(':').trim();
            }
        }

        return {
            id: id,
            scope: scope || 'all',
            type: type,
            params: params,
            raw: raw
        };
    }

    /**
     * Отримання списку всіх налаштованих правил зі Storage
     */
    function getAllRules() {
        var rulesStr = '';
        if (typeof Lampa !== 'undefined' && Lampa.Storage) {
            rulesStr = Lampa.Storage.get('remap_rules', '');
        }

        if (!rulesStr) return [];

        var rawList = rulesStr.split(';');
        var parsed = [];
        for (var i = 0; i < rawList.length; i++) {
            var r = parseRule(rawList[i]);
            if (r) parsed.push(r);
        }
        return parsed;
    }

    /**
     * Оновлення розділу Налаштувань, якщо він зараз відкритий
     */
    function refreshSettingsIfOpen() {
        if (typeof Lampa !== 'undefined' && Lampa.Settings && typeof $ !== 'undefined' && $('body').hasClass('settings--open')) {
            try { Lampa.Settings.update(); } catch (e) {}
        }
    }

    /**
     * Збереження нового правила у Storage
     */
    function saveRuleToStorage(rawRule) {
        if (!rawRule || !rawRule.trim()) return;
        var ruleTrimmed = rawRule.trim().replace(/;$/, '');
        var existing = (Lampa.Storage.get('remap_rules', '') || '').trim();
        var list = existing ? existing.split(';').map(function (s) { return s.trim(); }).filter(Boolean) : [];
        if (list.indexOf(ruleTrimmed) === -1) {
            list.push(ruleTrimmed);
        }
        var updated = list.join('; ') + (list.length ? ';' : '');
        Lampa.Storage.set('remap_rules', updated);
        refreshSettingsIfOpen();
    }

    /**
     * Оновлення існуючого правила у Storage
     */
    function updateRuleInStorage(oldRawRule, newRawRule) {
        var oldTrimmed = (oldRawRule || '').trim().replace(/;$/, '');
        var newTrimmed = (newRawRule || '').trim().replace(/;$/, '');
        var existing = (Lampa.Storage.get('remap_rules', '') || '').trim();
        var list = existing ? existing.split(';').map(function (s) { return s.trim(); }).filter(Boolean) : [];
        var idx = list.indexOf(oldTrimmed);
        if (idx !== -1) {
            if (newTrimmed) {
                list[idx] = newTrimmed;
            } else {
                list.splice(idx, 1);
            }
        } else if (newTrimmed) {
            list.push(newTrimmed);
        }
        var updated = list.join('; ') + (list.length ? ';' : '');
        Lampa.Storage.set('remap_rules', updated);
        refreshSettingsIfOpen();
    }

    /**
     * Видалення правила зі Storage
     */
    function deleteRuleFromStorage(rawRule) {
        var ruleTrimmed = (rawRule || '').trim().replace(/;$/, '');
        var existing = (Lampa.Storage.get('remap_rules', '') || '').trim();
        var list = existing ? existing.split(';').map(function (s) { return s.trim(); }).filter(Boolean) : [];
        list = list.filter(function (r) { return r !== ruleTrimmed; });
        var updated = list.join('; ') + (list.length ? ';' : '');
        Lampa.Storage.set('remap_rules', updated);
        refreshSettingsIfOpen();
    }

    /**
     * Безпечна прив'язка події дії (hover:enter або click) з дебаунсом 300мс
     * Запобігає подвійному спрацьовуванню в Lampa
     */
    function bindAction($el, handler) {
        var lastTrigger = 0;
        $el.on('hover:enter click', function (e) {
            var now = Date.now();
            if (now - lastTrigger < 300) return;
            lastTrigger = now;
            handler.call(this, e);
        });
    }

    /**
     * Безпечний виклик Lampa.Input.edit із закриттям Modal (щоб уникнути перекриття вікон)
     */
    function modalSafeInput(inputParams, onDone) {
        // Modal.close() безумовно робить _scroll.destroy() — якщо Modal ще не відкривався
        // в цій сесії (наприклад, виклик прямо з кнопки в Налаштуваннях, а не зсередини
        // вже відкритого симулятора), _scroll лишається undefined і виклик падає з
        // "Cannot read properties of undefined (reading 'destroy')". Закриваємо лише те,
        // що реально відкрито.
        if (typeof Lampa !== 'undefined' && Lampa.Modal && Lampa.Modal.opened && Lampa.Modal.opened()) {
            Lampa.Modal.close();
        }

        // Примусово прибираємо будь-який старий шар введення, якщо він завис у DOM
        if (typeof $ !== 'undefined') {
            $('.settings-input').remove();
            $('body').removeClass('keyboard-input--visible');
        }

        // Тип клавіатури НЕ форсуємо — лишаємо на розсуд Storage.field('keyboard_type')
        // (вибір користувача в Налаштуваннях: вбудована/системна), як і в усіх штатних
        // полях type:'input' самої Lampa (settings.js). У "простому" (нативному) режимі
        // OK/Enter та Назад/ESC обробляються власним keyup-хендлером Input.edit незалежно
        // від того, чи можна дотягнутись пультом до кнопок "Готово"/"Скасувати".
        var opts = { free: true, nosave: true, nomic: true };
        if (inputParams) {
            for (var k in inputParams) {
                if (Object.prototype.hasOwnProperty.call(inputParams, k)) {
                    opts[k] = inputParams[k];
                }
            }
        }

        setTimeout(function () {
            if (typeof Lampa !== 'undefined' && Lampa.Input) {
                Lampa.Input.edit(opts, function (val) {
                    if (typeof $ !== 'undefined') {
                        $('.settings-input').remove();
                        $('body').removeClass('keyboard-input--visible');
                    }
                    if (typeof onDone === 'function') {
                        onDone(val);
                    }
                });
            } else if (typeof onDone === 'function') {
                onDone(opts.value);
            }
        }, 50);
    }

    /**
     * Пряме застосування окремого правила (джерело -> TMDB)
     */
    function applyRuleForward(rule, season, episode) {
        if (!rule) return null;
        var s = parseInt(season, 10) || 1;
        var e = parseInt(episode, 10) || 1;

        if (rule.type === 'map') {
            var mapParts = rule.params.split('>');
            if (mapParts.length === 2) {
                var fromS = parseInt(mapParts[0].trim(), 10);
                var toS = parseInt(mapParts[1].trim(), 10);
                if (s === fromS) {
                    return { season: toS, episode: e, modified: true };
                }
            }
        } else if (rule.type === 'offset') {
            var offsetParts = rule.params.split('>');
            if (offsetParts.length === 2) {
                var fromOffS = parseInt(offsetParts[0].trim(), 10);
                var toOffS = 0;
                var offsetVal = 0;
                var right = offsetParts[1].trim();

                if (right.indexOf('+') !== -1) {
                    var pPlus = right.split('+');
                    toOffS = parseInt(pPlus[0].trim(), 10);
                    offsetVal = parseInt(pPlus[1].trim(), 10) || 0;
                } else if (right.indexOf('-') !== -1) {
                    var pMinus = right.split('-');
                    toOffS = parseInt(pMinus[0].trim(), 10);
                    offsetVal = -(parseInt(pMinus[1].trim(), 10) || 0);
                } else {
                    toOffS = parseInt(right, 10);
                }

                if (s === fromOffS) {
                    var newEp = e + offsetVal;
                    if (newEp > 0) {
                        return { season: toOffS, episode: newEp, modified: true };
                    }
                }
            }
        } else if (rule.type === 'start') {
            var startParts = rule.params.split('>');
            if (startParts.length === 2) {
                var fromStartS = parseInt(startParts[0].trim(), 10);
                var subParts = startParts[1].split(':');
                var toStartS = parseInt(subParts[0].trim(), 10);
                var startEp = subParts.length > 1 ? parseInt(subParts[1].trim(), 10) : 1;

                if (s === fromStartS) {
                    var calcEp = startEp + (e - 1);
                    if (calcEp > 0) {
                        return { season: toStartS, episode: calcEp, modified: true };
                    }
                }
            }
        } else if (rule.type === 'abs') {
            var counts = rule.params.split(',').map(function (c) {
                return parseInt(c.trim(), 10) || 0;
            });
            if (counts.length > 0) {
                if (s <= 1) {
                    // Розбиття наскрізної нумерації по довжинах сезонів
                    var validCounts = counts.filter(function (c) { return c > 0; });
                    var remaining = e;
                    for (var j = 0; j < validCounts.length; j++) {
                        var cnt = validCounts[j];
                        if (remaining <= cnt) {
                            return { season: j + 1, episode: remaining, modified: true };
                        }
                        // На ОСТАННІЙ заданій групі remaining не звужуємо — інакше серія понад
                        // суму всіх груп колізує з реальною серією всередині останньої групи.
                        if (j < validCounts.length - 1) remaining -= cnt;
                    }
                    return { season: validCounts.length || 1, episode: remaining, modified: true };
                } else {
                    // Збирання розбитих сезонів в один суцільний перший сезон TMDB
                    var totalPrev = 0;
                    for (var k = 0; k < s - 1 && k < counts.length; k++) {
                        totalPrev += counts[k];
                    }
                    return { season: 1, episode: totalPrev + e, modified: true };
                }
            }
        }

        return null;
    }

    /**
     * Зворотне застосування окремого правила (TMDB -> джерело)
     */
    function applyRuleReverse(rule, season, episode) {
        if (!rule) return null;
        var s = parseInt(season, 10) || 1;
        var e = parseInt(episode, 10) || 1;

        if (rule.type === 'map') {
            var mapParts = rule.params.split('>');
            if (mapParts.length === 2) {
                var fromS = parseInt(mapParts[0].trim(), 10);
                var toS = parseInt(mapParts[1].trim(), 10);
                if (s === toS) {
                    return { season: fromS, episode: e, modified: true };
                }
            }
        } else if (rule.type === 'offset') {
            var offsetParts = rule.params.split('>');
            if (offsetParts.length === 2) {
                var fromOffS = parseInt(offsetParts[0].trim(), 10);
                var toOffS = 0;
                var offsetVal = 0;
                var right = offsetParts[1].trim();

                if (right.indexOf('+') !== -1) {
                    var pPlus = right.split('+');
                    toOffS = parseInt(pPlus[0].trim(), 10);
                    offsetVal = parseInt(pPlus[1].trim(), 10) || 0;
                } else if (right.indexOf('-') !== -1) {
                    var pMinus = right.split('-');
                    toOffS = parseInt(pMinus[0].trim(), 10);
                    offsetVal = -(parseInt(pMinus[1].trim(), 10) || 0);
                } else {
                    toOffS = parseInt(right, 10);
                }

                if (s === toOffS) {
                    var origEp = e - offsetVal;
                    if (origEp > 0) {
                        return { season: fromOffS, episode: origEp, modified: true };
                    }
                }
            }
        } else if (rule.type === 'start') {
            var startParts = rule.params.split('>');
            if (startParts.length === 2) {
                var fromStartS = parseInt(startParts[0].trim(), 10);
                var subParts = startParts[1].split(':');
                var toStartS = parseInt(subParts[0].trim(), 10);
                var startEp = subParts.length > 1 ? parseInt(subParts[1].trim(), 10) : 1;

                if (s === toStartS && e >= startEp) {
                    var origStartEp = (e - startEp) + 1;
                    return { season: fromStartS, episode: origStartEp, modified: true };
                }
            }
        } else if (rule.type === 'abs') {
            var counts = rule.params.split(',').map(function (c) {
                return parseInt(c.trim(), 10) || 0;
            });
            if (counts.length > 0) {
                if (s > 1) {
                    var totalPrev = 0;
                    for (var k = 0; k < s - 1 && k < counts.length; k++) {
                        totalPrev += counts[k];
                    }
                    return { season: 1, episode: totalPrev + e, modified: true };
                } else {
                    var validCounts = counts.filter(function (c) { return c > 0; });
                    var remaining = e;
                    for (var j = 0; j < validCounts.length; j++) {
                        var cnt = validCounts[j];
                        if (remaining <= cnt) {
                            return { season: j + 1, episode: remaining, modified: true };
                        }
                        if (j < validCounts.length - 1) remaining -= cnt;
                    }
                    return { season: validCounts.length || 1, episode: remaining, modified: true };
                }
            }
        }

        return null;
    }

    /**
     * Автоматична евристика TMDB для розбиття наскрізної нумерації аніме/серіалів
     * Спрацьовує ВИКЛЮЧНО коли sourceSeason <= 1 та episode перевищує тривалість сезону 1 у TMDB.
     */
    function autoResolveAbsolute(tmdbCard, sourceSeason, sourceEpisode) {
        if (!tmdbCard || !tmdbCard.seasons || !tmdbCard.seasons.length) return null;
        var s = parseInt(sourceSeason, 10) || 1;
        var e = parseInt(sourceEpisode, 10) || 1;

        if (s > 1) return null;

        var validSeasons = [];
        for (var i = 0; i < tmdbCard.seasons.length; i++) {
            var sn = tmdbCard.seasons[i];
            if (sn && sn.season_number > 0 && sn.episode_count > 0) {
                validSeasons.push(sn);
            }
        }
        if (!validSeasons.length) return null;
        validSeasons.sort(function (a, b) { return a.season_number - b.season_number; });

        if (e <= validSeasons[0].episode_count) return null;

        var remaining = e;
        for (var j = 0; j < validSeasons.length; j++) {
            var cnt = validSeasons[j].episode_count;
            if (remaining <= cnt) {
                return {
                    season: validSeasons[j].season_number,
                    episode: remaining,
                    heuristic: true
                };
            }
            // На ОСТАННЬОМУ відомому сезоні remaining більше не звужуємо — інакше серія,
            // що виходить за межі всіх відомих сезонів (e.g. e=50 при 2 сезонах по 24),
            // колізує з реальною серією всередині останнього сезону (26 і 50 обидва дали б S02E02).
            if (j < validSeasons.length - 1) remaining -= cnt;
        }

        var last = validSeasons[validSeasons.length - 1];
        return {
            season: last ? last.season_number : 1,
            episode: remaining,
            heuristic: true
        };
    }

    /**
     * Зворотна евристика TMDB (канонічні сезон/епізод -> наскрізний епізод джерела)
     */
    function reverseAutoResolveAbsolute(tmdbCard, canonicalSeason, canonicalEpisode) {
        if (!tmdbCard || !tmdbCard.seasons || !tmdbCard.seasons.length) return null;
        var s = parseInt(canonicalSeason, 10) || 1;
        var e = parseInt(canonicalEpisode, 10) || 1;

        if (s <= 1) return null;

        var validSeasons = [];
        for (var i = 0; i < tmdbCard.seasons.length; i++) {
            var sn = tmdbCard.seasons[i];
            if (sn && sn.season_number > 0 && sn.episode_count > 0) {
                validSeasons.push(sn);
            }
        }
        if (!validSeasons.length) return null;
        validSeasons.sort(function (a, b) { return a.season_number - b.season_number; });

        var totalPrev = 0;
        for (var j = 0; j < validSeasons.length; j++) {
            if (validSeasons[j].season_number < s) {
                totalPrev += validSeasons[j].episode_count;
            }
        }

        return {
            season: 1,
            episode: totalPrev + e,
            heuristic: true
        };
    }

    /**
     * Головна функція прямого мапінгу: джерело -> TMDB
     */
    function forward(card, source, season, episode) {
        var s = parseInt(season, 10) || 1;
        var e = parseInt(episode, 10) || 1;
        var showId = getCardId(card);
        var src = (source || 'all').toLowerCase().trim();

        var res = {
            season: s,
            episode: e,
            matchedRule: null,
            isHeuristic: false
        };

        if (!isRemapEnabled() || !showId) return res;

        var allRules = getAllRules();

        // 1. Пошук точного правила для обраного джерела (scoped)
        for (var i = 0; i < allRules.length; i++) {
            var rule = allRules[i];
            if (rule.id === showId && rule.scope !== 'all' && rule.scope === src) {
                var applied = applyRuleForward(rule, res.season, res.episode);
                if (applied && applied.modified) {
                    res.season = applied.season;
                    res.episode = applied.episode;
                    res.matchedRule = rule;
                    return res;
                }
            }
        }

        // 2. Пошук глобального правила (scope: all)
        for (var j = 0; j < allRules.length; j++) {
            var gRule = allRules[j];
            if (gRule.id === showId && gRule.scope === 'all') {
                var gApplied = applyRuleForward(gRule, res.season, res.episode);
                if (gApplied && gApplied.modified) {
                    res.season = gApplied.season;
                    res.episode = gApplied.episode;
                    res.matchedRule = gRule;
                    return res;
                }
            }
        }

        // 3. Автоматична евристика за метаданими TMDB
        var auto = autoResolveAbsolute(card, s, e);
        if (auto) {
            res.season = auto.season;
            res.episode = auto.episode;
            res.isHeuristic = true;
        }

        return res;
    }

    /**
     * Головна функція зворотного мапінгу: TMDB -> джерело
     */
    function reverse(card, source, season, episode) {
        var s = parseInt(season, 10) || 1;
        var e = parseInt(episode, 10) || 1;
        var showId = getCardId(card);
        var src = (source || 'all').toLowerCase().trim();

        var res = {
            season: s,
            episode: e,
            matchedRule: null,
            isHeuristic: false
        };

        if (!isRemapEnabled() || !showId) return res;

        var allRules = getAllRules();

        // 1. Точне джерело
        for (var i = 0; i < allRules.length; i++) {
            var rule = allRules[i];
            if (rule.id === showId && rule.scope !== 'all' && rule.scope === src) {
                var applied = applyRuleReverse(rule, res.season, res.episode);
                if (applied && applied.modified) {
                    res.season = applied.season;
                    res.episode = applied.episode;
                    res.matchedRule = rule;
                    return res;
                }
            }
        }

        // 2. Глобальне правило
        for (var j = 0; j < allRules.length; j++) {
            var gRule = allRules[j];
            if (gRule.id === showId && gRule.scope === 'all') {
                var gApplied = applyRuleReverse(gRule, res.season, res.episode);
                if (gApplied && gApplied.modified) {
                    res.season = gApplied.season;
                    res.episode = gApplied.episode;
                    res.matchedRule = gRule;
                    return res;
                }
            }
        }

        // 3. Зворотна евристика
        var autoRev = reverseAutoResolveAbsolute(card, s, e);
        if (autoRev) {
            res.season = autoRev.season;
            res.episode = autoRev.episode;
            res.isHeuristic = true;
        }

        return res;
    }

    /**
     * Побудова таблиці зіставлення хешів джерела та канонічних TMDB-хешів
     */
    function rebuildSourceHashMap(card, balanser) {
        card = detectActiveCard(card);
        if (!card) return;
        currentActiveCard = card;

        var title = getCardTitle(card);
        if (!title) return;

        var src = balanser || getActiveBalanser();
        var showId = getCardId(card);

        sourceHashMap = {};

        if (!isRemapEnabled()) return;

        var seasons = card.seasons || [];
        var maxSeasons = card.number_of_seasons || (seasons.length > 0 ? seasons.length : 10);
        if (maxSeasons < 10) maxSeasons = 10;

        var maxEpisodes = Math.max(card.number_of_episodes || 0, 1500);
        if (maxEpisodes > 2000) maxEpisodes = 2000;

        // Перебираємо спешли (0) та сезони (1..maxSeasons)
        var seasonList = [0];
        for (var s = 1; s <= maxSeasons; s++) {
            seasonList.push(s);
        }

        for (var si = 0; si < seasonList.length; si++) {
            var sourceSeason = seasonList[si];
            var epLimit = maxEpisodes;

            for (var sourceEpisode = 1; sourceEpisode <= epLimit; sourceEpisode++) {
                var res = forward(card, src, sourceSeason, sourceEpisode);
                if (res.season !== sourceSeason || res.episode !== sourceEpisode) {
                    var sourceHash = calculateEpisodeHash(title, sourceSeason, sourceEpisode);
                    var canonicalHash = calculateEpisodeHash(title, res.season, res.episode);

                    sourceHashMap[sourceHash] = canonicalHash;
                }
            }
        }
    }

    /**
     * Перехоплення Lampa.Timeline:
     * 1) view: підміна сирого хешу джерела на канонічний TMDB-хеш для відображення прогресу.
     * 2) update: прозоре перенаправлення сирого хешу джерела на канонічний TMDB (наприклад,
     *    при прямому виклику з нативного шару Android після виходу з VLC/MX Player).
     *    Запис створюється РІВНО ОДИН (канонічний), без дублювання в базі та без фантомних подій.
     */
    function hookTimeline() {
        if (!Lampa.Timeline) return;

        if (!origTimelineView && Lampa.Timeline.view) {
            origTimelineView = Lampa.Timeline.view;

            Lampa.Timeline.view = function (hash) {
                if (!isRemapEnabled()) {
                    return origTimelineView.call(Lampa.Timeline, hash);
                }

                var canonicalHash = sourceHashMap[hash];
                if (canonicalHash) {
                    // Отримуємо таймлайн канонічного епізоду TMDB — handler усередині вже
                    // прошитий на canonicalHash самим origTimelineView, додаткового запису
                    // під сирим хешем не потрібно (список джерела й так побачить прогрес
                    // правильно, бо сам звертається сюди ж, у Timeline.view).
                    return origTimelineView.call(Lampa.Timeline, canonicalHash);
                }

                return origTimelineView.call(Lampa.Timeline, hash);
            };
        }

        if (!origTimelineUpdate && Lampa.Timeline.update) {
            origTimelineUpdate = Lampa.Timeline.update;

            Lampa.Timeline.update = function (params) {
                if (isRemapEnabled() && params && params.hash && sourceHashMap[params.hash]) {
                    // Прозоро підміняємо сирий хеш джерела на канонічний TMDB перед збереженням
                    params.hash = sourceHashMap[params.hash];
                }
                return origTimelineUpdate.call(Lampa.Timeline, params);
            };
        }
    }

    /**
     * Підключення нативного слухача плеєра (Player.listener.follow('create'))
     */
    function hookPlayer() {
        if (!Lampa.Player || !Lampa.Player.listener) return;

        Lampa.Player.listener.follow('create', function (e) {
            if (!isRemapEnabled()) return;
            if (!e || !e.data) return;
            var data = e.data;

            // Перевіряємо, чи є координати серії
            if (typeof data.season === 'undefined' && typeof data.episode === 'undefined') return;

            var card = detectActiveCard(data.card);
            if (!card) return;

            // Ідемпотентність: зберігаємо оригінальні координати
            if (typeof data._raw_season === 'undefined') {
                data._raw_season = data.season;
                data._raw_episode = data.episode;
            }

            var baseSeason = data._raw_season;
            var baseEpisode = data._raw_episode;
            var balanser = getActiveBalanser(data);
            var titleStr = getCardTitle(card);

            var mapped = forward(card, balanser, baseSeason, baseEpisode);
            if (mapped && (mapped.season !== baseSeason || mapped.episode !== baseEpisode)) {
                data.season = mapped.season;
                data.episode = mapped.episode;
                if (data.timeline && titleStr) {
                    data.timeline.hash = calculateEpisodeHash(titleStr, mapped.season, mapped.episode);
                }
            }

            // Плейлист (data.playlist) передається зовнішньому плеєру одним пакетом при
            // самій передачі керування (Android.openPlayer/AndroidJS.openPlayer) — на відміну
            // від внутрішнього плеєра, де перемикання серії йде через PlayerPlaylist 'select'
            // -> повторний виклик play$1 -> нова подія 'create' (кожен елемент отримує
            // ремап окремо, свіжо). Для зовнішнього плеєра такого повторного 'create' не
            // буде — тож без цього кожен елемент плейлиста, крім щойно натиснутого, лишився
            // б з сирими (нересемапленими) season/episode/timeline.hash.
            if (Array.isArray(data.playlist)) {
                for (var pi = 0; pi < data.playlist.length; pi++) {
                    var item = data.playlist[pi];
                    if (!item || (typeof item.season === 'undefined' && typeof item.episode === 'undefined')) continue;

                    if (typeof item._raw_season === 'undefined') {
                        item._raw_season = item.season;
                        item._raw_episode = item.episode;
                    }

                    var itemMapped = forward(card, balanser, item._raw_season, item._raw_episode);
                    if (itemMapped && (itemMapped.season !== item._raw_season || itemMapped.episode !== item._raw_episode)) {
                        item.season = itemMapped.season;
                        item.episode = itemMapped.episode;
                        if (item.timeline && titleStr) {
                            item.timeline.hash = calculateEpisodeHash(titleStr, itemMapped.season, itemMapped.episode);
                        }
                    }
                }
            }
        });
    }

    /**
     * Ін'єкція CSS-стилів плагіна
     */
    function injectCSS() {
        if (document.getElementById('lampa_episode_remap_css')) return;
        var style = document.createElement('style');
        style.id = 'lampa_episode_remap_css';
        style.textContent = [
            '.remap-sim__box { padding: 1.2em; background: rgba(255,255,255,0.05); border-radius: 0.8em; margin-bottom: 0.8em; }',
            '.remap-sim__row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.8em; }',
            '.remap-sim__label { font-size: 0.95em; opacity: 0.7; }',
            '.remap-sim__value { font-weight: bold; }',
            '.remap-sim__controls { display: flex; gap: 0.6em; margin-bottom: 1em; flex-wrap: wrap; }',
            '.remap-sim__btn { flex: 1; min-width: 120px; padding: 0.6em 0.8em; background: rgba(255,255,255,0.08); border-radius: 0.5em; text-align: center; cursor: pointer; border: 1px solid rgba(255,255,255,0.1); }',
            '.remap-sim__btn.focus { background: #fff; color: #000; border-color: #fff; }',
            '.remap-sim__btn-title { font-size: 0.75em; opacity: 0.7; margin-bottom: 0.2em; text-transform: uppercase; }',
            '.remap-sim__btn-val { font-size: 1.1em; font-weight: bold; }',
            '.remap-sim__badge { display: inline-block; padding: 0.3em 0.6em; border-radius: 0.4em; font-size: 0.85em; }',
            '.remap-sim__badge--success { background: rgba(76, 175, 80, 0.25); color: #81c784; }',
            '.remap-sim__badge--info { background: rgba(33, 150, 243, 0.25); color: #64b5f6; }',
            '.remap-sim__badge--warning { background: rgba(255, 152, 0, 0.25); color: #ffb74d; }',
            '.remap-sim__badge--neutral { background: rgba(255, 255, 255, 0.15); color: #e0e0e0; }',
            '.remap-sim__arrow { font-size: 1.6em; padding: 0 0.5em; color: #ffc107; text-align: center; }',
            '.remap-sim__result { display: flex; align-items: center; justify-content: space-around; padding: 1em; background: rgba(0,0,0,0.35); border-radius: 0.6em; margin: 1em 0; border: 1px solid rgba(255,255,255,0.05); }',
            '.remap-sim__side { text-align: center; }',
            '.remap-sim__side-title { font-size: 0.8em; opacity: 0.6; margin-bottom: 0.3em; letter-spacing: 0.05em; }',
            '.remap-sim__side-val { font-size: 1.3em; font-weight: bold; }',
            '.remap-sim__rule-actions { display: flex; gap: 0.6em; margin-top: 0.8em; }',
            '.remap-sim__action-btn { flex: 1; padding: 0.6em 0.8em; border-radius: 0.4em; text-align: center; font-size: 0.9em; font-weight: bold; cursor: pointer; border: 1px solid transparent; }',
            '.remap-sim__action-btn--edit { background: rgba(76, 175, 80, 0.25); color: #81c784; border-color: rgba(76, 175, 80, 0.5); }',
            '.remap-sim__action-btn--edit.focus { background: #81c784; color: #000; }',
            '.remap-sim__action-btn--delete { background: rgba(244, 67, 54, 0.25); color: #e57373; border-color: rgba(244, 67, 54, 0.5); }',
            '.remap-sim__action-btn--delete.focus { background: #e57373; color: #000; }',
            '.remap-sim__rule-prompt { padding: 0.8em 1em; background: rgba(255, 152, 0, 0.12); border-left: 3px solid #ff9800; border-radius: 0.4em; margin-top: 0.8em; font-size: 0.9em; }',
            '.remap-sim__presets { display: flex; flex-wrap: wrap; gap: 0.5em; margin-top: 0.8em; }',
            '.remap-sim__preset-btn { flex: 1; min-width: 140px; padding: 0.6em 0.8em; background: rgba(255, 152, 0, 0.2); border: 1px solid rgba(255, 152, 0, 0.6); color: #ffb74d; border-radius: 0.4em; text-align: center; font-size: 0.85em; font-weight: bold; cursor: pointer; }',
            '.remap-sim__preset-btn.focus { background: #ff9800; color: #000; }',
            '.remap-sim__custom-btn { width: 100%; margin-top: 0.6em; padding: 0.6em 0.8em; background: rgba(255, 255, 255, 0.08); border: 1px dashed rgba(255, 255, 255, 0.3); border-radius: 0.4em; text-align: center; font-size: 0.85em; cursor: pointer; }',
            '.remap-sim__custom-btn.focus { background: #fff; color: #000; border-color: #fff; border-style: solid; }',
            '.selectbox-item__icon > .remap-context-icon { width: 1.5em; height: 1.5em; }'
        ].join('\n');
        document.head.appendChild(style);
    }

    /**
     * Відкриття модального вікна симулятора (Dry-Run Tester)
     */
    function openRemapSimulator(initialParams) {
        var params = initialParams || {};
        var card = detectActiveCard(params.card);
        var balanser = params.balanser || getActiveBalanser();
        var s = typeof params.season !== 'undefined' ? parseInt(params.season, 10) || 1 : 1;
        var e = typeof params.episode !== 'undefined' ? parseInt(params.episode, 10) || 1 : 1;

        var prevController = params.prevController || (typeof Lampa !== 'undefined' && Lampa.Controller && Lampa.Controller.enabled() ? Lampa.Controller.enabled().name : 'settings_component');

        var html = $('<div class="remap-sim"></div>');

        function updateUI() {
            html.empty();

            var title = card ? (card.title || card.name || card.original_name || 'Невідомий тайтл') : 'Тайтл не вибрано';
            var showId = getCardId(card);

            var mapped = forward(card, balanser, s, e);
            var titleStr = getCardTitle(card);
            var viewStatus = 'Не переглянуто';
            var percent = 0;

            if (titleStr) {
                var canHash = calculateEpisodeHash(titleStr, mapped.season, mapped.episode);
                var viewObj = origTimelineView ? origTimelineView.call(Lampa.Timeline, canHash) : Lampa.Timeline.view(canHash);
                if (viewObj && viewObj.percent > 0) {
                    percent = viewObj.percent;
                    viewStatus = 'Переглянуто (' + percent + '%)';
                }
            }

            var ruleNote = 'Без ремапу (1-в-1)';
            var badgeClass = 'remap-sim__badge--neutral';

            if (!isRemapEnabled()) {
                ruleNote = 'Ремапінг вимкнено в налаштуваннях';
                badgeClass = 'remap-sim__badge--warning';
            } else if (mapped.matchedRule) {
                ruleNote = 'Правило: ' + mapped.matchedRule.raw;
                badgeClass = 'remap-sim__badge--success';
            } else if (mapped.isHeuristic) {
                ruleNote = 'Автоматична евристика TMDB';
                badgeClass = 'remap-sim__badge--info';
            }

            // Інформаційний блок тайтлу
            var box = $('<div class="remap-sim__box"></div>');
            box.append('<div class="remap-sim__row"><span class="remap-sim__label">Тайтл:</span><span class="remap-sim__value">' + title + ' (ID: ' + (showId || '—') + ')</span></div>');

            // Інтерактивні селектори: Джерело, Сезон, Серія
            var controls = $('<div class="remap-sim__controls"></div>');

            var btnBalanser = $('<div class="remap-sim__btn selector"><div class="remap-sim__btn-title">Джерело</div><div class="remap-sim__btn-val">' + balanser + '</div></div>');
            bindAction(btnBalanser, function () {
                var sources = ['kodik', 'rezka', 'animevost', 'filmix', 'all', 'Ввести інше...'];
                Lampa.Select.show({
                    title: 'Виберіть джерело',
                    items: sources.map(function (src) {
                        return { title: src, selected: src === balanser };
                    }),
                    onBack: function () {
                        Lampa.Controller.toggle('modal');
                    },
                    onSelect: function (selected) {
                        if (selected.title === 'Ввести інше...') {
                            modalSafeInput({
                                title: 'Введіть назву джерела',
                                value: balanser
                            }, function (newBal) {
                                if (newBal) balanser = newBal.toLowerCase().trim();
                                openRemapSimulator({
                                    card: card,
                                    balanser: balanser,
                                    season: s,
                                    episode: e,
                                    prevController: prevController
                                });
                            });
                        } else {
                            balanser = selected.title;
                            Lampa.Modal.close();
                            setTimeout(function () {
                                openRemapSimulator({
                                    card: card,
                                    balanser: balanser,
                                    season: s,
                                    episode: e,
                                    prevController: prevController
                                });
                            }, 50);
                        }
                    }
                });
            });

            var btnSeason = $('<div class="remap-sim__btn selector"><div class="remap-sim__btn-title">Сезон джерела</div><div class="remap-sim__btn-val">' + s + '</div></div>');
            bindAction(btnSeason, function () {
                var maxS = Math.max(10, (card && card.number_of_seasons) || 1);
                var seasonItems = [];
                for (var si = 1; si <= maxS; si++) {
                    seasonItems.push({
                        title: 'Сезон ' + si,
                        seasonNum: si,
                        selected: si === s
                    });
                }
                seasonItems.push({ title: 'Ввести інше число...', action: 'custom' });

                Lampa.Select.show({
                    title: 'Виберіть сезон джерела',
                    items: seasonItems,
                    onBack: function () {
                        Lampa.Controller.toggle('modal');
                    },
                    onSelect: function (selected) {
                        if (selected.action === 'custom') {
                            modalSafeInput({
                                title: 'Введіть номер сезону джерела',
                                value: String(s),
                                layout: 'nums'
                            }, function (newS) {
                                if (newS) {
                                    var parsedS = parseInt(newS, 10);
                                    if (!isNaN(parsedS) && parsedS >= 0) s = parsedS;
                                }
                                openRemapSimulator({
                                    card: card,
                                    balanser: balanser,
                                    season: s,
                                    episode: e,
                                    prevController: prevController
                                });
                            });
                        } else {
                            s = selected.seasonNum;
                            Lampa.Modal.close();
                            setTimeout(function () {
                                openRemapSimulator({
                                    card: card,
                                    balanser: balanser,
                                    season: s,
                                    episode: e,
                                    prevController: prevController
                                });
                            }, 50);
                        }
                    }
                });
            });

            var btnEpisode = $('<div class="remap-sim__btn selector"><div class="remap-sim__btn-title">Серія джерела</div><div class="remap-sim__btn-val">' + e + '</div></div>');
            bindAction(btnEpisode, function () {
                modalSafeInput({
                    title: 'Введіть номер серії джерела',
                    value: String(e),
                    layout: 'nums'
                }, function (newE) {
                    if (newE) {
                        var parsedE = parseInt(newE, 10);
                        if (!isNaN(parsedE) && parsedE > 0) e = parsedE;
                    }
                    openRemapSimulator({
                        card: card,
                        balanser: balanser,
                        season: s,
                        episode: e,
                        prevController: prevController
                    });
                });
            });

            controls.append(btnBalanser);
            controls.append(btnSeason);
            controls.append(btnEpisode);
            box.append(controls);

            // Блок візуалізації трансформації
            var resultCard = $('<div class="remap-sim__result"></div>');
            resultCard.append('<div class="remap-sim__side"><div class="remap-sim__side-title">ДЖЕРЕЛО</div><div class="remap-sim__side-val">S' + s + ' E' + e + '</div></div>');
            resultCard.append('<div class="remap-sim__arrow">➔</div>');
            resultCard.append('<div class="remap-sim__side"><div class="remap-sim__side-title">TMDB КАНІНІЧНИЙ</div><div class="remap-sim__side-val">S' + mapped.season + ' E' + mapped.episode + '</div></div>');
            box.append(resultCard);

            box.append('<div class="remap-sim__row"><span class="remap-sim__label">Статус зіставлення:</span><span class="remap-sim__badge ' + badgeClass + '">' + ruleNote + '</span></div>');
            box.append('<div class="remap-sim__row"><span class="remap-sim__label">Прогрес у Lampa:</span><span class="remap-sim__value">' + viewStatus + '</span></div>');

            // Кнопки редагування та видалення поточного правила, якщо воно активне
            if (mapped.matchedRule) {
                var ruleActions = $('<div class="remap-sim__rule-actions"></div>');
                var btnEditRule = $('<div class="remap-sim__action-btn remap-sim__action-btn--edit selector">✏️ Редагувати правило</div>');
                bindAction(btnEditRule, function () {
                    var currentRuleRaw = mapped.matchedRule.raw;
                    modalSafeInput({
                        title: 'Редагувати правило',
                        value: currentRuleRaw
                    }, function (newRaw) {
                        if (newRaw && newRaw.trim() && newRaw.trim() !== currentRuleRaw) {
                            updateRuleInStorage(currentRuleRaw, newRaw.trim());
                            rebuildSourceHashMap(card, balanser);
                            Lampa.Noty.show('Правило оновлено: ' + newRaw.trim());
                        }
                        openRemapSimulator({
                            card: card,
                            balanser: balanser,
                            season: s,
                            episode: e,
                            prevController: prevController
                        });
                    });
                });

                var btnDeleteRule = $('<div class="remap-sim__action-btn remap-sim__action-btn--delete selector">🗑️ Видалити правило</div>');
                bindAction(btnDeleteRule, function () {
                    deleteRuleFromStorage(mapped.matchedRule.raw);
                    rebuildSourceHashMap(card, balanser);
                    Lampa.Noty.show('Правило видалено');
                    Lampa.Modal.close();
                    setTimeout(function () {
                        openRemapSimulator({
                            card: card,
                            balanser: balanser,
                            season: s,
                            episode: e,
                            prevController: prevController
                        });
                    }, 50);
                });

                ruleActions.append(btnEditRule);
                ruleActions.append(btnDeleteRule);
                box.append(ruleActions);
            }

            // Підказка та швидке додавання правила, якщо тайтл у TMDB має 1 сезон, а джерело віддає сезон 2+
            var totalSeasonsTMDB = (card && card.number_of_seasons) || (card && card.seasons && card.seasons.filter(function (sn) { return sn.season_number > 0; }).length) || 1;
            if (showId && totalSeasonsTMDB <= 1 && s > 1 && !mapped.matchedRule) {
                var tmdbEpCount = (card.seasons && card.seasons[0] && card.seasons[0].episode_count) || card.number_of_episodes || 100;
                var promptBox = $('<div class="remap-sim__rule-prompt"></div>');
                promptBox.append('<div><strong>⚠️ Зверніть увагу:</strong> У TMDB цей тайтл зареєстрований як один суцільний сезон (' + tmdbEpCount + ' серій). Балансер виділив окремий Сезон ' + s + '. Для нормалізації потрібне правило зміщення.</div>');

                var presetsBox = $('<div class="remap-sim__presets"></div>');
                var presetDeltas = [50, 24, 26, 12];
                presetDeltas.forEach(function (delta) {
                    var offset = (s - 1) * delta;
                    var startEp = offset + 1;
                    var pBtn = $('<div class="remap-sim__preset-btn selector">➕ З серії ' + startEp + ' (+' + offset + ')</div>');
                    bindAction(pBtn, function () {
                        var newRule = showId + ':' + balanser + ':offset:' + s + '>1+' + offset;
                        saveRuleToStorage(newRule);
                        rebuildSourceHashMap(card, balanser);
                        Lampa.Noty.show('Правило додано: ' + newRule);
                        Lampa.Modal.close();
                        setTimeout(function () {
                            openRemapSimulator({
                                card: card,
                                balanser: balanser,
                                season: s,
                                episode: e,
                                prevController: prevController
                            });
                        }, 50);
                    });
                    presetsBox.append(pBtn);
                });

                var customBtn = $('<div class="remap-sim__custom-btn selector">✍️ Ввести номер початкової серії або зміщення вручну...</div>');
                bindAction(customBtn, function () {
                    var suggestedStart = (s - 1) * 50 + 1;
                    modalSafeInput({
                        title: 'З якої серії TMDB починається Сезон ' + s + ' джерела?',
                        value: String(suggestedStart),
                        layout: 'nums'
                    }, function (val) {
                        if (val) {
                            var startNum = parseInt(val, 10);
                            if (!isNaN(startNum) && startNum > 0) {
                                var offsetVal = startNum - 1;
                                var newRule = showId + ':' + balanser + ':offset:' + s + '>1+' + offsetVal;
                                saveRuleToStorage(newRule);
                                rebuildSourceHashMap(card, balanser);
                                Lampa.Noty.show('Правило додано: ' + newRule);
                            }
                        }
                        openRemapSimulator({
                            card: card,
                            balanser: balanser,
                            season: s,
                            episode: e,
                            prevController: prevController
                        });
                    });
                });

                promptBox.append(presetsBox);
                promptBox.append(customBtn);
                box.append(promptBox);
            } else if (showId && !mapped.matchedRule) {
                var manualBox = $('<div style="margin-top: 0.8em;"></div>');
                var btnCreateRule = $('<div class="remap-sim__custom-btn selector">➕ Створити власне правило для S' + s + ' джерела...</div>');
                bindAction(btnCreateRule, function () {
                    var defaultRule = showId + ':' + balanser + ':offset:' + s + '>' + s + '+0';
                    modalSafeInput({
                        title: 'Введіть правило (id:джерело:тип:параметри)',
                        value: defaultRule
                    }, function (val) {
                        if (val && val.trim() && val.trim() !== defaultRule) {
                            saveRuleToStorage(val.trim());
                            rebuildSourceHashMap(card, balanser);
                            Lampa.Noty.show('Правило додано: ' + val.trim());
                        }
                        openRemapSimulator({
                            card: card,
                            balanser: balanser,
                            season: s,
                            episode: e,
                            prevController: prevController
                        });
                    });
                });
                manualBox.append(btnCreateRule);
                box.append(manualBox);
            }

            html.append(box);
        }

        updateUI();

        Lampa.Modal.open({
            title: Lampa.Lang.translate('remap_test'),
            html: html,
            size: 'medium',
            buttons: [
                {
                    name: Lampa.Lang.translate('close') || 'Закрити',
                    onSelect: function () {
                        Lampa.Modal.close();
                        Lampa.Controller.toggle(prevController || 'settings_component');
                    }
                }
            ],
            onBack: function () {
                Lampa.Modal.close();
                Lampa.Controller.toggle(prevController || 'settings_component');
            }
        });
    }

    /**
     * Інтеграція з контекстним меню онлайн-балансерів (lampac_online_context_menu)
     */
    function buildRemapMenuItem() {
        return {
            title: Lampa.Lang.translate('remap_title'),
            template: 'selectbox_icon',
            // .selectbox-item__icon > * за замовчуванням 2.7em (app.css) — надто
            // велике для однорядкового пункту меню, тож звужуємо лише свою іконку
            icon: REMAP_ICON_SVG.replace('<svg ', '<svg class="remap-context-icon" '),
            remap_inspect: true
        };
    }

    /**
     * Основний шлях вставки пункту: Lampa.Select.listener 'preshow' (як у LParty). На відміну від
     * глобального window.lampac_online_context_menu, який будь-який плагін може перезаписати
     * (profiles.js присвоює його без ланцюжка, і порядок завантаження на різних origin різний),
     * підписка на подію Select ніхто не стирає.
     * Меню файлу Lampac Online впізнаємо за пунктами clearallmark/timeclearall (є лише в ньому).
     * Сезон/серію беремо з DOM: у момент preshow рядок, на якому було довге натискання, ще
     * має клас .focus; сезон — з тексту фільтра; якщо не вийшло — за замовчуванням 1
     * (у симуляторі значення можна виправити вручну).
     */
    function hookSelectInjection() {
        if (typeof Lampa === 'undefined' || !Lampa.Select || !Lampa.Select.listener || !Lampa.Select.listener.follow) return;

        Lampa.Select.listener.follow('preshow', function (e) {
            try {
                if (!e || !e.active || !Array.isArray(e.active.items)) return;

                var items = e.active.items;
                var isOnlineFileMenu = false;
                var alreadyAdded = false;
                for (var i = 0; i < items.length; i++) {
                    var it = items[i];
                    if (!it) continue;
                    if (it.clearallmark || it.timeclearall) isOnlineFileMenu = true;
                    if (it.remap_inspect) alreadyAdded = true;
                }
                // alreadyAdded — пункт уже додав старий хук lampac_online_context_menu
                if (!isOnlineFileMenu || alreadyAdded) return;

                var ctx = { season: 1, episode: 1 };
                if (typeof $ !== 'undefined') {
                    var row = $('.online-prestige.focus').first();
                    var epNum = parseInt(row.find('.online-prestige__episode-number').first().text(), 10);
                    if (epNum > 0) ctx.episode = epNum;
                    var sm = $('.filter--filter').first().text().match(/(?:Сезон|Season)[^\d]*(\d+)/i);
                    if (sm) ctx.season = parseInt(sm[1], 10) || 1;
                }

                items.push(buildRemapMenuItem());

                var originalOnSelect = e.active.onSelect;
                e.active.onSelect = function (a) {
                    var res;
                    if (originalOnSelect) res = originalOnSelect.apply(this, arguments);
                    if (a && a.remap_inspect) {
                        setTimeout(function () {
                            openRemapSimulator({
                                card: detectActiveCard(null),
                                balanser: getActiveBalanser(),
                                season: ctx.season,
                                episode: ctx.episode
                            });
                        }, 50);
                    }
                    return res;
                };
            } catch (err) {
                console.warn('EpisodeRemap', 'select injection failed:', err);
            }
        });
    }

    function hookOnlineContextMenu() {
        var prevHook = window.lampac_online_context_menu || {};
        var prevPush = prevHook.push;
        var prevOnSelect = prevHook.onSelect;

        window.lampac_online_context_menu = {
            push: function (menu, extra, params) {
                // Чужий хук не має права зламати все меню — і наш також
                try { if (prevPush) prevPush(menu, extra, params); } catch (err) { console.warn('EpisodeRemap', 'prev context menu push failed:', err); }
                if (params && params.element && (typeof params.element.season !== 'undefined' || typeof params.element.episode !== 'undefined')) {
                    menu.push(buildRemapMenuItem());
                }
            },
            onSelect: function (a, params) {
                try { if (prevOnSelect) prevOnSelect(a, params); } catch (err) { console.warn('EpisodeRemap', 'prev context menu onSelect failed:', err); }
                if (a.remap_inspect) {
                    setTimeout(function () {
                        var card = detectActiveCard(params ? (params.movie || params.card) : null);
                        var bal = getActiveBalanser(params ? params.element : null);
                        var s = (params && params.element) ? params.element.season : 1;
                        var e = (params && params.element) ? params.element.episode : 1;

                        openRemapSimulator({
                            card: card,
                            balanser: bal,
                            season: s,
                            episode: e
                        });
                    }, 50);
                }
            }
        };
    }

    /**
     * Реєстрація локалізації
     */
    function registerTranslations() {
        if (!Lampa.Lang) return;
        Lampa.Lang.add({
            remap_title: {
                uk: 'Ремап епізодів',
                ru: 'Ремап эпизодов',
                en: 'Episode Remap'
            },
            remap_version: {
                uk: 'Версія плагіна',
                ru: 'Версия плагина',
                en: 'Plugin Version'
            },
            remap_enabled: {
                uk: 'Увімкнути ремапінг',
                ru: 'Включить ремаппинг',
                en: 'Enable Remap'
            },
            remap_enabled_descr: {
                uk: 'Увімкнення або тимчасове вимкнення правил зіставлення серій',
                ru: 'Включение или временное отключение правил сопоставления серий',
                en: 'Enable or temporarily disable episode mapping rules'
            },
            remap_rules: {
                uk: 'Правила ремапінгу',
                ru: 'Правила ремаппинга',
                en: 'Remap Rules'
            },
            remap_rules_descr: {
                uk: 'Натисніть, щоб переглянути або відредагувати повний список правил зіставлення серій балансерів з TMDB (через крапку з комою)',
                ru: 'Нажмите, чтобы просмотреть или отредактировать полный список правил сопоставления серий балансеров с TMDB (через точку с запятой)',
                en: 'Tap to view or edit the full list of balancer-to-TMDB episode mapping rules (semicolon separated)'
            },
            remap_confirm_clear_title: {
                uk: 'Очистити всі правила ремапінгу?',
                ru: 'Очистить все правила ремаппинга?',
                en: 'Clear all remap rules?'
            },
            remap_confirm_clear_yes: {
                uk: 'Так, очистити все',
                ru: 'Да, очистить всё',
                en: 'Yes, clear all'
            },
            remap_confirm_clear_no: {
                uk: 'Скасувати (залишити правила)',
                ru: 'Отмена (оставить правила)',
                en: 'Cancel (keep rules)'
            },
            remap_test: {
                uk: 'Перегляд та редагування',
                ru: 'Просмотр и редактирование',
                en: 'View and Edit'
            },
            remap_test_descr: {
                uk: 'Перевірити, як інтерпретується епізод обраного серіалу та джерела',
                ru: 'Проверить, как интерпретируется эпизод выбранного сериала и источника',
                en: 'Check how an episode of the selected series and source is mapped'
            },
            close: {
                uk: 'Закрити',
                ru: 'Закрыть',
                en: 'Close'
            },
            remap_rules_export: {
                uk: 'Зберегти правила на сервер',
                ru: 'Сохранить правила на сервер',
                en: 'Save rules to server'
            },
            remap_rules_export_descr: {
                uk: 'Завантажити поточні правила ремапінгу на сервер lampac для синхронізації між пристроями',
                ru: 'Загрузить текущие правила ремаппинга на сервер lampac для синхронизации между устройствами',
                en: 'Upload current remap rules to the lampac server for cross-device sync'
            },
            remap_rules_import: {
                uk: 'Завантажити правила з сервера',
                ru: 'Загрузить правила с сервера',
                en: 'Load rules from server'
            },
            remap_rules_import_descr: {
                uk: 'Замінити локальні правила ремапінгу версією, збереженою на сервері lampac',
                ru: 'Заменить локальные правила ремаппинга версией, сохранённой на сервере lampac',
                en: 'Replace local remap rules with the version saved on the lampac server'
            },
            remap_rules_export_success: {
                uk: 'Правила збережено на сервер',
                ru: 'Правила сохранены на сервер',
                en: 'Rules saved to server'
            },
            remap_rules_export_fail: {
                uk: 'Не вдалося зберегти правила на сервер',
                ru: 'Не удалось сохранить правила на сервер',
                en: 'Failed to save rules to server'
            },
            remap_rules_import_success: {
                uk: 'Правила завантажено з сервера',
                ru: 'Правила загружены с сервера',
                en: 'Rules loaded from server'
            },
            remap_rules_import_fail: {
                uk: 'Не вдалося завантажити правила з сервера',
                ru: 'Не удалось загрузить правила с сервера',
                en: 'Failed to load rules from server'
            },
            remap_confirm_import_title: {
                uk: 'Замінити локальні правила даними з сервера?',
                ru: 'Заменить локальные правила данными с сервера?',
                en: 'Replace local rules with server data?'
            },
            remap_confirm_import_yes: {
                uk: 'Так, замінити',
                ru: 'Да, заменить',
                en: 'Yes, replace'
            }
        });
    }

    // Ключ (path) для власного, точкового зберігання правил ремапу на сервері lampac —
    // окремо від повного "Бекапу" (Modules/Sync/Storage), який переносить УВЕСЬ localStorage.
    // Сервер уже надає генеричний /storage/get|set?path=... ендпоінт (Storage/Controller.cs),
    // тож жодного нового серверного коду не потрібно.
    var REMOTE_RULES_PATH = 'remap_rules';

    /**
     * Пошук уже завантаженого скрипта lampac (bookmark.js/timecode.js) у DOM, щоб визначити
     * host і token сервера lampac без ручного налаштування — той самий патерн, що вже
     * перевірений у Scrob-плагіні (lampac-export.js: findLampacScriptUrl/buildLampacAuth).
     */
    function findLampacScriptUrl() {
        if (typeof document === 'undefined') return null;
        var scripts = document.querySelectorAll('script[src]');
        for (var i = 0; i < scripts.length; i++) {
            var src = scripts[i].src;
            if (src && /\/(bookmark|timecode)(\.js|\/js\/)/.test(src)) return src;
        }
        return null;
    }

    function buildLampacAuth() {
        var scriptUrl = findLampacScriptUrl();
        var host = null;
        var token = '';

        if (scriptUrl) {
            try {
                var parsed = new URL(scriptUrl);
                host = parsed.origin;
                var m = parsed.pathname.match(/\/(?:bookmark|timecode)\/js\/([^/]+)/);
                if (m) token = m[1];
            } catch (e) { /* пошкоджений src — фолбек нижче на window.location.origin */ }
        }
        if (!host || host.indexOf('http') !== 0) {
            // window.location.origin — лише останній фолбек, і лише якщо це справжній
            // http(s)-хост. На Android WebView (file:///android_asset/...) origin буде
            // "file://" чи "null" — не валідний хост для запиту до сервера lampac.
            var fallbackHost = (typeof window !== 'undefined') ? window.location.origin : null;
            host = (fallbackHost && fallbackHost.indexOf('http') === 0) ? fallbackHost : null;
        }

        return {
            host: host,
            token: token,
            uid: Lampa.Storage.get('lampac_unic_id', ''),
            accountEmail: Lampa.Storage.get('account_email', '')
        };
    }

    function appendAuthParam(url, key, value) {
        if (!value) return url;
        return url + (url.indexOf('?') === -1 ? '?' : '&') + key + '=' + encodeURIComponent(value);
    }

    function buildStorageUrl(auth, action) {
        if (!auth || !auth.host) return null;
        var url = auth.host + '/storage/' + action + '?path=' + encodeURIComponent(REMOTE_RULES_PATH);
        url = appendAuthParam(url, 'token', auth.token);
        url = appendAuthParam(url, 'account_email', auth.accountEmail);
        url = appendAuthParam(url, 'uid', auth.uid);
        return url;
    }

    /**
     * Вивантаження поточних правил ремапу на сервер lampac (/storage/set?path=remap_rules).
     */
    function exportRulesToServer(onDone) {
        var auth = buildLampacAuth();
        var url = buildStorageUrl(auth, 'set');
        if (!url || (typeof $ === 'undefined')) { onDone(false, 'no_host'); return; }

        var rules = Lampa.Storage.get('remap_rules', '');
        $.ajax({
            url: url,
            type: 'POST',
            data: rules,
            async: true,
            cache: false,
            contentType: false,
            processData: false,
            success: function (j) {
                onDone(!!(j && j.success), (j && j.success) ? null : 'server');
            },
            error: function () {
                onDone(false, 'network');
            }
        });
    }

    /**
     * Завантаження правил ремапу з сервера lampac (/storage/get?path=remap_rules).
     */
    function importRulesFromServer(onDone) {
        var auth = buildLampacAuth();
        var url = buildStorageUrl(auth, 'get');
        if (!url || (typeof $ === 'undefined')) { onDone(false, 'no_host'); return; }

        $.ajax({
            url: url,
            type: 'GET',
            cache: false,
            dataType: 'json',
            success: function (j) {
                if (j && j.success && typeof j.data === 'string') {
                    onDone(true, j.data);
                } else {
                    onDone(false, 'nodata');
                }
            },
            error: function () {
                onDone(false, 'network');
            }
        });
    }

    /**
     * Реєстрація налаштувань плагіна в Lampa.SettingsApi
     */
    function registerSettings() {
        if (!Lampa.SettingsApi) return;

        Lampa.SettingsApi.addComponent({
            component: 'remap',
            name: Lampa.Lang.translate('remap_title'),
            icon: REMAP_ICON_SVG
        });

        Lampa.SettingsApi.addParam({
            component: 'remap',
            param: {
                name: 'remap_version_info',
                type: 'static'
            },
            field: {
                name: Lampa.Lang.translate('remap_version'),
                description: PLUGIN_VERSION
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'remap',
            param: {
                name: 'remap_enabled',
                type: 'trigger',
                default: true
            },
            field: {
                name: Lampa.Lang.translate('remap_enabled'),
                description: Lampa.Lang.translate('remap_enabled_descr')
            },
            onChange: function () {
                rebuildSourceHashMap(currentActiveCard, getActiveBalanser());
                refreshSettingsIfOpen();
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'remap',
            param: {
                name: 'remap_rules_btn',
                type: 'button',
                default: ''
            },
            field: {
                name: Lampa.Lang.translate('remap_rules'),
                description: Lampa.Lang.translate('remap_rules_descr')
            },
            onChange: function () {
                var currentRules = (Lampa.Storage.get('remap_rules', '') || '').trim();
                modalSafeInput({
                    title: Lampa.Lang.translate('remap_rules'),
                    value: currentRules
                }, function (newVal) {
                    if (newVal === null || typeof newVal === 'undefined') return;
                    var trimmed = newVal.trim();
                    if (trimmed === currentRules) return;

                    // Якщо поле стало порожнім, але раніше правила були — захист від випадкового Back на Android
                    if (!trimmed && currentRules) {
                        Lampa.Select.show({
                            title: Lampa.Lang.translate('remap_confirm_clear_title'),
                            items: [
                                {
                                    title: Lampa.Lang.translate('remap_confirm_clear_no'),
                                    cancel: true
                                },
                                {
                                    title: Lampa.Lang.translate('remap_confirm_clear_yes'),
                                    confirm: true
                                }
                            ],
                            onSelect: function (a) {
                                if (a.confirm) {
                                    Lampa.Storage.set('remap_rules', '');
                                    rebuildSourceHashMap(currentActiveCard, getActiveBalanser());
                                    refreshSettingsIfOpen();
                                } else {
                                    refreshSettingsIfOpen();
                                }
                            },
                            onBack: function () {
                                refreshSettingsIfOpen();
                            }
                        });
                        return;
                    }

                    Lampa.Storage.set('remap_rules', trimmed);
                    rebuildSourceHashMap(currentActiveCard, getActiveBalanser());
                    refreshSettingsIfOpen();
                });
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'remap',
            param: {
                name: 'remap_test_btn',
                type: 'button',
                default: ''
            },
            field: {
                name: Lampa.Lang.translate('remap_test'),
                description: Lampa.Lang.translate('remap_test_descr')
            },
            onChange: function () {
                openRemapSimulator();
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'remap',
            param: {
                name: 'remap_rules_export_btn',
                type: 'button',
                default: ''
            },
            field: {
                name: Lampa.Lang.translate('remap_rules_export'),
                description: Lampa.Lang.translate('remap_rules_export_descr')
            },
            onChange: function () {
                if (Lampa.Loading) Lampa.Loading.start();
                exportRulesToServer(function (ok, err) {
                    if (Lampa.Loading) Lampa.Loading.stop();
                    var msg = Lampa.Lang.translate(ok ? 'remap_rules_export_success' : 'remap_rules_export_fail');
                    Lampa.Noty.show(msg + (!ok && err ? ' (' + err + ')' : ''));
                });
            }
        });

        Lampa.SettingsApi.addParam({
            component: 'remap',
            param: {
                name: 'remap_rules_import_btn',
                type: 'button',
                default: ''
            },
            field: {
                name: Lampa.Lang.translate('remap_rules_import'),
                description: Lampa.Lang.translate('remap_rules_import_descr')
            },
            onChange: function () {
                Lampa.Select.show({
                    title: Lampa.Lang.translate('remap_confirm_import_title'),
                    items: [
                        {
                            title: Lampa.Lang.translate('remap_confirm_clear_no'),
                            cancel: true
                        },
                        {
                            title: Lampa.Lang.translate('remap_confirm_import_yes'),
                            confirm: true
                        }
                    ],
                    onSelect: function (a) {
                        if (a.confirm) {
                            if (Lampa.Loading) Lampa.Loading.start();
                            importRulesFromServer(function (ok, data) {
                                if (Lampa.Loading) Lampa.Loading.stop();
                                if (ok) {
                                    var trimmed = (data || '').trim();
                                    Lampa.Storage.set('remap_rules', trimmed);
                                    rebuildSourceHashMap(currentActiveCard, getActiveBalanser());
                                    Lampa.Noty.show(Lampa.Lang.translate('remap_rules_import_success'));
                                } else {
                                    Lampa.Noty.show(Lampa.Lang.translate('remap_rules_import_fail') + (data ? ' (' + data + ')' : ''));
                                }
                                refreshSettingsIfOpen();
                            });
                        } else {
                            refreshSettingsIfOpen();
                        }
                    },
                    onBack: function () {
                        refreshSettingsIfOpen();
                    }
                });
            }
        });
    }

    /**
     * Головна функція запуску плагіна після готовності оточення Lampa
     */
    function init() {
        registerTranslations();
        injectCSS();
        hookTimeline();
        hookPlayer();
        hookOnlineContextMenu();
        hookSelectInjection();
        registerSettings();

        // Реактивне оновлення таблиці хешів при зміні балансера, профілю чи статусу активності
        if (Lampa.Storage && Lampa.Storage.listener) {
            Lampa.Storage.listener.follow('change', function (e) {
                if (e && (e.name === 'active_balanser' || e.name === 'online_balanser' || e.name === 'online_last_balanser' || e.name === 'lampac_profile_id' || e.name === 'remap_enabled')) {
                    rebuildSourceHashMap(currentActiveCard, getActiveBalanser());
                }
            });
        }

        // Слухачі зміни профілю (плагін profiles.js та Lampa core)
        if (typeof window !== 'undefined' && window.addEventListener) {
            window.addEventListener('lwsEvent', function (e) {
                if (e && e.detail && e.detail.name === 'profile_synced') {
                    rebuildSourceHashMap(currentActiveCard, getActiveBalanser());
                }
            });
        }
        if (typeof document !== 'undefined' && document.addEventListener) {
            document.addEventListener('lwsEvent', function (e) {
                if (e && e.detail && e.detail.name === 'profile_synced') {
                    rebuildSourceHashMap(currentActiveCard, getActiveBalanser());
                }
            });
        }

        if (Lampa.Listener) {
            Lampa.Listener.follow('profile', function () {
                rebuildSourceHashMap(currentActiveCard, getActiveBalanser());
            });
        }

        // Автоматична побудова мапи при відкритті картки серіалу
        if (Lampa.Listener) {
            Lampa.Listener.follow('full', function (e) {
                if (e && (e.type === 'complite' || e.type === 'ready')) {
                    var movie = (e.data && e.data.movie) || (e.object && e.object.card);
                    if (movie && (movie.original_name || movie.number_of_seasons)) {
                        currentActiveCard = movie;
                        rebuildSourceHashMap(movie, getActiveBalanser());
                    }
                }
            });
        }

        // Публічний сервіс (Public API)
        Lampa.EpisodeRemap = {
            version: PLUGIN_VERSION,
            isEnabled: isRemapEnabled,
            forward: forward,
            reverse: reverse,
            parseRule: parseRule,
            getAllRules: getAllRules,
            saveRule: saveRuleToStorage,
            updateRule: updateRuleInStorage,
            deleteRule: deleteRuleFromStorage,
            rebuildSourceHashMap: rebuildSourceHashMap,
            getActiveBalanser: getActiveBalanser,
            autoResolveAbsolute: autoResolveAbsolute,
            calculateEpisodeHash: calculateEpisodeHash,
            openSimulator: openRemapSimulator,
            exportRulesToServer: exportRulesToServer,
            importRulesFromServer: importRulesFromServer
        };

        console.log('EpisodeRemap', 'Plugin v' + PLUGIN_VERSION + ' successfully initialized');
    }

    // Bootstrap очікування готовності додатку
    if (window.appready) {
        init();
    } else if (typeof Lampa !== 'undefined' && Lampa.Listener) {
        Lampa.Listener.follow('app', function (e) {
            if (e.type === 'ready') init();
        });
    } else {
        var timer = setInterval(function () {
            if (typeof Lampa !== 'undefined' && Lampa.Listener) {
                clearInterval(timer);
                if (window.appready) {
                    init();
                } else {
                    Lampa.Listener.follow('app', function (e) {
                        if (e.type === 'ready') init();
                    });
                }
            }
        }, 100);
    }
})();
