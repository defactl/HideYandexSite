// ==UserScript==
// @name         Yandex Search Filter v6.0 (Unblock Button)
// @namespace    http://tampermonkey.net/
// @version      6.0
// @description  Добавлена кнопка разблокировки (Restore) в режиме Reveal
// @author       Senior Dev
// @match        *://yandex.ru/*
// @match        *://*.yandex.ru/*
// @match        *://ya.ru/*
// @match        *://*.yandex.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    const STATE = {
        blocked: new Set(GM_getValue('blockedDomains', [])),
        isRevealed: false
    };

    /**
     * СТИЛИ: Логика переключения кнопок
     */
    const injectStaticStyles = () => {
        const style = document.createElement('style');
        style.id = 'tm-yandex-filter-static';
        style.textContent = `
            .tm-is-blocked { display: none !important; }

            /* REVEAL MODE */
            body.tm-reveal-blocked .tm-is-blocked {
                display: block !important;
                opacity: 0.5 !important; /* Чуть прозрачнее */
                filter: grayscale(1) !important;
                border: 1px dashed #ff4444 !important;
                position: relative;
            }

            /* ОБЩИЕ СТИЛИ КНОПОК */
            .tm-ctrl-btn {
                display: inline-flex !important; justify-content: center; align-items: center;
                width: 18px; height: 18px; margin-left: 8px;
                border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: bold;
                user-select: none; transition: all 0.2s;
            }
            
            /* КНОПКА БЛОКИРОВКИ (Крестик) */
            .tm-block-btn {
                background: #ff4444 !important; color: #fff !important;
                opacity: 0.4;
            }
            .tm-block-btn:hover { opacity: 1; }

            /* КНОПКА РАЗБЛОКИРОВКИ (Зеленая стрелка) */
            .tm-unblock-btn {
                background: #44cc44 !important; color: #fff !important;
                display: none !important; /* Скрыта по умолчанию */
                opacity: 0.8;
                box-shadow: 0 0 5px rgba(0,255,0,0.5);
            }
            .tm-unblock-btn:hover { opacity: 1; transform: scale(1.1); }

            /* ЛОГИКА ПЕРЕКЛЮЧЕНИЯ (CSS Magic) */
            /* Если элемент заблокирован: скрываем крестик, показываем кнопку восстановления */
            .tm-is-blocked .tm-block-btn { display: none !important; }
            .tm-is-blocked .tm-unblock-btn { display: inline-flex !important; }

            /* UI TOGGLE BUTTON */
            #tm-reveal-toggle {
                position: fixed; bottom: 20px; right: 20px;
                width: 32px; height: 32px; background: #333; color: #fff;
                display: flex; align-items: center; justify-content: center;
                border-radius: 50%; font-size: 14px; cursor: pointer;
                z-index: 10000; user-select: none; opacity: 0.5;
                transition: all 0.2s; border: 1px solid #555;
            }
            #tm-reveal-toggle:hover { opacity: 1; transform: scale(1.1); }
            #tm-reveal-toggle.active { background: #ff4444; border-color: #cc0000; opacity: 1; }
            
            /* BUBBLE COUNT */
            #tm-reveal-toggle::after {
                content: attr(data-count);
                position: absolute; top: -6px; right: -6px;
                background: #fff; color: #ff4444;
                font-size: 10px; font-weight: bold; font-family: sans-serif;
                padding: 1px 4px; border-radius: 10px;
                border: 1px solid #ff4444;
                display: none;
            }
            #tm-reveal-toggle.active::after { display: block; }
        `;
        (document.head || document.documentElement).appendChild(style);
    };

    /**
     * UTILS
     */
    const getDomain = (url) => {
        try {
            const u = new URL(url);
            if (!u.protocol.startsWith('http')) return null;
            let host = u.hostname.replace(/^www\./, '');
            if (host.includes('yandex.') || host === 'ya.ru') return null;
            return host;
        } catch (e) { return null; }
    };

    const findCard = (el) => {
        return el.closest('li') || el.closest('[data-cid]') || el.closest('article');
    };

    const updateToggleButton = () => {
        const blockedOnPage = document.querySelectorAll('.tm-is-blocked').length;
        let btn = document.getElementById('tm-reveal-toggle');

        if (blockedOnPage > 0 || STATE.isRevealed) {
            if (!btn) {
                btn = document.createElement('div');
                btn.id = 'tm-reveal-toggle';
                btn.onclick = api.toggleReveal;
                btn.title = "Показать/Скрыть заблокированные";
                document.body.appendChild(btn);
            }
            btn.textContent = STATE.isRevealed ? '✕' : '👁';
            btn.classList.toggle('active', STATE.isRevealed);
            btn.setAttribute('data-count', blockedOnPage);
        } else if (btn) {
            btn.remove();
        }
    };

    /**
     * DOM PROCESSOR
     */
    const processNode = (root) => {
        if (!root || typeof root.querySelectorAll !== 'function') return;
        const links = root.querySelectorAll('a[href]:not([data-tm-processed])');
        
        links.forEach(link => {
            const domain = getDomain(link.href);
            if (!domain) return;
            const card = findCard(link);
            if (!card) return;

            if (!card.hasAttribute('data-tm-domain')) card.setAttribute('data-tm-domain', domain);
            
            // Синхронизация состояния при первой отрисовке
            if (STATE.blocked.has(domain)) {
                card.classList.add('tm-is-blocked');
            }

            const isTitle = link.querySelector('h2, h3') || link.closest('h2, h3') || link.classList.contains('OrganicTitle-Link');
            
            // Если это заголовок и мы еще не добавили кнопки
            if (isTitle && !card.hasAttribute('data-tm-btn-ready')) {
                const container = (link.querySelector('h2, h3') || link);

                // 1. Кнопка БЛОКИРОВКИ (Красная)
                const btnBlock = document.createElement('span');
                btnBlock.className = 'tm-ctrl-btn tm-block-btn';
                btnBlock.textContent = '×';
                btnBlock.title = `Скрыть ${domain}`;
                btnBlock.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (confirm(`Скрыть ${domain}?`)) api.add(domain);
                };

                // 2. Кнопка РАЗБЛОКИРОВКИ (Зеленая)
                const btnUnblock = document.createElement('span');
                btnUnblock.className = 'tm-ctrl-btn tm-unblock-btn';
                btnUnblock.innerHTML = '&#8634;'; // Символ возврата (стрелочка)
                btnUnblock.title = `Восстановить ${domain}`;
                btnUnblock.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (confirm(`Вернуть ${domain} в поиск?`)) api.remove(domain);
                };

                // Добавляем обе кнопки. CSS сам решит, какую показывать.
                container.appendChild(btnBlock);
                container.appendChild(btnUnblock);
                
                card.setAttribute('data-tm-btn-ready', 'true');
            }
            link.setAttribute('data-tm-processed', 'true');
        });
        updateToggleButton();
    };

    /**
     * API
     */
    const api = {
        add: (domain) => {
            STATE.blocked.add(domain);
            GM_setValue('blockedDomains', Array.from(STATE.blocked));
            // Добавляем класс -> CSS скрывает "X" и показывает "Restore"
            document.querySelectorAll(`[data-tm-domain="${domain}"]`).forEach(el => el.classList.add('tm-is-blocked'));
            updateToggleButton();
        },
        remove: (domain) => {
            STATE.blocked.delete(domain);
            GM_setValue('blockedDomains', Array.from(STATE.blocked));
            // Удаляем класс -> CSS показывает "X" и скрывает "Restore"
            document.querySelectorAll(`[data-tm-domain="${domain}"]`).forEach(el => el.classList.remove('tm-is-blocked'));
            updateToggleButton();
        },
        toggleReveal: () => {
            STATE.isRevealed = !STATE.isRevealed;
            document.body.classList.toggle('tm-reveal-blocked', STATE.isRevealed);
            updateToggleButton();
        },
        list: () => console.table(Array.from(STATE.blocked)),
        export: () => {
            const data = JSON.stringify(Array.from(STATE.blocked), null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
            a.download = `yandex-blocklist.json`; a.click();
        },
        import: () => {
            const input = document.createElement('input'); input.type = 'file';
            input.onchange = (e) => {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    JSON.parse(ev.target.result).forEach(d => STATE.blocked.add(d));
                    GM_setValue('blockedDomains', Array.from(STATE.blocked)); location.reload();
                };
                reader.readAsText(e.target.files[0]);
            };
            input.click();
        },
        clear: () => { if(confirm('Clear all?')) { STATE.blocked.clear(); GM_setValue('blockedDomains', []); location.reload(); } }
    };

    /**
     * INIT (FIXED PERFORMANCE)
     */
    const init = () => {
        injectStaticStyles();

        // FIX: Observer теперь вызывает и процессинг нод, и обновление кнопки
        const observer = new MutationObserver((mutations) => {
            // Используем rAF для группировки вызовов
            requestAnimationFrame(() => {
                // Оптимизация: обрабатываем только добавленные ноды, если возможно
                // Но для надежности в React-среде проще прогнать processNode по дельте
                mutations.forEach(m => {
                    if (m.addedNodes.length) processNode(m.target);
                });
                updateToggleButton();
            });
        });

        // Первичный проход
        processNode(document.body);

        // Наблюдаем за всем деревом
        observer.observe(document.body, { childList: true, subtree: true });

        // Fallback таймер (можно увеличить интервал, так как Observer теперь работает корректно)
        setInterval(() => processNode(document.body), 4000);
    };

    if (typeof unsafeWindow !== 'undefined') unsafeWindow.yandexFilter = api;
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();