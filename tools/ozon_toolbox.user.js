// ==UserScript==
// @name         Ozon Seller Toolbox
// @namespace    http://tampermonkey.net/
// @version      4.12
// @description  Полный набор: товары + склады (API v3) + цены + SKU + реклама + перехватчик
// @author       You
// @match        https://seller.ozon.ru/*
// @grant        none
// @run-at       document-start
// @updateURL    file:///C:/Users/regis/OneDrive/Рабочий%20стол/Проект%20Озон/ozon-seller-scripts/tools/ozon_toolbox.user.js
// @downloadURL  file:///C:/Users/regis/OneDrive/Рабочий%20стол/Проект%20Озон/ozon-seller-scripts/tools/ozon_toolbox.user.js
// ==/UserScript==

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // ОТЛАДКА
    // ═══════════════════════════════════════════════════════════════════════════
    
    // DEBUG можно переключать через localStorage: _ozonToolboxDebug = true/false
    const DEBUG = JSON.parse(localStorage.getItem('_ozonToolboxDebug') ?? 'true');
    const MAX_CAPTURED_REQUESTS = 500; // Лимит запросов в localStorage
    
    /**
     * Защита от XSS-инъекций (работает при document-start, без DOM)
     * @param {string} text - Текст для экранирования
     * @returns {string} Экранированный текст
     */
    function escapeHtml(text) {
        if (!text) return '';
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * Форматирует текущую дату в формате DD.MM.YYYY
     * @returns {string} Дата в формате DD.MM.YYYY
     */
    function formatTodayDate() {
        const today = new Date();
        const day = String(today.getDate()).padStart(2, '0');
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const year = today.getFullYear();
        return `${day}.${month}.${year}`;
    }

    /**
     * Форматирует текущую дату в формате YYYY-MM-DD (ISO)
     * @returns {string} Дата в формате YYYY-MM-DD
     */
    function formatTodayDateISO() {
        return new Date().toISOString().split('T')[0];
    }
    
    /**
     * Логирование отладочных сообщений (при DEBUG=true)
     * @param {string} module - Название модуля
     * @param {string} message - Сообщение
     * @param {*} [data] - Дополнительные данные
     */
    function debugLog(module, message, data = null) {
        if (!DEBUG) return;
        const timestamp = new Date().toLocaleTimeString();
        const prefix = `[${timestamp}] [OzonToolbox:${module}]`;
        if (data) {
            console.log(prefix, message, data);
        } else {
            console.log(prefix, message);
        }
    }
    
    /**
     * Логирование ошибок (всегда выводится)
     * @param {string} module - Название модуля
     * @param {string} message - Сообщение об ошибке
     * @param {Error} error - Объект ошибки
     */
    function debugError(module, message, error) {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = `[${timestamp}] [OzonToolbox:${module}] ERROR:`;
        console.error(prefix, message, error);
        if (error?.stack) {
            console.error('Stack:', error.stack);
        }
    }

    function safeStringify(obj, maxLen = 5000) {
        try {
            const s = JSON.stringify(obj);
            if (!s) return '';
            return s.length > maxLen ? s.slice(0, maxLen) + '…' : s;
        } catch {
            return '[unserializable]';
        }
    }

    function sanitizeSensitive(value, depth = 0) {
        if (depth > 6) return '[truncated]';
        if (value == null) return value;

        const t = typeof value;
        if (t === 'string') {
            // Ограничим длинные строки
            return value.length > 1000 ? value.slice(0, 1000) + '…' : value;
        }
        if (t === 'number' || t === 'boolean') return value;

        if (Array.isArray(value)) {
            return value.slice(0, 50).map(v => sanitizeSensitive(v, depth + 1));
        }

        if (t === 'object') {
            const out = {};
            const keys = Object.keys(value).slice(0, 100);
            for (const k of keys) {
                if (/token|authorization|cookie|password|pass|secret|session|bearer/i.test(k)) {
                    out[k] = '[redacted]';
                    continue;
                }
                out[k] = sanitizeSensitive(value[k], depth + 1);
            }
            return out;
        }

        return '[unsupported]';
    }

    debugLog('Init', 'Скрипт запущен, document.readyState:', document.readyState);

    // ═══════════════════════════════════════════════════════════════════════════
    // СИСТЕМА УВЕДОМЛЕНИЙ (очередь с таймер-полоской)
    // ═══════════════════════════════════════════════════════════════════════════

    const NotificationSystem = {
        container: null,
        queue: [],
        maxVisible: 8,
        defaultDuration: 5000,

        init() {
            try {
                if (this.container) return;
                debugLog('Notifications', 'Инициализация системы уведомлений...');
                
                // Стили
                const style = document.createElement('style');
                style.textContent = `
                #ozon-notifications {
                    position: fixed;
                    top: 10px;
                    right: 345px;
                    z-index: 999998;
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-height: calc(100vh - 20px);
                    overflow: hidden;
                    pointer-events: none;
                }
                
                .ozon-notif {
                    background: #1a1a2e;
                    border-radius: 8px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.4);
                    border: 1px solid #16213e;
                    min-width: 280px;
                    max-width: 350px;
                    overflow: hidden;
                    animation: notifSlideIn 0.3s ease;
                    pointer-events: auto;
                    position: relative;
                }
                
                .ozon-notif.removing {
                    animation: notifSlideOut 0.3s ease forwards;
                }
                
                @keyframes notifSlideIn {
                    from { opacity: 0; transform: translateX(50px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                
                @keyframes notifSlideOut {
                    from { opacity: 1; transform: translateX(0); }
                    to { opacity: 0; transform: translateX(50px); }
                }
                
                .ozon-notif-content {
                    padding: 12px 14px;
                    display: flex;
                    align-items: flex-start;
                    gap: 10px;
                }
                
                .ozon-notif-icon {
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 12px;
                    flex-shrink: 0;
                    margin-top: 1px;
                }
                
                .ozon-notif-icon.success { background: #28a745; color: #fff; }
                .ozon-notif-icon.error { background: #dc3545; color: #fff; }
                .ozon-notif-icon.info { background: #005bff; color: #fff; }
                .ozon-notif-icon.warning { background: #ffc107; color: #000; }
                
                .ozon-notif-body {
                    flex: 1;
                    min-width: 0;
                }
                
                .ozon-notif-title {
                    font-weight: 600;
                    font-size: 13px;
                    color: #fff;
                    margin-bottom: 2px;
                }
                
                .ozon-notif-message {
                    font-size: 12px;
                    color: #b0b0b0;
                    word-break: break-word;
                }
                
                .ozon-notif-close {
                    background: none;
                    border: none;
                    color: #666;
                    cursor: pointer;
                    font-size: 16px;
                    padding: 0;
                    line-height: 1;
                    margin-left: 8px;
                }
                
                .ozon-notif-close:hover { color: #fff; }
                
                .ozon-notif-timer {
                    height: 3px;
                    background: #333;
                    position: relative;
                    overflow: hidden;
                }
                
                .ozon-notif-timer-bar {
                    height: 100%;
                    position: absolute;
                    left: 0;
                    top: 0;
                    animation: timerShrink linear forwards;
                }
                
                .ozon-notif-timer-bar.success { background: #28a745; }
                .ozon-notif-timer-bar.error { background: #dc3545; }
                .ozon-notif-timer-bar.info { background: #005bff; }
                .ozon-notif-timer-bar.warning { background: #ffc107; }
                
                @keyframes timerShrink {
                    from { width: 100%; }
                    to { width: 0%; }
                }
                `;
                document.head.appendChild(style);
                
                // Контейнер
                this.container = document.createElement('div');
                this.container.id = 'ozon-notifications';
                document.body.appendChild(this.container);
                debugLog('Notifications', 'Система уведомлений инициализирована');
            } catch (error) {
                debugError('Notifications', 'Ошибка инициализации', error);
            }
        },

        /**
         * Показать уведомление
         * @param {Object} options
         * @param {string} options.title - Заголовок
         * @param {string} options.message - Сообщение
         * @param {string} options.type - success | error | info | warning
         * @param {number} options.duration - Время показа (мс), 0 = не скрывать
         */
        show({ title = '', message = '', type = 'info', duration = this.defaultDuration }) {
            try {
                this.init();

                const allowedTypes = new Set(['success', 'error', 'info', 'warning']);
                const safeType = allowedTypes.has(type) ? type : 'info';
                
                const icons = {
                    success: '✓',
                    error: '✗',
                    info: 'ℹ',
                    warning: '⚠'
                };
                
                // Экранируем HTML для защиты от XSS
                const safeTitle = escapeHtml(title);
                const safeMessage = escapeHtml(message);
                
                const notif = document.createElement('div');
                notif.className = 'ozon-notif';
                notif.innerHTML = `
                    <div class="ozon-notif-content">
                        <div class="ozon-notif-icon ${safeType}">${icons[safeType] || 'ℹ'}</div>
                        <div class="ozon-notif-body">
                            ${safeTitle ? `<div class="ozon-notif-title">${safeTitle}</div>` : ''}
                            ${safeMessage ? `<div class="ozon-notif-message">${safeMessage}</div>` : ''}
                        </div>
                        <button class="ozon-notif-close">×</button>
                    </div>
                    ${duration > 0 ? `
                    <div class="ozon-notif-timer">
                        <div class="ozon-notif-timer-bar ${safeType}" style="animation-duration: ${duration}ms"></div>
                    </div>
                    ` : ''}
                `;
                
                // Закрытие по клику
                notif.querySelector('.ozon-notif-close').addEventListener('click', () => {
                    this.remove(notif);
                });
                
                // Добавляем в очередь
                this.queue.push(notif);
                this.container.appendChild(notif);
                
                // Ограничение видимых
                while (this.queue.length > this.maxVisible) {
                    this.remove(this.queue[0]);
                }
                
                // Автоудаление
                if (duration > 0) {
                    setTimeout(() => this.remove(notif), duration);
                }
                
                return notif;
            } catch (error) {
                debugError('Notifications', 'Ошибка показа уведомления', error);
                return null;
            }
        },

        remove(notif) {
            try {
                if (!notif || !notif.parentNode) return;
                
                const idx = this.queue.indexOf(notif);
                if (idx > -1) this.queue.splice(idx, 1);
                
                notif.classList.add('removing');
                setTimeout(() => notif.remove(), 300);
            } catch (error) {
                debugError('Notifications', 'Ошибка удаления уведомления', error);
            }
        },

        // Быстрые методы
        success(title, message, duration) {
            return this.show({ title, message, type: 'success', duration });
        },
        
        error(title, message, duration) {
            return this.show({ title, message, type: 'error', duration });
        },
        
        info(title, message, duration) {
            return this.show({ title, message, type: 'info', duration });
        },
        
        warning(title, message, duration) {
            return this.show({ title, message, type: 'warning', duration });
        },

        // Очистить все
        clear() {
            this.queue.forEach(n => n.remove());
            this.queue = [];
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // ПЕРЕХВАТЧИК ЗАПРОСОВ (запускается сразу при загрузке)
    // ═══════════════════════════════════════════════════════════════════════════

    let capturedRequests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
    let isRecording = JSON.parse(localStorage.getItem('_interceptorRecording') ?? 'true');

    function saveRequests() {
        // Ограничиваем количество запросов чтобы не переполнить localStorage
        if (capturedRequests.length > MAX_CAPTURED_REQUESTS) {
            capturedRequests = capturedRequests.slice(-MAX_CAPTURED_REQUESTS);
        }
        try {
            localStorage.setItem('_interceptedRequests', JSON.stringify(capturedRequests));
        } catch (e) {
            // localStorage переполнен - очищаем половину
            debugError('Interceptor', 'localStorage переполнен, очищаем старые записи', e);
            capturedRequests = capturedRequests.slice(-Math.floor(MAX_CAPTURED_REQUESTS / 2));
            localStorage.setItem('_interceptedRequests', JSON.stringify(capturedRequests));
        }
    }

    function tryParseJSON(str) {
        if (!str) return null;
        try { return JSON.parse(str); } catch { return str; }
    }

    /**
     * Получение cookies в виде объекта {name: value}
     * @returns {Object.<string, string>} Объект с cookies
     */
    function getCookiesObject() {
        const cookies = {};
        document.cookie.split(';').forEach(cookie => {
            const [name, ...rest] = cookie.trim().split('=');
            if (name) {
                cookies[name] = rest.join('=');
            }
        });
        return cookies;
    }

    /**
     * Получение cookies в виде строки
     * @returns {string} Строка cookies
     */
    function getCookiesString() {
        return document.cookie;
    }

    // Получить данные сессии для использования вне браузера
    function getSessionData() {
        const cookies = getCookiesObject();
        return {
            // Основные данные
            company_id: cookies.sc_company_id || COMPANY_ID,
            timestamp: new Date().toISOString(),
            
            // Все доступные cookies (не HttpOnly)
            cookies: cookies,
            cookies_string: getCookiesString(),
            
            // User-Agent текущего браузера
            user_agent: navigator.userAgent,
            
            // Важные заголовки
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                'x-o3-app-name': 'seller-ui',
                'x-o3-language': 'ru',
                'accept-language': 'ru',
                'x-o3-company-id': cookies.sc_company_id || COMPANY_ID
            },
            
            // Fingerprint (если есть)
            rfuid: cookies.rfuid || null,
            
            // URL для тестирования
            test_url: 'https://seller.ozon.ru/api/v2/company/finance-info',
            test_body: JSON.stringify({ company_id: cookies.sc_company_id || COMPANY_ID }),
            
            // curl команда для теста
            curl_command: generateCurlCommand(cookies),
            
            // Python код для теста
            python_code: generatePythonCode(cookies),
            
            // Примечание
            note: 'ВАЖНО: HttpOnly cookies (аутентификация) недоступны через JavaScript. Для полного экспорта используй DevTools -> Application -> Cookies'
        };
    }

    /**
     * Генерация curl команды для тестирования API
     * @param {Object.<string, string>} cookies - Объект с cookies
     * @returns {string} curl команда
     */
    function generateCurlCommand(cookies) {
        const cookieStr = Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
        const companyId = cookies.sc_company_id || COMPANY_ID || 'NOT_FOUND';
        
        return `# Ozon Seller API Test
# Company ID: ${companyId}
# Сгенерировано: ${new Date().toISOString()}
#
# ВАЖНО: Добавьте HttpOnly cookies из DevTools!
# F12 -> Application -> Cookies -> seller.ozon.ru

curl -X POST 'https://seller.ozon.ru/api/v2/company/finance-info' \\
  -H 'Accept: application/json, text/plain, */*' \\
  -H 'Content-Type: application/json' \\
  -H 'x-o3-app-name: seller-ui' \\
  -H 'x-o3-language: ru' \\
  -H 'x-o3-company-id: ${companyId}' \\
  -H 'Origin: https://seller.ozon.ru' \\
  -H 'Referer: https://seller.ozon.ru/' \\
  -H 'User-Agent: ${navigator.userAgent}' \\
  -H 'Cookie: ${cookieStr}' \\
  -d '{"company_id":"${companyId}"}'`;
    }

    /**
     * Генерация Python кода для тестирования API
     * @param {Object.<string, string>} cookies - Объект с cookies
     * @returns {string} Python код
     */
    function generatePythonCode(cookies) {
        const cookieStr = Object.entries(cookies)
            .map(([k, v]) => `${k}=${v}`)
            .join('; ');
        const companyId = cookies.sc_company_id || COMPANY_ID || 'NOT_FOUND';
        
        return `"""
Ozon Seller API - тестовый скрипт
Сгенерирован: ${new Date().toISOString()}
Company ID: ${companyId}

ВАЖНО: Этот код работает только с ПОЛНЫМИ cookies!
HttpOnly cookies (аутентификация) недоступны через JavaScript.

Как получить ВСЕ cookies:
1. Открой DevTools (F12)
2. Application -> Cookies -> seller.ozon.ru
3. Выдели все cookies (Ctrl+A)
4. Скопируй (Ctrl+C) и замени значение ниже
"""
import requests

# Cookies из браузера (нужно добавить HttpOnly cookies!)
COOKIES = "${cookieStr}"

# Заголовки запроса
HEADERS = {
    'Accept': 'application/json, text/plain, */*',
    'Content-Type': 'application/json',
    'x-o3-app-name': 'seller-ui',
    'x-o3-language': 'ru',
    'x-o3-company-id': '${companyId}',
    'User-Agent': '${navigator.userAgent}',
    'Cookie': COOKIES,
    'Origin': 'https://seller.ozon.ru',
    'Referer': 'https://seller.ozon.ru/'
}

def test_api():
    """Тест API - получение финансовой информации"""
    url = 'https://seller.ozon.ru/api/v2/company/finance-info'
    data = {'company_id': '${companyId}'}
    
    response = requests.post(url, headers=HEADERS, json=data)
    
    print(f"Status: {response.status_code}")
    if response.status_code == 200:
        print("✓ API работает!")
        print(response.json())
    else:
        print(f"✗ Ошибка: {response.text[:500]}")
        if "Antibot" in response.text:
            print("\\n⚠️ Заблокировано антиботом!")
            print("Убедитесь, что добавили ВСЕ cookies включая HttpOnly")

if __name__ == "__main__":
    test_api()`;
    }

    // Показать справку по экспорту cookies
    function showCookieExportHelp() {
        const helpModal = document.createElement('div');
        helpModal.id = 'cookie-help-modal';
        helpModal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.7); z-index: 99999999;
            display: flex; align-items: center; justify-content: center;
        `;
        helpModal.innerHTML = `
            <div style="background:white;border-radius:12px;padding:24px;max-width:600px;max-height:80vh;overflow-y:auto;margin:20px">
                <h2 style="margin:0 0 16px;font-size:18px">🔐 Как получить ВСЕ cookies</h2>
                
                <div style="background:#fff3cd;border-radius:8px;padding:12px;margin-bottom:16px">
                    <strong>⚠️ Почему нужны дополнительные действия?</strong><br>
                    JavaScript не может получить HttpOnly cookies — это защита браузера. 
                    Но эти cookies критичны для авторизации в API Ozon.
                </div>
                
                <h3 style="font-size:14px;margin:16px 0 8px">Способ 1: Через DevTools (Chrome)</h3>
                <ol style="margin:0;padding-left:20px;line-height:1.8">
                    <li>Нажми <code style="background:#f5f5f5;padding:2px 6px;border-radius:3px">F12</code> → открой DevTools</li>
                    <li>Перейди на вкладку <strong>Application</strong> (или Storage)</li>
                    <li>В левой панели выбери <strong>Cookies → https://seller.ozon.ru</strong></li>
                    <li>Выдели все строки (<code>Ctrl+A</code>)</li>
                    <li>Скопируй (<code>Ctrl+C</code>) — получишь таблицу</li>
                    <li>Вставь в текстовый редактор и преобразуй в формат <code>name=value; name2=value2</code></li>
                </ol>
                
                <h3 style="font-size:14px;margin:16px 0 8px">Способ 2: Через Network (проще)</h3>
                <ol style="margin:0;padding-left:20px;line-height:1.8">
                    <li>Нажми <code>F12</code> → вкладка <strong>Network</strong></li>
                    <li>Сделай любое действие на сайте (обнови страницу)</li>
                    <li>Найди любой запрос к <code>/api/</code></li>
                    <li>Кликни на запрос → вкладка <strong>Headers</strong></li>
                    <li>Найди <strong>Request Headers → Cookie</strong></li>
                    <li>Скопируй всё значение — это ПОЛНЫЕ cookies!</li>
                </ol>
                
                <h3 style="font-size:14px;margin:16px 0 8px">Способ 3: Copy as cURL</h3>
                <ol style="margin:0;padding-left:20px;line-height:1.8">
                    <li><code>F12</code> → <strong>Network</strong></li>
                    <li>Правый клик на запрос к <code>/api/</code></li>
                    <li>Выбери <strong>Copy → Copy as cURL (bash)</strong></li>
                    <li>Вставь куда нужно — это готовая команда со ВСЕМИ заголовками!</li>
                </ol>
                
                <div style="background:#d4edda;border-radius:8px;padding:12px;margin-top:16px">
                    <strong>💡 Совет:</strong> Способ 3 самый быстрый — получаешь готовую curl команду 
                    со всеми cookies и headers, которая точно работает!
                </div>
                
                <button id="close-cookie-help" style="
                    width:100%;margin-top:16px;padding:12px;
                    background:#0066cc;color:white;border:none;
                    border-radius:8px;cursor:pointer;font-size:14px;font-weight:600
                ">Понятно, закрыть</button>
            </div>
        `;
        document.body.appendChild(helpModal);
        
        helpModal.addEventListener('click', (e) => {
            if (e.target === helpModal || e.target.id === 'close-cookie-help') {
                helpModal.remove();
            }
        });
    }

    // Преобразование headers в объект
    function headersToObject(headers) {
        if (!headers) return {};
        if (headers instanceof Headers) {
            const obj = {};
            headers.forEach((value, key) => { obj[key] = value; });
            return obj;
        }
        if (typeof headers === 'object') {
            return { ...headers };
        }
        return {};
    }

    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const [url, options = {}] = args;
        if (!isRecording || !url.includes('/api/')) {
            return originalFetch.apply(this, args);
        }

        const request = {
            timestamp: new Date().toISOString(),
            url: url,
            method: options.method || 'GET',
            headers: headersToObject(options.headers),
            cookies: getCookiesObject(),
            body: options.body ? sanitizeSensitive(tryParseJSON(options.body)) : null
        };

        try {
            const response = await originalFetch.apply(this, args);
            const clone = response.clone();

            try {
                request.response = sanitizeSensitive(await clone.json());
            } catch {
                request.response = null;
            }
            request.status = response.status;
            capturedRequests.push(request);
            saveRequests();
            return response;
        } catch (e) {
            request.status = 0;
            request.error = e?.message || 'Fetch error';
            capturedRequests.push(request);
            saveRequests();
            debugError('Interceptor', `fetch error ${url}`, e);
            throw e;
        }
    };

    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalXHRSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._interceptedMethod = method;
        this._interceptedUrl = url;
        this._interceptedHeaders = {};
        return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
        if (this._interceptedHeaders) {
            this._interceptedHeaders[name] = value;
        }
        return originalXHRSetRequestHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        try {
            const xhr = this;
            if (!isRecording || !xhr._interceptedUrl || !xhr._interceptedUrl.includes('/api/')) {
                return originalXHRSend.apply(this, arguments);
            }

            const request = {
                timestamp: new Date().toISOString(),
                type: 'XHR',
                url: xhr._interceptedUrl,
                method: xhr._interceptedMethod,
                headers: xhr._interceptedHeaders || {},
                cookies: getCookiesObject(),
                body: sanitizeSensitive(tryParseJSON(body))
            };

            xhr.addEventListener('load', function() {
                try {
                    request.response = sanitizeSensitive(JSON.parse(xhr.responseText));
                } catch {
                    request.response = null;
                }
                request.status = xhr.status;
                capturedRequests.push(request);
                saveRequests();
            });

            xhr.addEventListener('error', function() {
                request.status = 0;
                request.error = 'Network error';
                capturedRequests.push(request);
                saveRequests();
            });

            return originalXHRSend.apply(this, arguments);
        } catch (e) {
            debugError('Interceptor', 'Ошибка в XHR send', e);
            return originalXHRSend.apply(this, arguments);
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // API ENDPOINTS
    // ═══════════════════════════════════════════════════════════════════════════

    const API = {
        // Товары
        SEARCH_PRODUCTS: 'https://seller.ozon.ru/api/v1/search-variant-model',
        CREATE_PRODUCT: 'https://seller.ozon.ru/api/v1/item/create-by-variant',
        PRODUCTS_LIST: 'https://seller.ozon.ru/api/v1/products/list-by-filter',
        PRICE_BATCH_SET: 'https://seller.ozon.ru/api/seller-price-api/v1/price-batch-set',
        
        // Склад Express (актуальные v3)
        // ВАЖНО: geoproxy.ozon.ru - правильный эндпоинт геокодирования Ozon
        GEO_SUGGEST: 'https://geoproxy.ozon.ru/Suggest',
        GEO_PROVIDERS: 'https://geoproxy.ozon.ru/GeoProvidersV2',
        WAREHOUSE_DRAFT_CREATE: '/api/site/logistic-service/v3/warehouse/draft/create',
        DELIVERY_METHOD_CREATE: '/api/delivery-method-service/delivery-method/create',
        DELIVERY_METHOD_ACTIVATE: '/api/delivery-method-service/delivery-method/activate',
        DELIVERY_AREA_CREATE: '/api/delivery-polygon-service/area/create',
        DELIVERY_AREA_UPDATE: '/api/delivery-polygon-service/area/update',
        DELIVERY_POLYGON_CREATE: '/api/delivery-polygon-service/v2/polygon/create',
        DELIVERY_WAREHOUSE_LINK: '/api/delivery-polygon-service/delivery-method/save/warehouse',
        RETURNS_SETTING: '/api/seller-returns-methods/v1/returns-setting',
        
        // Остатки
        WAREHOUSE_LIST_SHORT: '/api/site/logistic-service/v2/warehouse/list/short',
        STOCK_BATCH_SET: '/api/site/item-stock-service/rfbs/item/stock/batch-set'
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // КОНФИГУРАЦИЯ
    // ═══════════════════════════════════════════════════════════════════════════

    const DEFAULT_CONFIG = {
        products: {
            searchQuery: "губка",
            limit: 10,
            maxPages: 20,
            price: "3100",
            maxToAdd: 9
        },
        warehouse: {
            warehouseAddress: "",
            warehouseName: "",
            warehousePhone: "",
            deliveryTimeMinutes: 15,
            courierSpeedKmh: 30,
            workingDays: [1,2,3,4,5,6,7],
            workingHoursFrom: "08:00",
            workingHoursTo: "22:00",
            speedMode: "human",
            // Ручные координаты (если геокодер не работает)
            manualLat: "",
            manualLng: ""
        },
        priceChanger: {
            minThreshold: 100,     // Минимальная цена для изменения (если больше - меняем)
            newPriceMin: 27,       // Новая цена от
            newPriceMax: 50,       // Новая цена до
            userEmail: ''          // Email пользователя для API
        },
        stock: {
            minStock: 10,          // Минимальный остаток
            maxStock: 50           // Максимальный остаток
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // УТИЛИТЫ
    // ═══════════════════════════════════════════════════════════════════════════

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function log(message) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ${message}`);
    }

    function getCompanyIdFromCookie() {
        const match = document.cookie.match(/sc_company_id=(\d+)/);
        return match ? match[1] : null;
    }

    function getUserEmailFromPage() {
        // 1. Из window объектов (Nuxt, Redux, etc) - данные загружаются туда
        const windowObjects = ['__NUXT__', '__INITIAL_STATE__', '__PRELOADED_STATE__', '__APP_STATE__'];
        for (const objName of windowObjects) {
            try {
                const state = window[objName];
                if (!state) continue;
                // Рекурсивный поиск email в объекте
                const findEmail = (obj, depth = 0) => {
                    try {
                        if (depth > 10 || !obj) return null;
                        if (typeof obj === 'string' && obj.includes('@') && obj.match(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)) {
                            return obj;
                        }
                        if (typeof obj === 'object') {
                            // Прямой доступ к известным полям
                            if (obj.email && typeof obj.email === 'string' && obj.email.includes('@')) return obj.email;
                            if (obj.user?.email) return obj.user.email;
                            if (obj.auth?.email) return obj.auth.email;
                            if (obj.profile?.email) return obj.profile.email;
                            // Рекурсия
                            const keys = Object.keys(obj);
                            for (let i = 0; i < Math.min(keys.length, 50); i++) {
                                const result = findEmail(obj[keys[i]], depth + 1);
                                if (result) return result;
                            }
                        }
                    } catch (e) {
                        // Игнорируем ошибки доступа к свойствам
                    }
                    return null;
                };
                const email = findEmail(state);
                if (email) {
                    log(`✓ Email из ${objName}: ${email}`);
                    return email;
                }
            } catch (e) {
                debugLog('Email', `Ошибка поиска в ${objName}`, e.message);
            }
        }
        
        // 2. Из script тегов с JSON данными (как на странице name-password)
        try {
            const scripts = document.querySelectorAll('script:not([src])');
            for (const script of scripts) {
                const text = script.textContent || '';
                const emailMatch = text.match(/"email"\s*:\s*"([^"]+@[^"]+)"/);
                if (emailMatch && !emailMatch[1].includes('ozon.ru')) {
                    log(`✓ Email из script: ${emailMatch[1]}`);
                    return emailMatch[1];
                }
            }
        } catch (e) {
            debugLog('Email', 'Ошибка поиска в script тегах', e.message);
        }
        
        // 3. Поиск в DOM - меню профиля
        const selectors = [
            '[class*="user"] [class*="email"]',
            '[class*="profile"] [class*="email"]', 
            '[class*="account"] [class*="email"]',
            '[class*="dropdown"] [class*="subtitle"]',
            '[class*="menu"] [class*="subtitle"]'
        ];
        for (const selector of selectors) {
            try {
                const el = document.querySelector(selector);
                if (el) {
                    const text = el.textContent || '';
                    const emailMatch = text.match(/[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
                    if (emailMatch) {
                        log(`✓ Email из DOM: ${emailMatch[0]}`);
                        return emailMatch[0];
                    }
                }
            } catch (e) {
                // Игнорируем ошибки селекторов
            }
        }
        
        // 4. Грубый поиск по всему body
        try {
            const bodyText = document.body?.innerHTML || '';
            const emailMatch = bodyText.match(/"email"\s*:\s*"([a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"/);
            if (emailMatch && !emailMatch[1].includes('ozon.ru')) {
                log(`✓ Email из body: ${emailMatch[1]}`);
                return emailMatch[1];
            }
        } catch (e) {
            debugLog('Email', 'Ошибка поиска в body', e.message);
        }
        
        // 5. Из localStorage
        const localStorageKeys = ['auth', 'user', 'userInfo', 'profile', 'session'];
        for (const key of localStorageKeys) {
            try {
                const data = localStorage.getItem(key);
                if (data) {
                    const emailMatch = data.match(/"email"\s*:\s*"([^"]+@[^"]+)"/);
                    if (emailMatch) {
                        log(`✓ Email из localStorage: ${emailMatch[1]}`);
                        return emailMatch[1];
                    }
                }
            } catch {}
        }
        
        log('⚠️ Email не найден автоматически - укажите вручную');
        return '';
    }

    const COMPANY_ID = getCompanyIdFromCookie();

    function loadConfig() {
        try {
            const saved = localStorage.getItem('_ozonToolboxConfig');
            if (!saved) return DEFAULT_CONFIG;
            const parsed = JSON.parse(saved);
            return {
                products: { ...DEFAULT_CONFIG.products, ...parsed.products },
                warehouse: { ...DEFAULT_CONFIG.warehouse, ...parsed.warehouse },
                priceChanger: { ...DEFAULT_CONFIG.priceChanger, ...parsed.priceChanger }
            };
        } catch {
            return DEFAULT_CONFIG;
        }
    }

    function saveConfig(partial) {
        const current = loadConfig();
        const merged = {
            products: { ...current.products, ...partial.products },
            warehouse: { ...current.warehouse, ...partial.warehouse },
            priceChanger: { ...current.priceChanger, ...partial.priceChanger }
        };
        localStorage.setItem('_ozonToolboxConfig', JSON.stringify(merged));
    }

    function showToast(message, type = 'info') {
        const colors = { info: '#333', success: '#28a745', error: '#dc3545' };
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed; bottom: 20px; right: 20px; background: ${colors[type]};
            color: white; padding: 12px 20px; border-radius: 8px; font-size: 13px;
            z-index: 9999999; animation: toastIn 0.3s ease;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => toast.remove(), 3000);
    }

    async function apiRequest(url, options = {}) {
        // Получаем company_id из cookies или константы
        const companyId = getCookiesObject().sc_company_id || COMPANY_ID;
        
        const response = await fetch(url, {
            ...options,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'x-o3-app-name': 'seller-ui',
                'x-o3-language': 'ru',
                'accept-language': 'ru',
                'x-o3-company-id': companyId,
                'x-o3-page-type': 'warehouse-other',
                ...options.headers
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
        }
        
        // Обработка пустых ответов (204 No Content или пустое тело)
        const text = await response.text();
        if (!text || text.trim() === '') {
            return { success: true };
        }
        
        try {
            return JSON.parse(text);
        } catch (e) {
            // Если не JSON, возвращаем как есть
            return { success: true, raw: text };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // МОДУЛЬ: ПОИСК И ДОБАВЛЕНИЕ ТОВАРОВ
    // ═══════════════════════════════════════════════════════════════════════════

    const ProductsModule = {
        isRunning: false,
        shouldStop: false,
        
        stop() {
            this.shouldStop = true;
            log('Остановка...');
        },
        
        async run(config) {
            if (this.isRunning) {
                showToast('Уже выполняется!', 'error');
                return;
            }
            
            const { searchQuery, limit, maxPages, price, maxToAdd } = config.products;
            if (!searchQuery || searchQuery.trim().length === 0) {
                showToast('Укажите поисковый запрос!', 'error');
                return;
            }
            if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
                showToast('Укажите корректную цену!', 'error');
                return;
            }
            if (!COMPANY_ID) {
                showToast('Company ID не найден!', 'error');
                return;
            }
            
            this.isRunning = true;
            this.shouldStop = false;
            updateButtons();
            
            log(`Поиск: "${searchQuery}"`);
            log(`Company ID: ${COMPANY_ID}`);
            
            NotificationSystem.show({
                title: '🔍 Поиск товаров',
                message: `Запрос: "${searchQuery.substring(0, 30)}..."`,
                type: 'info',
                duration: 4000
            });
            
            try {
                let allItems = [];
                let lastId = null;
                let pageNum = 1;
                
                while (pageNum <= maxPages && !this.shouldStop) {
                    log(`Страница ${pageNum}/${maxPages}...`);
                    
                    const requestBody = { name: searchQuery.trim(), limit: limit.toString() };
                    if (lastId) requestBody.last_id = lastId;
                    
                    const data = await apiRequest(API.SEARCH_PRODUCTS, {
                        method: 'POST',
                        headers: {
                            'x-o3-app-name': 'seller-ui',
                            'x-o3-company-id': COMPANY_ID,
                            'x-o3-language': 'ru'
                        },
                        body: JSON.stringify(requestBody)
                    });
                    
                    allItems = allItems.concat(data.items || []);
                    lastId = data.last_id;
                    
                    if (!lastId) break;
                    pageNum++;
                    await sleep(300);
                }
                
                if (this.shouldStop) {
                    log('Остановлено пользователем');
                    return;
                }
                
                log(`Найдено: ${allItems.length} товаров`);
                
                NotificationSystem.show({
                    title: '📦 Найдено товаров',
                    message: `${allItems.length} шт., доступно для добавления...`,
                    type: 'info',
                    duration: 3000
                });
                
                const availableItems = allItems.filter(item => 
                    !item.attributes?.find(attr => attr.key === "12085" && attr.value === "deny")
                );
                
                log(`Доступно: ${availableItems.length}`);
                
                if (availableItems.length === 0) {
                    log('Нет доступных товаров');
                    return;
                }
                
                const toAdd = Math.min(maxToAdd, availableItems.length);
                const step = availableItems.length / toAdd;
                const selectedItems = [];
                for (let i = 0; i < toAdd; i++) {
                    selectedItems.push(availableItems[Math.floor(i * step)]);
                }
                
                log(`Добавление ${selectedItems.length} товаров...`);
                
                NotificationSystem.show({
                    title: '➕ Добавление',
                    message: `Добавляем ${selectedItems.length} товаров по ${price} руб...`,
                    type: 'info',
                    duration: 4000
                });
                
                let addedCount = 0;
                let errorCount = 0;
                
                for (const item of selectedItems) {
                    if (this.shouldStop) {
                        log('Остановлено пользователем');
                        break;
                    }
                    
                    const randomArticle = Math.floor(10000 + Math.random() * 90000).toString();
                    
                    try {
                        await apiRequest(API.CREATE_PRODUCT, {
                            method: 'POST',
                            headers: {
                                'x-o3-app-name': 'seller-ui',
                                'x-o3-company-id': COMPANY_ID,
                                'x-o3-language': 'ru'
                            },
                            body: JSON.stringify({
                                variant_id: item.variant_id,
                                offer_id: randomArticle,
                                price: price,
                                vat: 0,
                                company_id: COMPANY_ID,
                                currency: "RUB"
                            })
                        });
                        
                        log(`+ ${item.name.substring(0, 35)}... [${randomArticle}]`);
                        addedCount++;
                    } catch (e) {
                        log(`x Ошибка: ${e.message.substring(0, 50)}`);
                        errorCount++;
                    }
                    
                    await sleep(500);
                }
                
                log(`--- ИТОГО: +${addedCount} / ошибок: ${errorCount}`);
                
                // Финальное уведомление
                if (addedCount > 0 && errorCount === 0) {
                    NotificationSystem.show({
                        title: '✅ Готово!',
                        message: `Добавлено ${addedCount} товаров`,
                        type: 'success',
                        duration: 6000
                    });
                } else if (addedCount > 0) {
                    NotificationSystem.show({
                        title: '⚠️ Завершено',
                        message: `Добавлено: ${addedCount}, ошибок: ${errorCount}`,
                        type: 'warning',
                        duration: 6000
                    });
                } else {
                    NotificationSystem.show({
                        title: '❌ Ошибка',
                        message: `Не удалось добавить товары`,
                        type: 'error',
                        duration: 8000
                    });
                }
                
                showToast(`Добавлено ${addedCount} товаров`, addedCount > 0 ? 'success' : 'error');
                
            } catch (error) {
                log(`Ошибка: ${error.message}`);
                NotificationSystem.show({
                    title: '❌ Ошибка',
                    message: error.message.substring(0, 60),
                    type: 'error',
                    duration: 8000
                });
                showToast('Ошибка выполнения', 'error');
            } finally {
                this.isRunning = false;
                this.shouldStop = false;
                updateButtons();
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // МОДУЛЬ: СОЗДАНИЕ СКЛАДА
    // ═══════════════════════════════════════════════════════════════════════════

    /**
     * Коэффициент уменьшения радиуса доставки.
     * Используется для расчёта реалистичной зоны покрытия:
     * - 1.0 = теоретический максимум (прямая линия)
     * - 0.7 = учитывает дороги, повороты, трафик (~70% от прямой)
     * Формула: radius = скорость * время * RADIUS_COEFFICIENT
     */
    const RADIUS_COEFFICIENT = 0.7;

    const WarehouseModule = {
        isRunning: false,
        shouldStop: false,
        state: {},
        
        stop() {
            this.shouldStop = true;
            log('🛑 Остановка...');
        },
        
        // Генерация телефона
        generatePhone() {
            const code = Math.floor(Math.random() * 900) + 100;
            const num1 = Math.floor(Math.random() * 900) + 100;
            const num2 = Math.floor(Math.random() * 90) + 10;
            const num3 = Math.floor(Math.random() * 90) + 10;
            return `+7 ${code} ${num1} ${num2} ${num3}`;
        },
        
        // Генерация полигона (круг)
        generateCirclePolygon(centerLat, centerLng, radiusKm, points = 24) {
            const coordinates = [];
            const earthRadius = 6371;
            
            for (let i = 0; i < points; i++) {
                const angle = (2 * Math.PI * i) / points;
                const dLat = (radiusKm / earthRadius) * Math.cos(angle) * (180 / Math.PI);
                const dLng = (radiusKm / earthRadius) * Math.sin(angle) * (180 / Math.PI) / Math.cos(centerLat * Math.PI / 180);
                coordinates.push([centerLat + dLat, centerLng + dLng]);
            }
            coordinates.push(coordinates[0]); // Замыкаем
            return coordinates;
        },
        
        async run(config) {
            if (this.isRunning) {
                showToast('Уже выполняется!', 'error');
                return;
            }
            
            const { warehouseAddress, warehouseName, deliveryTimeMinutes, courierSpeedKmh, 
                    speedMode, workingHoursFrom, workingHoursTo, workingDays } = config.warehouse;
            const companyId = parseInt(COMPANY_ID);
            
            // Валидация
            if (!warehouseAddress || warehouseAddress.trim().length < 10) {
                showToast('Укажите полный адрес склада!', 'error');
                return;
            }
            if (!companyId) {
                showToast('Company ID не найден!', 'error');
                return;
            }
            if (deliveryTimeMinutes < 5 || deliveryTimeMinutes > 180) {
                showToast('Время доставки: 5-180 минут', 'error');
                return;
            }
            
            this.isRunning = true;
            this.shouldStop = false;
            this.state = {};
            updateButtons();
            
            const logWh = (msg) => log(`🏭 ${msg}`);
            const delay = (ms) => speedMode === 'fast' ? sleep(500) : sleep(ms + Math.random() * ms * 0.3);
            
            // Уведомление с прогрессом
            const notify = (step, total, title, message, type = 'info') => {
                NotificationSystem.show({
                    title: `🏭 Склад [${step}/${total}]: ${title}`,
                    message: message,
                    type: type,
                    duration: type === 'error' ? 8000 : 4000
                });
            };
            
            logWh('=== СОЗДАНИЕ СКЛАДА EXPRESS (API v3) ===');
            logWh(`Company ID: ${companyId}`);
            logWh(`Адрес: ${warehouseAddress.substring(0, 60)}...`);
            logWh(`Время доставки: ${deliveryTimeMinutes} мин`);
            
            notify(0, 8, 'Запуск', `Адрес: ${warehouseAddress.substring(0, 40)}...`, 'info');
            
            try {
                // ШАГ 1: Геокодирование
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 1/8: Геокодирование адреса...');
                notify(1, 8, 'Геокодирование', 'Определяем координаты адреса...');
                
                const encodedAddress = encodeURIComponent(warehouseAddress.trim());
                let geoData;
                
                // Генерация requestSessionId для API Ozon
                const generateUUID = () => {
                    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
                        const r = Math.random() * 16 | 0;
                        const v = c === 'x' ? r : (r & 0x3 | 0x8);
                        return v.toString(16);
                    });
                };
                
                // Метод 1: Ozon GeoProxy API (правильный эндпоинт!)
                try {
                    const requestSessionId = generateUUID();
                    const geoUrl = `${API.GEO_SUGGEST}?clientName=seller-ui-warehouse&query=${encodedAddress}&count=50&lang=ru&contextLocationUID=&removeDisallowedCountries=true&requestSessionId=${requestSessionId}`;
                    
                    logWh('Пробуем Ozon GeoProxy API...');
                    logWh(`URL: ${geoUrl.substring(0, 100)}...`);
                    
                    const response = await fetch(geoUrl, {
                        method: 'GET',
                        credentials: 'include',
                        headers: {
                            'Accept': 'application/json',
                            'Accept-Language': 'ru-RU,ru;q=0.9'
                        }
                    });
                    
                    logWh(`GeoProxy ответ: HTTP ${response.status}`);
                    
                    if (response.ok) {
                        geoData = await response.json();
                        logWh(`GeoProxy данные: ${JSON.stringify(geoData).substring(0, 200)}...`);
                        
                        // Формат 1: { results: [{ center: { lat, lon } }] }
                        if (geoData.results?.length > 0) {
                            const firstResult = geoData.results[0];
                            if (firstResult.center) {
                                this.state.lat = firstResult.center.lat;
                                this.state.lng = firstResult.center.lon;
                                this.state.parsedAddress = {
                                    country: firstResult.address?.country || 'Россия',
                                    city: firstResult.address?.locality || firstResult.address?.region || '',
                                    zipcode: firstResult.address?.postalCode || ''
                                };
                                this.state.locationUid = firstResult.uid || generateUUID();
                                logWh('✓ Координаты получены через Ozon GeoProxy (формат results)');
                            }
                        }
                        
                        // Формат 2: { suggestions: [{ address: { geometry: { point: { lat, lon } } } }] } (актуальный формат!)
                        if (!this.state.lat && geoData.suggestions?.length > 0) {
                            const s = geoData.suggestions[0];
                            const point = s.address?.geometry?.point;
                            if (point?.lat && point?.lon) {
                                this.state.lat = point.lat;
                                this.state.lng = point.lon;
                                this.state.parsedAddress = {
                                    country: 'Россия',
                                    city: s.address?.locality || s.address?.region || '',
                                    zipcode: s.address?.postalCode || ''
                                };
                                this.state.locationUid = s.uid || generateUUID();
                                logWh('✓ Координаты получены через Ozon GeoProxy (формат suggestions)');
                            } else if (s.geo) {
                                // Старый формат с geo
                                this.state.lat = s.geo.lat;
                                this.state.lng = s.geo.lon || s.geo.lng;
                                this.state.parsedAddress = {
                                    country: s.data?.country || 'Россия',
                                    city: s.data?.city || s.data?.settlement || '',
                                    zipcode: s.data?.postal_code || ''
                                };
                                logWh('✓ Координаты получены через Ozon GeoProxy (формат geo)');
                            }
                        }
                        
                        // Формат 3: Массив напрямую [{ lat, lon/lng }]
                        if (!this.state.lat && Array.isArray(geoData) && geoData.length > 0) {
                            const first = geoData[0];
                            if (first.lat && (first.lon || first.lng)) {
                                this.state.lat = first.lat;
                                this.state.lng = first.lon || first.lng;
                                this.state.parsedAddress = { country: 'Россия', city: '', zipcode: '' };
                                logWh('✓ Координаты получены через Ozon GeoProxy (формат массив)');
                            }
                        }
                    } else {
                        const errorText = await response.text();
                        logWh(`Ozon GeoProxy ошибка: ${errorText.substring(0, 100)}`);
                    }
                } catch (e) {
                    logWh('Ozon GeoProxy API недоступен: ' + e.message);
                }
                
                // Метод 2: Яндекс Геокодер с API-ключом Ozon (разрешён в CSP)
                if (!this.state.lat) {
                    try {
                        // API-ключ Яндекса из настроек Ozon (из перехвата GeoProvidersV2)
                        const YANDEX_API_KEY = '0b4d55b7-0acf-464c-b8fa-debc5eadb540';
                        const yandexUrl = `https://geocode-maps.yandex.ru/1.x/?apikey=${YANDEX_API_KEY}&format=json&geocode=${encodedAddress}&results=1&lang=ru_RU`;
                        
                        logWh('Пробуем Яндекс Геокодер...');
                        const yandexResponse = await fetch(yandexUrl);
                        
                        if (!yandexResponse.ok) {
                            logWh(`Яндекс HTTP ${yandexResponse.status}`);
                            throw new Error(`HTTP ${yandexResponse.status}`);
                        }
                        
                        const yandexData = await yandexResponse.json();
                        
                        const geoObject = yandexData?.response?.GeoObjectCollection?.featureMember?.[0]?.GeoObject;
                        if (geoObject) {
                            const pos = geoObject.Point?.pos?.split(' ');
                            if (pos?.length === 2) {
                                this.state.lng = parseFloat(pos[0]);
                                this.state.lat = parseFloat(pos[1]);
                                
                                // Парсим адресные компоненты
                                const components = geoObject.metaDataProperty?.GeocoderMetaData?.Address?.Components || [];
                                this.state.parsedAddress = {
                                    country: components.find(c => c.kind === 'country')?.name || 'Россия',
                                    city: components.find(c => c.kind === 'locality')?.name || 
                                          components.find(c => c.kind === 'area')?.name || '',
                                    zipcode: ''
                                };
                                logWh('✓ Координаты получены через Яндекс Геокодер');
                            }
                        }
                    } catch (e) {
                        logWh('Яндекс Геокодер недоступен: ' + e.message);
                    }
                }
                
                // Метод 3: Ручной ввод координат (если есть в config)
                if (!this.state.lat && config.warehouse.manualLat && config.warehouse.manualLng) {
                    this.state.lat = parseFloat(config.warehouse.manualLat);
                    this.state.lng = parseFloat(config.warehouse.manualLng);
                    this.state.parsedAddress = { country: 'Россия', city: '', zipcode: '' };
                    logWh('✓ Используются ручные координаты');
                }
                
                if (!this.state.lat || !this.state.lng) {
                    throw new Error('Не удалось определить координаты. Проверьте адрес или укажите координаты вручную.');
                }
                
                logWh(`✓ Координаты: ${this.state.lat.toFixed(5)}, ${this.state.lng.toFixed(5)}`);
                notify(1, 8, 'Координаты ✓', `${this.state.lat.toFixed(4)}, ${this.state.lng.toFixed(4)}`, 'success');
                await delay(2000);
                
                // ШАГ 2: Создание черновика склада
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 2/8: Создание черновика склада...');
                notify(2, 8, 'Черновик', 'Создаём склад...');
                
                const autoName = warehouseName?.trim() || 
                    `Склад ${this.state.parsedAddress.city || 'Express'}`;
                const autoPhone = config.warehouse.warehousePhone?.trim() || this.generatePhone();
                
                // Формируем расписание
                const workingHours = {};
                for (const day of workingDays) {
                    workingHours[day.toString()] = { from: workingHoursFrom, to: workingHoursTo };
                }
                
                const draftBody = {
                    company_id: companyId,
                    name: autoName,
                    phone: autoPhone,
                    warehouse_type: 'rfbs_express',
                    address: {
                        address: warehouseAddress.trim(),
                        longitude: this.state.lng,
                        latitude: this.state.lat,
                        is_new_address_scheme: true,
                        is_house_missing: false,
                        country: this.state.parsedAddress.country || 'Россия'
                    },
                    timetable_template: {
                        holidays_override: [],
                        working_hours: workingHours
                    },
                    postings_limit: -1,
                    goods_by_request: false,
                    is_auto_assembly: false
                };
                
                const draftData = await apiRequest(API.WAREHOUSE_DRAFT_CREATE, {
                    method: 'POST',
                    body: JSON.stringify(draftBody)
                });
                
                this.state.warehouseDraftId = draftData.result;
                if (!this.state.warehouseDraftId) {
                    throw new Error(`Ошибка создания черновика: ${JSON.stringify(draftData)}`);
                }
                logWh(`✓ Черновик: ${this.state.warehouseDraftId}`);
                notify(2, 8, 'Черновик ✓', `ID: ${this.state.warehouseDraftId}`, 'success');
                await delay(3000);
                
                // ШАГ 3: Создание метода доставки
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 3/8: Создание метода доставки...');
                notify(3, 8, 'Метод доставки', 'Создаём Express метод...');
                
                const methodName = `Экспресс. Самостоятельно. ${autoName}`;
                
                const methodBody = {
                    company_id: companyId,
                    delivery_type_id: 1,  // self-delivery
                    cutoff: '17:00',
                    name: methodName,
                    tariff_type: 'STANDARD_OZON',
                    prr_setting: '',
                    tpl_integration_type: 'non_integrated',
                    with_item_list: false,
                    make_method_group_id: false,
                    is_express: true,
                    sla_cut_in: 30,
                    courier_cutoff: deliveryTimeMinutes,
                    working_days: workingDays,
                    warehouse_draft_id: parseInt(this.state.warehouseDraftId)
                };
                
                const methodData = await apiRequest(API.DELIVERY_METHOD_CREATE, {
                    method: 'POST',
                    body: JSON.stringify(methodBody)
                });
                
                this.state.methodId = String(methodData.result?.id);
                if (!this.state.methodId || this.state.methodId === 'undefined') {
                    throw new Error(`Ошибка создания метода: ${JSON.stringify(methodData)}`);
                }
                logWh(`✓ Метод доставки: ${this.state.methodId}`);
                notify(3, 8, 'Метод ✓', `ID: ${this.state.methodId}`, 'success');
                await delay(3000);
                
                // ШАГ 4: Создание зоны доставки
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 4/8: Создание зоны доставки...');
                notify(4, 8, 'Зона доставки', 'Создаём область...');
                
                const areaData = await apiRequest(API.DELIVERY_AREA_CREATE, {
                    method: 'POST',
                    body: JSON.stringify({
                        area: {
                            delivery_method_id: String(this.state.methodId),
                            delivery_time: String(deliveryTimeMinutes),
                            name: `Область доставки ${deliveryTimeMinutes} мин`
                        }
                    })
                });
                
                this.state.areaId = areaData.id;
                logWh(`✓ Зона: ${this.state.areaId}`);
                notify(4, 8, 'Зона ✓', `ID: ${this.state.areaId}`, 'success');
                await delay(2000);
                
                // ШАГ 5: Создание полигона
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 5/8: Создание полигона...');
                notify(5, 8, 'Полигон', 'Создаём область покрытия...');
                
                // Расчёт радиуса: скорость * время * коэффициент реалистичности
                const radiusKm = Math.round((courierSpeedKmh * deliveryTimeMinutes / 60) * RADIUS_COEFFICIENT * 10) / 10;
                this.state.radiusKm = radiusKm;
                
                const polygonCoords = this.generateCirclePolygon(this.state.lat, this.state.lng, radiusKm, 24);
                
                const polygonData = await apiRequest(API.DELIVERY_POLYGON_CREATE, {
                    method: 'POST',
                    body: JSON.stringify({
                        coordinates: JSON.stringify([polygonCoords])
                    })
                });
                
                this.state.polygonId = polygonData.polygonId;
                logWh(`✓ Полигон: ${this.state.polygonId} (радиус ${radiusKm} км)`);
                notify(5, 8, 'Полигон ✓', `Радиус: ${radiusKm} км`, 'success');
                await delay(1500);
                
                // ШАГ 6: Привязка полигона к зоне
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 6/8: Привязка полигона к зоне...');
                notify(6, 8, 'Привязка', 'Связываем полигон с зоной...');
                
                await apiRequest(API.DELIVERY_AREA_UPDATE, {
                    method: 'POST',
                    body: JSON.stringify({
                        area: {
                            id: this.state.areaId,
                            name: `Доставка ${deliveryTimeMinutes} мин`,
                            delivery_time: String(deliveryTimeMinutes),
                            multi_polygon_ids: [this.state.polygonId]
                        }
                    })
                });
                logWh('✓ Полигон привязан');
                notify(6, 8, 'Привязка ✓', 'Полигон связан', 'success');
                await delay(2000);
                
                // ШАГ 7: Привязка склада и настройка возвратов
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 7/8: Привязка склада и настройка возвратов...');
                notify(7, 8, 'Настройки', 'Привязываем склад, настраиваем возвраты...');
                
                await apiRequest(API.DELIVERY_WAREHOUSE_LINK, {
                    method: 'POST',
                    body: JSON.stringify({
                        delivery_method_id: parseInt(this.state.methodId),
                        warehouse_id: this.state.warehouseDraftId,
                        warehouse_location: {
                            lat: this.state.lat,
                            long: this.state.lng
                        }
                    })
                });
                
                await apiRequest(API.RETURNS_SETTING, {
                    method: 'POST',
                    body: JSON.stringify({
                        delivery_method_id: parseInt(this.state.methodId),
                        courier_instruction: {
                            comment: '',
                            contact_days: 1,
                            used_warehouse_phone: true
                        }
                    })
                });
                logWh('✓ Склад привязан, возвраты настроены');
                notify(7, 8, 'Настройки ✓', 'Склад привязан', 'success');
                await delay(2000);
                
                // ШАГ 8: Активация
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 8/8: Активация метода доставки...');
                notify(8, 8, 'Активация', 'Запускаем склад...');
                
                const activateData = await apiRequest(API.DELIVERY_METHOD_ACTIVATE, {
                    method: 'POST',
                    body: JSON.stringify({
                        company_id: companyId,
                        delivery_method_id: parseInt(this.state.methodId)
                    })
                });
                
                this.state.warehouseId = activateData.warehouse_id;
                
                logWh('════════════════════════════════════');
                logWh('🎉 СКЛАД УСПЕШНО СОЗДАН!');
                logWh(`Warehouse ID: ${this.state.warehouseId}`);
                logWh(`Draft ID: ${this.state.warehouseDraftId}`);
                logWh(`Method ID: ${this.state.methodId}`);
                logWh(`Area ID: ${this.state.areaId}`);
                logWh(`Polygon ID: ${this.state.polygonId}`);
                logWh(`Радиус: ${radiusKm} км`);
                logWh('════════════════════════════════════');
                
                notify(8, 8, 'ГОТОВО! 🎉', `Склад ID: ${this.state.warehouseId}`, 'success');
                showToast('🎉 Склад создан!', 'success');
                
            } catch (error) {
                logWh(`❌ Ошибка: ${error.message}`);
                logWh(`Состояние: ${JSON.stringify(this.state)}`);
                notify(0, 8, 'ОШИБКА ❌', error.message.substring(0, 60), 'error');
                showToast(`Ошибка: ${error.message.substring(0, 40)}`, 'error');
            } finally {
                this.isRunning = false;
                this.shouldStop = false;
                updateButtons();
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // МОДУЛЬ: ИЗМЕНЕНИЕ ЦЕН
    // ═══════════════════════════════════════════════════════════════════════════

    const PriceChangerModule = {
        isRunning: false,
        shouldStop: false,
        
        stop() {
            this.shouldStop = true;
            log('Остановка...');
        },
        
        async run(config) {
            if (this.isRunning) {
                showToast('Уже выполняется!', 'error');
                return;
            }
            
            const { minThreshold, newPriceMin, newPriceMax, userEmail } = config.priceChanger;
            
            if (!COMPANY_ID) {
                showToast('Company ID не найден!', 'error');
                return;
            }
            
            if (newPriceMin > newPriceMax) {
                showToast('Мин. цена больше макс.!', 'error');
                return;
            }
            
            // Определяем email: из конфига или автопоиск
            const email = userEmail || getUserEmailFromPage();
            
            this.isRunning = true;
            this.shouldStop = false;
            updateButtons();
            
            log('=== ИЗМЕНЕНИЕ ЦЕН ===');
            log(`Порог: > ${minThreshold} руб`);
            log(`Новая цена: ${newPriceMin}-${newPriceMax} руб`);
            log(`Email: ${email || '(не указан)'}`);
            
            try {
                // Получаем все товары
                log('Загрузка товаров...');
                let allProducts = [];
                let cursor = '';
                let page = 1;
                
                while (!this.shouldStop) {
                    log(`Страница ${page}...`);
                    
                    const data = await apiRequest(API.PRODUCTS_LIST, {
                        method: 'POST',
                        body: JSON.stringify({
                            aggregate: {
                                parts: ['PART_ITEM', 'PART_PRICE', 'PART_STATUS'],
                                human_texts: true
                            },
                            filters: {
                                price_color_indexes: [],
                                search: '',
                                categories: []
                            },
                            visibility: 'ALL',
                            sort_by: 'SORT_BY_CREATED_AT',
                            sort_dir: 'SORT_DIRECTION_DESC',
                            company_id: COMPANY_ID,
                            limit: 100,
                            cursor: cursor,
                            return_total_items: true
                        })
                    });
                    
                    if (data.products && data.products.length > 0) {
                        allProducts = allProducts.concat(data.products);
                    }
                    
                    if (!data.cursor || data.cursor === '') break;
                    cursor = data.cursor;
                    page++;
                    await sleep(300);
                }
                
                if (this.shouldStop) {
                    log('Остановлено пользователем');
                    return;
                }
                
                log(`Всего товаров: ${allProducts.length}`);
                
                // Фильтруем товары с ценой > порога
                const toChange = allProducts.filter(p => {
                    const price = parseFloat(p.part_price?.price?.units || 0);
                    return price > minThreshold;
                });
                
                log(`Товаров с ценой > ${minThreshold}: ${toChange.length}`);
                
                if (toChange.length === 0) {
                    log('Нет товаров для изменения');
                    showToast('Нет товаров для изменения', 'info');
                    return;
                }
                
                // Меняем цены
                let changedCount = 0;
                let errorCount = 0;
                
                NotificationSystem.info('Изменение цен', `Начинаем обработку ${toChange.length} товаров...`, 4000);
                
                for (const product of toChange) {
                    if (this.shouldStop) {
                        log('Остановлено пользователем');
                        NotificationSystem.warning('Остановлено', 'Процесс прерван пользователем');
                        break;
                    }
                    
                    const itemId = product.item_id;
                    const oldPrice = parseFloat(product.part_price?.price?.units || 0);
                    const newPrice = Math.floor(Math.random() * (newPriceMax - newPriceMin + 1)) + newPriceMin;
                    const productName = product.part_item?.name || 'Без названия';
                    const shortName = productName.substring(0, 35) + (productName.length > 35 ? '...' : '');
                    
                    try {
                        await apiRequest(API.PRICE_BATCH_SET, {
                            method: 'POST',
                            body: JSON.stringify({
                                prices: [{
                                    item_id: itemId.toString(),
                                    min_auto_price: '0',
                                    old_price: '0',
                                    price: newPrice.toString(),
                                    net_price: '0',
                                    vat: '0',
                                    metadata: {
                                        manage_elastic_boosting_through_price: true
                                    }
                                }],
                                currency: 'RUB',
                                company_id: COMPANY_ID,
                                user_name: email,
                                source: 'api_price_set_v2'
                            })
                        });
                        
                        log(`✓ ${productName.substring(0, 30)}... ${oldPrice} → ${newPrice} руб`);
                        NotificationSystem.success(
                            `${oldPrice} → ${newPrice} ₽`,
                            shortName,
                            6000
                        );
                        changedCount++;
                    } catch (e) {
                        log(`✗ ${productName.substring(0, 30)}... Ошибка: ${e.message.substring(0, 100)}`);
                        NotificationSystem.error(
                            'Ошибка',
                            `${shortName}: ${e.message.substring(0, 50)}`,
                            8000
                        );
                        errorCount++;
                    }
                    
                    // Человеческая задержка: 5-10 сек (зашёл, изменил, сохранил)
                    await sleep(5000 + Math.random() * 5000);
                }
                
                log('================================');
                log(`ИТОГО: изменено ${changedCount}, ошибок ${errorCount}`);
                log('================================');
                
                // Финальное уведомление
                if (changedCount > 0 && errorCount === 0) {
                    NotificationSystem.success('Готово!', `Изменено ${changedCount} цен`, 10000);
                } else if (changedCount > 0 && errorCount > 0) {
                    NotificationSystem.warning('Завершено', `Изменено: ${changedCount}, ошибок: ${errorCount}`, 10000);
                } else {
                    NotificationSystem.error('Ошибка', `Не удалось изменить цены. Ошибок: ${errorCount}`, 10000);
                }
                
                showToast(`Изменено ${changedCount} цен`, changedCount > 0 ? 'success' : 'error');
                
            } catch (error) {
                log(`Ошибка: ${error.message}`);
                showToast('Ошибка выполнения', 'error');
            } finally {
                this.isRunning = false;
                this.shouldStop = false;
                updateButtons();
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // МОДУЛЬ: СОЗДАНИЕ РЕКЛАМНОЙ КАМПАНИИ
    // ═══════════════════════════════════════════════════════════════════════════

    const PromotionModule = {
        isRunning: false,
        
        // Делегирует к общей утилите formatTodayDate()
        getTodayDate: formatTodayDate,
        
        async run(campaignName) {
            if (this.isRunning) {
                showToast('Уже выполняется!', 'error');
                return;
            }
            
            if (!COMPANY_ID) {
                showToast('Company ID не найден!', 'error');
                return;
            }
            
            if (!campaignName || !campaignName.trim()) {
                showToast('Введите название кампании!', 'error');
                return;
            }
            
            this.isRunning = true;
            
            log('=== СОЗДАНИЕ РЕКЛАМНОЙ КАМПАНИИ ===');
            log(`Название: ${campaignName}`);
            log(`Дата: ${this.getTodayDate()}`);
            
            try {
                const requestBody = {
                    scCompanyId: COMPANY_ID,
                    companyType: 'COMPANY_TYPE_SELLER',
                    name: campaignName.trim(),
                    isAutogenerated: false,
                    withDetailedReview: false,
                    withRatingReview: false,
                    promotionId: '',
                    activeFrom: this.getTodayDate()
                };
                
                log('Отправляем запрос...', requestBody);
                
                const response = await apiRequest('/api/sc/v4/create-promotion', {
                    method: 'POST',
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'Content-Type': 'application/json',
                        'x-o3-app-name': 'seller-ui',
                        'x-o3-language': 'ru',
                        'accept-language': 'ru',
                        'x-o3-company-id': COMPANY_ID,
                        'x-o3-page-type': 'ReviewsPromotions'
                    },
                    body: JSON.stringify(requestBody)
                });
                
                log('Ответ:', response);
                
                if (response.promotionId || response.promotionUuid) {
                    const promoId = response.promotionId || 'N/A';
                    const promoUuid = response.promotionUuid || 'N/A';
                    
                    log(`✓ Кампания создана! ID: ${promoId}, UUID: ${promoUuid}`);
                    NotificationSystem.success(
                        'Кампания создана!',
                        `${campaignName} (ID: ${promoId})`,
                        10000
                    );
                    showToast(`Кампания создана! ID: ${promoId}`, 'success');
                    
                    // Очистить поле ввода
                    const input = document.querySelector('#cfg-campaignName');
                    if (input) input.value = '';
                    
                    // Показать результат
                    const resultEl = document.querySelector('#promotion-result');
                    if (resultEl) {
                        resultEl.innerHTML = `
                            <div style="background:#dcfce7;padding:8px;border-radius:6px;margin-top:10px;font-size:11px;color:#16a34a">
                                ✓ Создана: <b>${escapeHtml(campaignName)}</b><br>
                                ID: ${promoId}<br>
                                UUID: ${promoUuid}
                            </div>
                        `;
                    }
                } else {
                    throw new Error('Неожиданный ответ от API');
                }
                
            } catch (error) {
                log(`Ошибка: ${error.message}`);
                NotificationSystem.error('Ошибка', error.message, 10000);
                showToast('Ошибка создания кампании', 'error');
            } finally {
                this.isRunning = false;
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // МОДУЛЬ: ПОЛУЧЕНИЕ SKU
    // ═══════════════════════════════════════════════════════════════════════════

    const SKUModule = {
        isRunning: false,
        skuList: [],
        
        async run() {
            if (this.isRunning) {
                showToast('Уже выполняется!', 'error');
                return;
            }
            
            if (!COMPANY_ID) {
                showToast('Company ID не найден!', 'error');
                return;
            }
            
            this.isRunning = true;
            this.skuList = [];
            updateButtons();
            
            log('=== ЗАГРУЗКА SKU ===');
            
            try {
                let cursor = '';
                let page = 1;
                
                while (true) {
                    log(`Страница ${page}...`);
                    
                    const data = await apiRequest(API.PRODUCTS_LIST, {
                        method: 'POST',
                        body: JSON.stringify({
                            aggregate: {
                                parts: ['PART_ITEM'],
                                human_texts: true
                            },
                            filters: {
                                price_color_indexes: [],
                                search: '',
                                categories: []
                            },
                            visibility: 'ALL',
                            sort_by: 'SORT_BY_CREATED_AT',
                            sort_dir: 'SORT_DIRECTION_DESC',
                            company_id: COMPANY_ID,
                            limit: 100,
                            cursor: cursor,
                            return_total_items: true
                        })
                    });
                    
                    if (data.products && data.products.length > 0) {
                        for (const product of data.products) {
                            // SKU может быть в разных местах
                            const sku = product.sku || product.part_item?.sku || product.item_id;
                            if (sku) {
                                this.skuList.push(String(sku));
                            }
                        }
                    }
                    
                    if (!data.cursor || data.cursor === '') break;
                    cursor = data.cursor;
                    page++;
                    await sleep(300);
                }
                
                log(`Всего SKU: ${this.skuList.length}`);
                
                // Обновляем textarea в виджете
                const textarea = document.querySelector('#sku-list');
                if (textarea) {
                    textarea.value = this.skuList.join('\n');
                }
                
                const countEl = document.querySelector('#sku-count');
                if (countEl) {
                    countEl.textContent = this.skuList.length;
                }
                
                NotificationSystem.success('Готово!', `Загружено ${this.skuList.length} SKU`);
                showToast(`Загружено ${this.skuList.length} SKU`, 'success');
                
            } catch (error) {
                log(`Ошибка: ${error.message}`);
                NotificationSystem.error('Ошибка', error.message);
                showToast('Ошибка загрузки', 'error');
            } finally {
                this.isRunning = false;
                updateButtons();
            }
        },
        
        copyToClipboard() {
            const textarea = document.querySelector('#sku-list');
            if (!textarea || !textarea.value.trim()) {
                showToast('Список пуст!', 'error');
                return;
            }
            
            navigator.clipboard.writeText(textarea.value);
            NotificationSystem.success('Скопировано!', `${this.skuList.length} SKU в буфере`);
            showToast(`${this.skuList.length} SKU скопировано`, 'success');
        },
        
        clear() {
            this.skuList = [];
            const textarea = document.querySelector('#sku-list');
            if (textarea) textarea.value = '';
            const countEl = document.querySelector('#sku-count');
            if (countEl) countEl.textContent = '0';
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // МОДУЛЬ: УСТАНОВКА ОСТАТКОВ
    // ═══════════════════════════════════════════════════════════════════════════

    const StockModule = {
        isRunning: false,
        shouldStop: false,
        
        stop() {
            this.shouldStop = true;
            log('📦 Остановка...');
        },
        
        async run(config) {
            if (this.isRunning) {
                showToast('Уже выполняется!', 'error');
                return;
            }
            
            const { minStock, maxStock } = config.stock;
            
            if (minStock >= maxStock) {
                showToast('Мин. должен быть меньше макс.!', 'error');
                return;
            }
            
            this.isRunning = true;
            this.shouldStop = false;
            updateButtons();
            
            const logStock = (msg) => log(`📦 ${msg}`);
            const notify = (step, total, title, message, type = 'info') => {
                NotificationSystem.showWithProgress(title, message, (step / total) * 100, type);
            };
            
            logStock('=== УСТАНОВКА ОСТАТКОВ ===' );
            logStock(`Диапазон: ${minStock} - ${maxStock}`);
            notify(0, 3, 'Остатки', 'Начинаем...');
            
            try {
                // ШАГ 1: Получить склады RFBS
                logStock('Шаг 1/3: Получение складов...');
                notify(1, 3, 'Склады', 'Загружаем список складов...');
                
                const warehouseData = await apiRequest(API.WAREHOUSE_LIST_SHORT, {
                    method: 'POST',
                    body: JSON.stringify({
                        company_id: parseInt(COMPANY_ID),
                        status_not_in: ['disabled']
                    })
                });
                
                const rfbsWarehouses = (warehouseData.result || []).filter(w => w.is_rfbs);
                if (rfbsWarehouses.length === 0) {
                    throw new Error('Нет RFBS складов! Сначала создайте склад.');
                }
                
                const warehouse = rfbsWarehouses[0];
                logStock(`✓ Склад: ${warehouse.name} (ID: ${warehouse.warehouse_id})`);
                notify(1, 3, 'Склады ✓', `${warehouse.name}`, 'success');
                await sleep(1000);
                
                // ШАГ 2: Получить товары
                if (this.shouldStop) throw new Error('Остановлено');
                logStock('Шаг 2/3: Получение товаров...');
                notify(2, 3, 'Товары', 'Загружаем список товаров...');
                
                const products = [];
                let cursor = '';
                let page = 1;
                
                while (true) {
                    if (this.shouldStop) throw new Error('Остановлено');
                    
                    const data = await apiRequest(API.PRODUCTS_LIST, {
                        method: 'POST',
                        body: JSON.stringify({
                            aggregate: { parts: ['PART_ITEM'], human_texts: true },
                            filters: { price_color_indexes: [], search: '', categories: [] },
                            visibility: 'ALL',
                            sort_by: 'SORT_BY_CREATED_AT',
                            sort_dir: 'SORT_DIRECTION_DESC',
                            company_id: COMPANY_ID,
                            limit: 100,
                            cursor: cursor,
                            return_total_items: true
                        })
                    });
                    
                    if (data.products && data.products.length > 0) {
                        for (const p of data.products) {
                            const offerId = p.part_item?.offer_id || p.offer_id;
                            if (offerId) {
                                products.push({
                                    offer_id: offerId,
                                    name: p.part_item?.name || 'Товар'
                                });
                            }
                        }
                    }
                    
                    if (!data.cursor || data.cursor === '') break;
                    cursor = data.cursor;
                    page++;
                    await sleep(300);
                }
                
                if (products.length === 0) {
                    throw new Error('Нет товаров!');
                }
                
                logStock(`✓ Товаров: ${products.length}`);
                notify(2, 3, 'Товары ✓', `${products.length} товаров`, 'success');
                await sleep(1000);
                
                // ШАГ 3: Установить остатки
                if (this.shouldStop) throw new Error('Остановлено');
                logStock('Шаг 3/3: Установка остатков...');
                notify(3, 3, 'Остатки', 'Устанавливаем...');
                
                let updated = 0;
                let errors = 0;
                
                // Батчами по 50 товаров
                const batchSize = 50;
                for (let i = 0; i < products.length; i += batchSize) {
                    if (this.shouldStop) throw new Error('Остановлено');
                    
                    const batch = products.slice(i, i + batchSize);
                    const stocks = batch.map(p => ({
                        offer_id: p.offer_id,
                        stock: Math.floor(Math.random() * (maxStock - minStock + 1)) + minStock,
                        warehouse_id: warehouse.warehouse_id
                    }));
                    
                    try {
                        const result = await apiRequest(API.STOCK_BATCH_SET, {
                            method: 'POST',
                            body: JSON.stringify({
                                company_id: parseInt(COMPANY_ID),
                                stocks: stocks
                            })
                        });
                        
                        const successCount = (result.status || []).filter(s => s.updated).length;
                        updated += successCount;
                        errors += batch.length - successCount;
                        
                        logStock(`Батч ${Math.ceil((i + 1) / batchSize)}: ${successCount}/${batch.length} обновлено`);
                    } catch (e) {
                        errors += batch.length;
                        logStock(`❌ Ошибка батча: ${e.message}`);
                    }
                    
                    await sleep(500);
                }
                
                logStock('════════════════════════════════════');
                logStock(`🎉 ГОТОВО! Обновлено: ${updated}, Ошибок: ${errors}`);
                logStock('════════════════════════════════════');
                
                notify(3, 3, 'ГОТОВО! 🎉', `${updated} товаров обновлено`, 'success');
                showToast(`✅ Остатки: ${updated} товаров`, 'success');
                
            } catch (error) {
                logStock(`❌ Ошибка: ${error.message}`);
                notify(0, 3, 'ОШИБКА ❌', error.message.substring(0, 60), 'error');
                showToast(`Ошибка: ${error.message.substring(0, 40)}`, 'error');
            } finally {
                this.isRunning = false;
                this.shouldStop = false;
                updateButtons();
            }
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // GUI
    // ═══════════════════════════════════════════════════════════════════════════

    let widgetRef = null;

    function updateButtons() {
        if (!widgetRef) return;
        
        const btnProducts = widgetRef.querySelector('#btn-run-products');
        const btnStopProducts = widgetRef.querySelector('#btn-stop-products');
        const btnWarehouse = widgetRef.querySelector('#btn-run-warehouse');
        const btnStopWarehouse = widgetRef.querySelector('#btn-stop-warehouse');
        const btnPriceChanger = widgetRef.querySelector('#btn-run-price-changer');
        const btnStopPriceChanger = widgetRef.querySelector('#btn-stop-price-changer');
        const btnStock = widgetRef.querySelector('#btn-run-stock');
        const btnStopStock = widgetRef.querySelector('#btn-stop-stock');
        
        if (btnProducts && btnStopProducts) {
            btnProducts.style.display = ProductsModule.isRunning ? 'none' : 'block';
            btnStopProducts.style.display = ProductsModule.isRunning ? 'block' : 'none';
        }
        
        if (btnWarehouse && btnStopWarehouse) {
            btnWarehouse.style.display = WarehouseModule.isRunning ? 'none' : 'block';
            btnStopWarehouse.style.display = WarehouseModule.isRunning ? 'block' : 'none';
        }
        
        if (btnPriceChanger && btnStopPriceChanger) {
            btnPriceChanger.style.display = PriceChangerModule.isRunning ? 'none' : 'block';
            btnStopPriceChanger.style.display = PriceChangerModule.isRunning ? 'block' : 'none';
        }
        
        if (btnStock && btnStopStock) {
            btnStock.style.display = StockModule.isRunning ? 'none' : 'block';
            btnStopStock.style.display = StockModule.isRunning ? 'block' : 'none';
        }
    }

    function createWidget() {
        debugLog('Widget', 'Начало создания виджета');
        
        try {
            const config = loadConfig();
            debugLog('Widget', 'Конфиг загружен', config);
        
        const style = document.createElement('style');
        style.textContent = `
            @keyframes toastIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            
            #ozon-toolbox {
                position: fixed;
                top: 10px;
                right: 10px;
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
            }
            
            #ozon-toolbox .toggle-btn {
                width: 44px;
                height: 44px;
                border-radius: 50%;
                background: linear-gradient(135deg, #005bff 0%, #0044cc 100%);
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 10px rgba(0,91,255,0.3);
                transition: transform 0.2s;
                color: white;
                font-size: 16px;
                font-weight: bold;
            }
            
            #ozon-toolbox .toggle-btn:hover { transform: scale(1.1); }
            
            #ozon-toolbox .panel {
                display: none;
                position: absolute;
                top: 54px;
                right: 0;
                background: white;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                width: 320px;
                resize: both;
                overflow: hidden;
                min-width: 280px;
                min-height: 200px;
            }
            
            #ozon-toolbox .panel.open { display: block; }
            
            #ozon-toolbox .header {
                background: linear-gradient(135deg, #005bff 0%, #0044cc 100%);
                color: white;
                padding: 12px 15px;
                font-weight: 600;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            
            #ozon-toolbox .company-badge {
                background: rgba(255,255,255,0.2);
                padding: 2px 8px;
                border-radius: 10px;
                font-size: 11px;
            }
            
            #ozon-toolbox .tabs {
                display: flex;
                border-bottom: 1px solid #eee;
            }
            
            #ozon-toolbox .tab {
                flex: 1;
                padding: 10px;
                text-align: center;
                cursor: pointer;
                border: none;
                background: none;
                font-size: 12px;
                color: #666;
                transition: all 0.2s;
            }
            
            #ozon-toolbox .tab:hover { background: #f5f5f5; }
            #ozon-toolbox .tab.active { color: #005bff; border-bottom: 2px solid #005bff; font-weight: 600; }
            
            #ozon-toolbox .tab-content {
                display: none;
                padding: 15px;
            }
            
            #ozon-toolbox .tab-content.active { display: block; }
            
            #ozon-toolbox .field { margin-bottom: 12px; }
            
            #ozon-toolbox .field label {
                display: block;
                font-size: 11px;
                color: #666;
                margin-bottom: 4px;
                text-transform: uppercase;
            }
            
            #ozon-toolbox .field input,
            #ozon-toolbox .field select,
            #ozon-toolbox .field textarea {
                width: 100%;
                padding: 8px 10px;
                border: 1px solid #ddd;
                border-radius: 6px;
                font-size: 13px;
                box-sizing: border-box;
            }
            
            #ozon-toolbox .field input:focus,
            #ozon-toolbox .field textarea:focus {
                border-color: #005bff;
                outline: none;
            }
            
            #ozon-toolbox .field textarea {
                resize: vertical;
                min-height: 60px;
            }
            
            #ozon-toolbox .row {
                display: flex;
                gap: 10px;
            }
            
            #ozon-toolbox .row .field { flex: 1; }
            
            #ozon-toolbox .btn {
                width: 100%;
                padding: 12px;
                border: none;
                border-radius: 8px;
                font-size: 14px;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.2s;
                margin-top: 10px;
            }
            
            #ozon-toolbox .btn-primary {
                background: linear-gradient(135deg, #005bff 0%, #0044cc 100%);
                color: white;
            }
            
            #ozon-toolbox .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,91,255,0.3); }
            
            #ozon-toolbox .btn-success {
                background: linear-gradient(135deg, #28a745 0%, #1e7e34 100%);
                color: white;
            }
            
            #ozon-toolbox .btn-success:hover { transform: translateY(-1px); }
            
            #ozon-toolbox .btn-danger {
                background: linear-gradient(135deg, #dc3545 0%, #c82333 100%);
                color: white;
            }
            
            #ozon-toolbox .btn-danger:hover { transform: translateY(-1px); }
            
            #ozon-toolbox .stat-row {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid #f0f0f0;
            }
            
            #ozon-toolbox .hint {
                font-size: 10px;
                color: #999;
                margin-top: 4px;
            }
        `;
        document.head.appendChild(style);

        const widget = document.createElement('div');
        widget.id = 'ozon-toolbox';
        widget.innerHTML = `
            <button class="toggle-btn" title="Ozon Toolbox">OZ</button>
            <div class="panel">
                <div class="header">
                    <span>Ozon Toolbox</span>
                    <span class="company-badge">ID: ${COMPANY_ID || 'N/A'}</span>
                </div>
                
                <div class="tabs">
                    <button class="tab active" data-tab="products">Товары</button>
                    <button class="tab" data-tab="warehouse">Склад</button>
                    <button class="tab" data-tab="prices">Цены</button>
                    <button class="tab" data-tab="stock">Остатки</button>
                    <button class="tab" data-tab="sku">SKU</button>
                    <button class="tab" data-tab="promotion">Реклама</button>
                    <button class="tab" data-tab="interceptor">API</button>
                </div>
                
                <!-- ТОВАРЫ -->
                <div class="tab-content active" id="tab-products">
                    <div class="field">
                        <label>Поисковый запрос</label>
                        <input type="text" id="cfg-searchQuery" value="${config.products.searchQuery}" placeholder="Например: губка">
                    </div>
                    
                    <div class="row">
                        <div class="field">
                            <label>Цена</label>
                            <input type="text" id="cfg-price" value="${config.products.price}">
                        </div>
                        <div class="field">
                            <label>Макс. товаров</label>
                            <input type="number" id="cfg-maxToAdd" value="${config.products.maxToAdd}" min="1" max="50">
                        </div>
                    </div>
                    
                    <div class="row">
                        <div class="field">
                            <label>Страниц</label>
                            <input type="number" id="cfg-maxPages" value="${config.products.maxPages}" min="1" max="100">
                        </div>
                        <div class="field">
                            <label>На странице</label>
                            <input type="number" id="cfg-limit" value="${config.products.limit}" min="1" max="50">
                        </div>
                    </div>
                    
                    <button class="btn btn-primary" id="btn-run-products">Найти и добавить</button>
                    <button class="btn btn-danger" id="btn-stop-products" style="display:none">СТОП</button>
                    <div class="hint" style="margin-top:8px">Логи в консоли браузера (F12)</div>
                </div>
                
                <!-- СКЛАД -->
                <div class="tab-content" id="tab-warehouse">
                    <div class="field">
                        <label>Адрес склада *</label>
                        <textarea id="cfg-warehouseAddress" placeholder="Полный адрес с индексом...">${config.warehouse.warehouseAddress}</textarea>
                        <div class="hint">123456, Россия, Область, г Город, ул Улица, д 1</div>
                    </div>
                    
                    <div class="field">
                        <label>Название склада</label>
                        <input type="text" id="cfg-warehouseName" value="${config.warehouse.warehouseName}" placeholder="Авто из адреса">
                    </div>
                    
                    <div class="row">
                        <div class="field">
                            <label>Доставка (мин)</label>
                            <input type="number" id="cfg-deliveryTime" value="${config.warehouse.deliveryTimeMinutes}" min="5" max="180">
                        </div>
                        <div class="field">
                            <label>Скорость (км/ч)</label>
                            <input type="number" id="cfg-courierSpeed" value="${config.warehouse.courierSpeedKmh}" min="10" max="60">
                        </div>
                    </div>
                    
                    <div class="row">
                        <div class="field">
                            <label>Начало</label>
                            <input type="text" id="cfg-workFrom" value="${config.warehouse.workingHoursFrom}" placeholder="08:00" pattern="[0-2][0-9]:[0-5][0-9]" maxlength="5">
                        </div>
                        <div class="field">
                            <label>Конец</label>
                            <input type="text" id="cfg-workTo" value="${config.warehouse.workingHoursTo}" placeholder="22:00" pattern="[0-2][0-9]:[0-5][0-9]" maxlength="5">
                        </div>
                    </div>
                    
                    <div class="field">
                        <label>Режим</label>
                        <select id="cfg-speedMode">
                            <option value="human" ${config.warehouse.speedMode === 'human' ? 'selected' : ''}>Надежный</option>
                            <option value="fast" ${config.warehouse.speedMode === 'fast' ? 'selected' : ''}>Быстрый</option>
                        </select>
                    </div>
                    
                    <div style="background:#e7f3ff;padding:10px;border-radius:6px;margin:10px 0;font-size:11px;color:#0066cc">
                        ℹ️ Координаты (опционально, если геокодер не работает):<br>
                        Найти на <a href="https://yandex.ru/maps" target="_blank" style="color:#0066cc">Яндекс.Картах</a> → ПКМ → "Что здесь?"
                    </div>
                    
                    <div class="row">
                        <div class="field">
                            <label>Широта (lat)</label>
                            <input type="text" id="cfg-manualLat" value="${config.warehouse.manualLat || ''}" placeholder="59.37723">
                        </div>
                        <div class="field">
                            <label>Долгота (lng)</label>
                            <input type="text" id="cfg-manualLng" value="${config.warehouse.manualLng || ''}" placeholder="28.21234">
                        </div>
                    </div>
                    
                    <button class="btn btn-success" id="btn-run-warehouse">Создать склад</button>
                    <button class="btn btn-danger" id="btn-stop-warehouse" style="display:none">СТОП</button>
                    <div class="hint" style="margin-top:8px">Логи в консоли браузера (F12)</div>
                </div>
                
                <!-- ЦЕНЫ -->
                <div class="tab-content" id="tab-prices">
                    <div class="field">
                        <label>Email (для API)</label>
                        <input type="email" id="cfg-userEmail" value="${config.priceChanger.userEmail}" placeholder="your@email.com">
                        <div class="hint">Email аккаунта продавца</div>
                    </div>
                    
                    <div class="field">
                        <label>Порог цены (больше чем)</label>
                        <input type="number" id="cfg-minThreshold" value="${config.priceChanger.minThreshold}" min="1">
                        <div class="hint">Изменятся цены ВЫШЕ этого значения</div>
                    </div>
                    
                    <div class="row">
                        <div class="field">
                            <label>Новая цена от</label>
                            <input type="number" id="cfg-newPriceMin" value="${config.priceChanger.newPriceMin}" min="1">
                        </div>
                        <div class="field">
                            <label>Новая цена до</label>
                            <input type="number" id="cfg-newPriceMax" value="${config.priceChanger.newPriceMax}" min="1">
                        </div>
                    </div>
                    
                    <div style="background:#fff3cd;padding:10px;border-radius:6px;margin:10px 0;font-size:11px;color:#856404">
                        ⚠️ Все товары с ценой > ${config.priceChanger.minThreshold} руб получат случайную цену ${config.priceChanger.newPriceMin}-${config.priceChanger.newPriceMax} руб
                    </div>
                    
                    <button class="btn btn-primary" id="btn-run-price-changer">Изменить цены</button>
                    <button class="btn btn-danger" id="btn-stop-price-changer" style="display:none">СТОП</button>
                    <div class="hint" style="margin-top:8px">Логи в консоли браузера (F12)</div>
                </div>
                
                <!-- ОСТАТКИ -->
                <div class="tab-content" id="tab-stock">
                    <div style="background:#fff3cd;padding:10px;border-radius:6px;margin-bottom:12px;font-size:11px;color:#856404">
                        📦 Установит случайные остатки для ВСЕХ товаров на первом RFBS складе
                    </div>
                    
                    <div class="row">
                        <div class="field">
                            <label>Мин. остаток</label>
                            <input type="number" id="cfg-minStock" value="${config.stock.minStock}" min="1" max="1000">
                        </div>
                        <div class="field">
                            <label>Макс. остаток</label>
                            <input type="number" id="cfg-maxStock" value="${config.stock.maxStock}" min="1" max="1000">
                        </div>
                    </div>
                    
                    <button class="btn btn-primary" id="btn-run-stock">🚀 Установить остатки</button>
                    <button class="btn btn-danger" id="btn-stop-stock" style="display:none">СТОП</button>
                    
                    <div class="hint" style="margin-top:8px">Каждый товар получит случайное значение в указанном диапазоне</div>
                </div>
                
                <!-- SKU -->
                <div class="tab-content" id="tab-sku">
                    <div class="stat-row">
                        <span>Найдено SKU</span>
                        <span id="sku-count">0</span>
                    </div>
                    
                    <div class="field" style="margin-top:10px">
                        <label>Список SKU (построчно)</label>
                        <textarea id="sku-list" style="height:200px;font-family:monospace;font-size:12px" placeholder="Нажмите 'Загрузить' для получения SKU всех товаров..."></textarea>
                    </div>
                    
                    <button class="btn btn-primary" id="btn-load-sku">Загрузить SKU</button>
                    <div class="row" style="margin-top:8px">
                        <button class="btn btn-secondary" id="btn-copy-sku" style="flex:1;background:#dcfce7;color:#16a34a">Копировать</button>
                        <button class="btn btn-secondary" id="btn-clear-sku" style="flex:1;background:#f0f0f0;color:#333">Очистить</button>
                    </div>
                    <div class="hint" style="margin-top:8px">Загружает SKU всех товаров магазина через API</div>
                </div>
                
                <!-- РЕКЛАМА -->
                <div class="tab-content" id="tab-promotion">
                    <div class="field">
                        <label>Название кампании *</label>
                        <input type="text" id="cfg-campaignName" placeholder="Моя рекламная кампания">
                    </div>
                    
                    <div class="field">
                        <label>Дата начала</label>
                        <input type="text" id="cfg-campaignDate" value="${formatTodayDate()}" readonly style="background:#f5f5f5">
                        <div class="hint">Автоматически сегодняшняя дата</div>
                    </div>
                    
                    <div style="background:#e7f3ff;padding:10px;border-radius:6px;margin:10px 0;font-size:11px;color:#0066cc">
                        ℹ️ Кампания создаётся с настройками по умолчанию:<br>
                        • Тип: Продавец<br>
                        • Без детального отзыва<br>
                        • Без рейтинга отзыва
                    </div>
                    
                    <button class="btn btn-primary" id="btn-create-promotion">Создать кампанию</button>
                    
                    <div id="promotion-result"></div>
                    
                    <div class="hint" style="margin-top:8px">Создаёт рекламную кампанию через API</div>
                </div>
                
                <!-- ПЕРЕХВАТЧИК -->
                <div class="tab-content" id="tab-interceptor">
                    <div class="stat-row">
                        <span>Статус</span>
                        <span id="rec-status" style="color:${isRecording ? '#28a745' : '#dc3545'}">${isRecording ? 'Запись' : 'Пауза'}</span>
                    </div>
                    <div class="stat-row">
                        <span>Запросов</span>
                        <span id="req-count">${capturedRequests.length}</span>
                    </div>
                    
                    <div class="row" style="margin-top:12px">
                        <button class="btn btn-primary" id="btn-toggle-rec" style="flex:1">${isRecording ? 'Пауза' : 'Запись'}</button>
                        <button class="btn btn-secondary" id="btn-show-log" style="flex:1;background:#f0f0f0;color:#333">Консоль</button>
                    </div>
                    <div class="row">
                        <button class="btn btn-secondary" id="btn-download" style="flex:1;background:#dcfce7;color:#16a34a">Скачать</button>
                        <button class="btn btn-secondary" id="btn-copy" style="flex:1;background:#f0f0f0;color:#333">Копировать</button>
                    </div>
                    <button class="btn btn-danger" id="btn-clear">Очистить</button>
                    
                    <div style="border-top:1px solid #eee;margin-top:12px;padding-top:12px">
                        <div style="font-weight:600;font-size:12px;margin-bottom:8px">📤 Экспорт сессии</div>
                        <div class="row">
                            <button class="btn btn-secondary" id="btn-export-session" style="flex:1;background:#e7f3ff;color:#0066cc">JSON</button>
                            <button class="btn btn-secondary" id="btn-export-curl" style="flex:1;background:#fff3cd;color:#856404">curl</button>
                            <button class="btn btn-secondary" id="btn-export-python" style="flex:1;background:#d4edda;color:#155724">Python</button>
                        </div>
                        <button class="btn btn-secondary" id="btn-show-cookie-help" style="margin-top:6px;width:100%;background:#f8f9fa;color:#6c757d;font-size:11px">❓ Как получить ВСЕ cookies</button>
                        <div class="hint" style="margin-top:6px">JS не может получить HttpOnly cookies. Смотри инструкцию ↑</div>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(widget);
        widgetRef = widget;

        // Логика
        const toggle = widget.querySelector('.toggle-btn');
        const panel = widget.querySelector('.panel');
        
        toggle.addEventListener('click', () => panel.classList.toggle('open'));
        
        document.addEventListener('click', (e) => {
            if (!widget.contains(e.target)) panel.classList.remove('open');
        });

        // Вкладки
        widget.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                widget.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                widget.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                widget.querySelector(`#tab-${tab.dataset.tab}`).classList.add('active');
            });
        });

        // Кнопки товаров
        widget.querySelector('#btn-run-products').addEventListener('click', () => {
            const cfg = {
                products: {
                    searchQuery: widget.querySelector('#cfg-searchQuery').value,
                    limit: parseInt(widget.querySelector('#cfg-limit').value) || 10,
                    maxPages: parseInt(widget.querySelector('#cfg-maxPages').value) || 20,
                    price: widget.querySelector('#cfg-price').value,
                    maxToAdd: parseInt(widget.querySelector('#cfg-maxToAdd').value) || 9
                }
            };
            saveConfig(cfg);
            ProductsModule.run(cfg);
        });
        
        widget.querySelector('#btn-stop-products').addEventListener('click', () => {
            ProductsModule.stop();
        });

        // Кнопки склада
        widget.querySelector('#btn-run-warehouse').addEventListener('click', () => {
            const cfg = {
                warehouse: {
                    warehouseAddress: widget.querySelector('#cfg-warehouseAddress').value,
                    warehouseName: widget.querySelector('#cfg-warehouseName').value,
                    warehousePhone: '',
                    deliveryTimeMinutes: parseInt(widget.querySelector('#cfg-deliveryTime').value) || 15,
                    courierSpeedKmh: parseInt(widget.querySelector('#cfg-courierSpeed').value) || 30,
                    workingHoursFrom: widget.querySelector('#cfg-workFrom').value || '09:00',
                    workingHoursTo: widget.querySelector('#cfg-workTo').value || '21:00',
                    workingDays: [1,2,3,4,5,6,7],
                    speedMode: widget.querySelector('#cfg-speedMode').value,
                    manualLat: widget.querySelector('#cfg-manualLat').value.trim(),
                    manualLng: widget.querySelector('#cfg-manualLng').value.trim()
                }
            };
            saveConfig(cfg);
            WarehouseModule.run(cfg);
        });
        
        widget.querySelector('#btn-stop-warehouse').addEventListener('click', () => {
            WarehouseModule.stop();
        });

        // Кнопки изменения цен
        widget.querySelector('#btn-run-price-changer').addEventListener('click', () => {
            const cfg = {
                priceChanger: {
                    minThreshold: parseInt(widget.querySelector('#cfg-minThreshold').value) || 100,
                    newPriceMin: parseInt(widget.querySelector('#cfg-newPriceMin').value) || 27,
                    newPriceMax: parseInt(widget.querySelector('#cfg-newPriceMax').value) || 50,
                    userEmail: widget.querySelector('#cfg-userEmail').value.trim()
                }
            };
            saveConfig(cfg);
            PriceChangerModule.run(cfg);
        });
        
        widget.querySelector('#btn-stop-price-changer').addEventListener('click', () => {
            PriceChangerModule.stop();
        });

        // Кнопки остатков
        widget.querySelector('#btn-run-stock').addEventListener('click', () => {
            const cfg = {
                stock: {
                    minStock: parseInt(widget.querySelector('#cfg-minStock').value) || 10,
                    maxStock: parseInt(widget.querySelector('#cfg-maxStock').value) || 50
                }
            };
            StockModule.run(cfg);
        });
        
        widget.querySelector('#btn-stop-stock').addEventListener('click', () => {
            StockModule.stop();
        });

        // Кнопки SKU
        widget.querySelector('#btn-load-sku').addEventListener('click', () => {
            SKUModule.run();
        });
        
        widget.querySelector('#btn-copy-sku').addEventListener('click', () => {
            SKUModule.copyToClipboard();
        });
        
        widget.querySelector('#btn-clear-sku').addEventListener('click', () => {
            SKUModule.clear();
            showToast('Список очищен');
        });

        // Кнопка создания рекламной кампании
        widget.querySelector('#btn-create-promotion').addEventListener('click', () => {
            const campaignName = widget.querySelector('#cfg-campaignName').value;
            PromotionModule.run(campaignName);
        });

        // Кнопки перехватчика
        widget.querySelector('#btn-toggle-rec').addEventListener('click', () => {
            isRecording = !isRecording;
            localStorage.setItem('_interceptorRecording', JSON.stringify(isRecording));
            widget.querySelector('#rec-status').textContent = isRecording ? 'Запись' : 'Пауза';
            widget.querySelector('#rec-status').style.color = isRecording ? '#28a745' : '#dc3545';
            widget.querySelector('#btn-toggle-rec').textContent = isRecording ? 'Пауза' : 'Запись';
            showToast(isRecording ? 'Запись включена' : 'Запись на паузе');
        });
        
        widget.querySelector('#btn-show-log').addEventListener('click', () => {
            console.clear();
            console.log('%cПерехваченные запросы', 'font-size:16px;font-weight:bold');
            console.table(capturedRequests.map(r => ({
                time: r.timestamp?.split('T')[1]?.split('.')[0] || '',
                method: r.method,
                url: r.url?.replace('https://seller.ozon.ru', '') || '',
                status: r.status
            })));
            showToast('Открой консоль (F12)');
        });
        
        widget.querySelector('#btn-download').addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(capturedRequests, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            const blobUrl = URL.createObjectURL(blob);
            a.href = blobUrl;
            a.download = `ozon_requests_${formatTodayDateISO()}.json`;
            a.click();
            URL.revokeObjectURL(blobUrl); // Освобождаем память
            showToast(`Скачано ${capturedRequests.length} запросов`);
        });
        
        widget.querySelector('#btn-copy').addEventListener('click', () => {
            navigator.clipboard.writeText(JSON.stringify(capturedRequests, null, 2));
            showToast(`${capturedRequests.length} запросов скопировано`);
        });
        
        widget.querySelector('#btn-clear').addEventListener('click', () => {
            if (confirm('Очистить все запросы?')) {
                capturedRequests = [];
                localStorage.removeItem('_interceptedRequests');
                widget.querySelector('#req-count').textContent = '0';
                showToast('Очищено');
            }
        });
        
        // Кнопки экспорта сессии
        widget.querySelector('#btn-export-session').addEventListener('click', () => {
            const sessionData = getSessionData();
            const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            const blobUrl = URL.createObjectURL(blob);
            a.href = blobUrl;
            a.download = `ozon_session_${formatTodayDateISO()}.json`;
            a.click();
            URL.revokeObjectURL(blobUrl); // Освобождаем память
            showToast('Сессия экспортирована в JSON');
        });
        
        widget.querySelector('#btn-export-curl').addEventListener('click', () => {
            const cookies = getCookiesObject();
            const curl = generateCurlCommand(cookies);
            navigator.clipboard.writeText(curl);
            showToast('curl команда скопирована');
            console.log('%ccurl команда для тестирования API', 'font-size:14px;font-weight:bold;color:#856404');
            console.log(curl);
        });
        
        widget.querySelector('#btn-export-python').addEventListener('click', () => {
            const cookies = getCookiesObject();
            const python = generatePythonCode(cookies);
            navigator.clipboard.writeText(python);
            showToast('Python код скопирован');
            console.log('%cPython код для тестирования API', 'font-size:14px;font-weight:bold;color:#155724');
            console.log(python);
        });
        
        widget.querySelector('#btn-show-cookie-help').addEventListener('click', () => {
            showCookieExportHelp();
        });
        
        // Обновление счётчика запросов (сохраняем ID для возможности очистки)
        const reqCountIntervalId = setInterval(() => {
            const countEl = widget.querySelector('#req-count');
            if (countEl) {
                countEl.textContent = capturedRequests.length;
            } else {
                // Виджет удалён - очищаем интервал
                clearInterval(reqCountIntervalId);
                debugLog('Widget', 'Интервал счётчика очищен (виджет удалён)');
            }
        }, 2000);
        
        debugLog('Widget', 'Виджет успешно добавлен в DOM');
        
        } catch (error) {
            debugError('Widget', 'Критическая ошибка создания виджета', error);
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ИНИЦИАЛИЗАЦИЯ
    // ═══════════════════════════════════════════════════════════════════════════

    function initWidget() {
        try {
            debugLog('Init', 'Создание виджета...');
            createWidget();
            debugLog('Init', 'Виджет создан успешно');
        } catch (error) {
            debugError('Init', 'Ошибка создания виджета', error);
        }
    }

    if (document.readyState === 'loading') {
        debugLog('Init', 'DOM ещё загружается, ждём DOMContentLoaded');
        document.addEventListener('DOMContentLoaded', initWidget);
    } else {
        debugLog('Init', 'DOM уже готов, создаём виджет сразу');
        initWidget();
    }

    window.OzonToolbox = {
        ProductsModule,
        WarehouseModule,
        PriceChangerModule,
        StockModule,
        SKUModule,
        PromotionModule,
        NotificationSystem,
        getCompanyId: () => COMPANY_ID,
        getConfig: loadConfig,
        setConfig: saveConfig,
        getRequests: () => capturedRequests,
        // Новые функции экспорта сессии
        session: {
            getCookies: getCookiesObject,
            getCookiesString: getCookiesString,
            getSessionData: getSessionData,
            generateCurl: () => generateCurlCommand(getCookiesObject()),
            generatePython: () => generatePythonCode(getCookiesObject()),
            showHelp: showCookieExportHelp
        },
        debug: {
            debugLog,
            debugError,
            isEnabled: () => JSON.parse(localStorage.getItem('_ozonToolboxDebug') ?? 'true'),
            setEnabled: (enabled) => {
                localStorage.setItem('_ozonToolboxDebug', JSON.stringify(!!enabled));
                console.log('[OzonToolbox] DEBUG set to', !!enabled);
            },
            dumpLastRequests: (n = 20) => {
                const arr = capturedRequests.slice(-Math.max(1, Math.min(200, n)));
                console.log('[OzonToolbox] Last requests:', arr);
                console.log('[OzonToolbox] Last requests (string):', safeStringify(arr, 10000));
            }
        }
    };

    console.log('Ozon Toolbox v4.1 loaded');
    console.log(`Company ID: ${COMPANY_ID || 'не найден'}`);
    console.log('Склады: API v3 + Яндекс Геокодер | Экспорт сессии: window.OzonToolbox.session');

})();
