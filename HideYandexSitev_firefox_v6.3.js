// ==UserScript==
// @name         Yandex Search Filter v6.2 (CPU Optimized)
// @namespace    http://tampermonkey.net/
// @version      6.2
// @description  Исправлена нагрузка на CPU в Firefox (Debounce strategy)
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
     * СТИЛИ
     */
    const injectStaticStyles = () => {
        const style = document.createElement('style');
        style.id = 'tm-yandex-filter-static';
        style.textContent = `
            .tm-is-blocked { display: none !important; }
            body.tm-reveal-blocked .tm-is-blocked {
                display: block !important; opacity: 0.5 !important;
                filter: grayscale(1) !important; border: 1px dashed #ff4444 !important;
                position: relative; pointer-events: none !important;
            }
            .tm-ctrl-btn {
                display: inline-flex !important; justify-content: center; align-items: center;
                width: 18px; height: 18px; margin-left: 8px; border-radius: 4px;
                cursor: pointer; font-size: 13px; font-weight: bold;
                user-select: none; transition: all 0.2s; pointer-events: auto !important;
            }
            .tm-block-btn { background: #ff4444 !important; color: #fff !important; opacity: 0.4; }
            .tm-block-btn:hover { opacity: 1; }
            .tm-unblock-btn {
                background: #44cc44 !important; color: #fff !important; display: none !important;
                opacity: 0.9; box-shadow: 0 0 5px rgba(0,255,0,0.5); z-index: 100;
            }
            .tm-unblock-btn:hover { opacity: 1; transform: scale(1.1); }
            .tm-is-blocked .tm-block-btn { display: none !important; }
            .tm-is-blocked .tm-unblock-btn { display: inline-flex !important; }
            #tm-reveal-toggle {
                position: fixed; bottom: 20px; right: 20px; width: 32px; height: 32px;
                background: #333; color: #fff; display: flex; align-items: center;
                justify-content: center; border-radius: 50%; font-size: 14px;
                cursor: pointer; z-index: 10000; user-select: none; opacity: 0.5;
                transition: all 0.2s; border: 1px solid #555;
            }
            #tm-reveal-toggle:hover { opacity: 1; transform: scale(1.1); }
            #tm-reveal-toggle.active { background: #ff4444; border-color: #cc0000; opacity: 1; }
            #tm-reveal-toggle::after {
                content: attr(data-count); position: absolute; top: -6px; right: -6px;
                background: #fff; color: #ff4444; font-size: 10px; font-weight: bold;
                font-family: sans-serif; padding: 1px 4px; border-radius: 10px;
                border: 1px solid #ff4444; display: none;
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
        // Оптимизация: берем только те ссылки, которые мы еще не трогали
        const links = root.querySelectorAll('a[href]:not([data-tm-processed])');
        
        links.forEach(link => {
            const domain = getDomain(link.href);
            if (!domain) return;
            const card = findCard(link);
            if (!card) return;

            if (!card.hasAttribute('data-tm-domain')) card.setAttribute('data-tm-domain', domain);
            
            if (STATE.blocked.has(domain)) card.classList.add('tm-is-blocked');

            const isTitle = link.querySelector('h2, h3') || link.closest('h2, h3') || link.classList.contains('OrganicTitle-Link');
            
            if (isTitle && !card.hasAttribute('data-tm-btn-ready')) {
                const container = (link.querySelector('h2, h3') || link);
                
                const btnBlock = document.createElement('span');
                btnBlock.className = 'tm-ctrl-btn tm-block-btn';
                btnBlock.textContent = '×';
                btnBlock.title = `Скрыть ${domain}`;
                btnBlock.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (confirm(`Скрыть ${domain}?`)) api.add(domain);
                };

                const btnUnblock = document.createElement('span');
                btnUnblock.className = 'tm-ctrl-btn tm-unblock-btn';
                btnUnblock.innerHTML = '&#8634;'; 
                btnUnblock.title = `Восстановить ${domain}`;
                btnUnblock.onclick = (e) => {
                    e.preventDefault(); e.stopPropagation();
                    if (confirm(`Вернуть ${domain} в поиск?`)) api.remove(domain);
                };

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
            document.querySelectorAll(`[data-tm-domain="${domain}"]`).forEach(el => el.classList.add('tm-is-blocked'));
            updateToggleButton();
        },
        remove: (domain) => {
            STATE.blocked.delete(domain);
            GM_setValue('blockedDomains', Array.from(STATE.blocked));
            document.querySelectorAll(`[data-tm-domain="${domain}"]`).forEach(el => el.classList.remove('tm-is-blocked'));
            updateToggleButton();
        },
        toggleReveal: () => {
            STATE.isRevealed = !STATE.isRevealed;
            document.body.classList.toggle('tm-reveal-blocked', STATE.isRevealed);
            updateToggleButton();
        },
        stats: () => {
            const total = STATE.blocked.size;
            const onPage = document.querySelectorAll('.tm-is-blocked').length;
            console.log(`База: ${total}, На странице: ${onPage}`);
            return { total, onPage };
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
     * INIT (CPU OPTIMIZED)
     */
    const init = () => {
        injectStaticStyles();

        let debounceTimer;

        // MutationObserver теперь не запускает обработку мгновенно
        const observer = new MutationObserver((mutations) => {
            // 1. Проверяем, есть ли реальные добавленные узлы (игнорируем смену классов)
            let hasNewNodes = false;
            for (let i = 0; i < mutations.length; i++) {
                if (mutations[i].addedNodes.length > 0) {
                    hasNewNodes = true;
                    break;
                }
            }
            if (!hasNewNodes) return;

            // 2. Сбрасываем таймер при каждом новом событии
            clearTimeout(debounceTimer);

            // 3. Запускаем обработку только если поток событий прекратился на 150мс
            debounceTimer = setTimeout(() => {
                processNode(document.body);
            }, 150); 
        });

        // Первичная обработка
        processNode(document.body);

        observer.observe(document.body, { childList: true, subtree: true });

        // Резервная проверка реже (раз в 5 секунд вместо 3), чтобы не грузить CPU
        setInterval(() => processNode(document.body), 5000);
    };

    if (typeof unsafeWindow !== 'undefined') unsafeWindow.yandexFilter = api;
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
