(function () {
    'use strict';

    /**
     *  timecode-fix
     *  Версія: 1.1
     *
     *  Мікро-плагін для виправлення бага у lampac timecode plugin - 
     *  бейджи "переглянуто" не оновлюються після синхронізації з сервером.
     */

    // Захист від подвійного завантаження
    if (window.timecode_fix_loaded) return;
    window.timecode_fix_loaded = true;

    var timer = setInterval(function () {
        if (typeof Lampa === 'undefined') return;
        if (!Lampa.Storage || typeof Lampa.Storage.set !== 'function') return;
        if (!Lampa.Timeline || typeof Lampa.Timeline.read !== 'function') return;
        clearInterval(timer);

        // Перехоплюємо Lampa.Storage.set щоб виявляти запис file_view з nolisten=true.
        // Це відбувається у lampac timecode plugin після отримання даних з сервера.
        // Без цього Lampa.Timeline.viewed$1 (in-memory кеш) залишається застарілим
        // і бейджи "переглянуто" не оновлюються на поточній картці.
        var _originalSet = Lampa.Storage.set;

        Lampa.Storage.set = function (name, value, nolisten, callerror) {
            _originalSet.call(this, name, value, nolisten, callerror);

            if (nolisten && typeof name === 'string' && name.indexOf('file_view') === 0) {
                // Оновлюємо in-memory кеш viewed$1 і тригеримо reason:'read' (для watched-бейджів)
                Lampa.Timeline.read();

                // listenerTimeline у компонентах епізодів реагує лише на reason:'update' + hash.
                // Тому вручну надсилаємо подію для кожного хешу з нових даних —
                // це оновлює бейджи "переглянуто" для вже відкритої картки серіалу.
                if (value && typeof value === 'object') {
                    for (var hash in value) {
                        Lampa.Listener.send('state:changed', {
                            target: 'timeline',
                            reason: 'update',
                            data: {
                                hash: hash,
                                road: value[hash]
                            }
                        });
                    }
                }
            }
        };

    }, 100);

})();
