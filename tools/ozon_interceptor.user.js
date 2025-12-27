// ==UserScript==
// @name         Ozon Seller Interceptor
// @namespace    http://tampermonkey.net/
// @version      2.2
// @description  Полный перехватчик API запросов для seller.ozon.ru (заголовки, куки, тело, ответ)
// @author       You
// @match        https://seller.ozon.ru/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // Загружаем ранее сохранённые запросы из localStorage
    let capturedRequests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');

    // Функция сохранения в localStorage
    function saveRequests() {
        localStorage.setItem('_interceptedRequests', JSON.stringify(capturedRequests));
    }

    // Функция получения всех куки (корректно обрабатывает = в значении)
    function getCookies() {
        const cookies = {};
        document.cookie.split(';').forEach(c => {
            const idx = c.indexOf('=');
            if (idx > 0) {
                const name = c.substring(0, idx).trim();
                const value = c.substring(idx + 1).trim();
                cookies[name] = value;
            }
        });
        return cookies;
    }

    // Парсинг строки заголовков XHR в объект
    function parseHeadersString(headersStr) {
        const headers = {};
        if (!headersStr) return headers;
        headersStr.split('\r\n').forEach(line => {
            const idx = line.indexOf(':');
            if (idx > 0) {
                const name = line.substring(0, idx).trim().toLowerCase();
                const value = line.substring(idx + 1).trim();
                headers[name] = value;
            }
        });
        return headers;
    }

    // Куки сохраняем один раз при старте сессии
    let sessionCookies = null;
    function getSessionCookies() {
        if (!sessionCookies) sessionCookies = getCookies();
        return sessionCookies;
    }

    // Сохраняем оригинальный fetch
    const originalFetch = window.fetch;

    // Перехватываем fetch
    window.fetch = async function(...args) {
        const [url, options = {}] = args;

        // Фильтруем только API запросы
        if (!url.includes('/api/') && !url.includes('geoproxy')) {
            return originalFetch.apply(this, args);
        }

        const request = {
            timestamp: new Date().toISOString(),
            type: 'fetch',
            url: url,
            method: options.method || 'GET',
            requestHeaders: options.headers ? {...options.headers} : {},
            credentials: options.credentials || 'same-origin',
            body: options.body ? tryParseJSON(options.body) : null
        };

        console.log(`🔵 [Interceptor] ${request.method} ${url}`);

        try {
            const response = await originalFetch.apply(this, args);
            const clone = response.clone();

            // Собираем заголовки ответа
            const responseHeaders = {};
            response.headers.forEach((value, key) => {
                responseHeaders[key] = value;
            });

            try {
                request.response = await clone.json();
            } catch (e) {
                request.response = 'не JSON';
            }

            request.status = response.status;
            request.responseHeaders = responseHeaders;
            capturedRequests.push(request);
            saveRequests();

            return response;
        } catch (error) {
            request.error = error.message;
            request.status = 0;
            capturedRequests.push(request);
            saveRequests();
            throw error;
        }
    };

    // Перехватываем XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;
    const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

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
        return originalXHRSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const xhr = this;

        // Фильтруем только API запросы
        if (!xhr._interceptedUrl.includes('/api/') && !xhr._interceptedUrl.includes('geoproxy')) {
            return originalXHRSend.apply(this, arguments);
        }

        const request = {
            timestamp: new Date().toISOString(),
            type: 'XHR',
            url: xhr._interceptedUrl,
            method: xhr._interceptedMethod,
            requestHeaders: xhr._interceptedHeaders || {},
            body: tryParseJSON(body)
        };

        console.log(`🟡 [Interceptor] ${request.method} ${request.url}`);

        xhr.addEventListener('load', function() {
            try {
                request.response = JSON.parse(xhr.responseText);
            } catch (e) {
                request.response = 'не JSON';
            }
            request.status = xhr.status;
            request.responseHeaders = parseHeadersString(xhr.getAllResponseHeaders());
            capturedRequests.push(request);
            saveRequests();
        });

        xhr.addEventListener('error', function() {
            request.error = 'Network error';
            request.status = 0;
            capturedRequests.push(request);
            saveRequests();
        });

        return originalXHRSend.apply(this, arguments);
    };

    function tryParseJSON(str) {
        if (!str) return null;
        try {
            return JSON.parse(str);
        } catch (e) {
            return str;
        }
    }

    // Глобальные функции для работы с запросами
    window.showRequests = function() {
        capturedRequests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        console.table(capturedRequests.map(r => ({
            time: r.timestamp.split('T')[1].split('.')[0],
            method: r.method,
            url: r.url.replace('https://seller.ozon.ru', ''),
            status: r.status
        })));
        return capturedRequests;
    };

    window.getRequests = () => JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');

    window.copyRequests = function() {
        const requests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        navigator.clipboard.writeText(JSON.stringify(requests, null, 2));
        console.log(`✅ ${requests.length} запросов скопировано!`);
    };

    window.downloadRequests = function(filename = 'requests.json') {
        const requests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        const blob = new Blob([JSON.stringify(requests, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        console.log(`📥 ${requests.length} запросов сохранено в ${filename}`);
    };

    window.clearRequests = function() {
        capturedRequests = [];
        localStorage.removeItem('_interceptedRequests');
        console.log('🗑️ Очищено');
    };

    window.findCompanyId = function() {
        const requests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        for (const req of requests) {
            // Ищем в response
            if (req.response?.company_id) {
                console.log(`🏢 Company ID: ${req.response.company_id}`);
                return req.response.company_id;
            }
            if (req.response?.result?.company_id) {
                console.log(`🏢 Company ID: ${req.response.result.company_id}`);
                return req.response.result.company_id;
            }
            // Ищем в body
            if (req.body?.company_id) {
                console.log(`🏢 Company ID: ${req.body.company_id}`);
                return req.body.company_id;
            }
        }
        console.log('❌ Company ID не найден в запросах');
        return null;
    };

    // Поиск запросов по URL
    window.findRequests = function(urlPattern) {
        const requests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        const found = requests.filter(r => r.url.includes(urlPattern));
        console.log(`🔍 Найдено ${found.length} запросов по "${urlPattern}":`);
        found.forEach((r, i) => {
            console.log(`\n--- Запрос #${i + 1} ---`);
            console.log('URL:', r.url);
            console.log('Method:', r.method);
            console.log('Type:', r.type);
            console.log('Status:', r.status);
            console.log('Request Headers:', r.requestHeaders);
            console.log('Body:', r.body);
            console.log('Response:', r.response);
        });
        return found;
    };

    // Детальный вывод последнего запроса к URL
    window.lastRequest = function(urlPattern) {
        const requests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        const found = requests.filter(r => r.url.includes(urlPattern));
        if (found.length === 0) {
            console.log(`❌ Запросы к "${urlPattern}" не найдены`);
            return null;
        }
        const last = found[found.length - 1];
        console.log('📋 Последний запрос к', urlPattern);
        console.log(JSON.stringify(last, null, 2));
        return last;
    };

    // Функция для получения куки (вызывать вручную при необходимости)
    window.showCookies = function() {
        const cookies = getCookies();
        console.log('🍪 Cookies:', cookies);
        return cookies;
    };

    // Уведомление при загрузке
    console.log('%c🔍 Ozon Interceptor v2.2 активен', 'color: #00f; font-weight: bold; font-size: 14px;');
    console.log(`📦 Сохранено запросов: ${capturedRequests.length}`);
    console.log('Команды: showRequests() | copyRequests() | downloadRequests() | clearRequests()');
    console.log('         findCompanyId() | findRequests("url") | lastRequest("url")');

})();
