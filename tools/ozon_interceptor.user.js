// ==UserScript==
// @name         Ozon Seller Interceptor
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Перехватчик API запросов для seller.ozon.ru
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

    // Сохраняем оригинальный fetch
    const originalFetch = window.fetch;

    // Перехватываем fetch
    window.fetch = async function(...args) {
        const [url, options = {}] = args;

        // Фильтруем только API запросы
        if (!url.includes('/api/')) {
            return originalFetch.apply(this, args);
        }

        const request = {
            timestamp: new Date().toISOString(),
            url: url,
            method: options.method || 'GET',
            body: options.body ? tryParseJSON(options.body) : null
        };

        console.log(`🔵 [Interceptor] ${request.method} ${url}`);

        const response = await originalFetch.apply(this, args);
        const clone = response.clone();

        try {
            request.response = await clone.json();
        } catch (e) {
            request.response = null;
        }

        request.status = response.status;
        capturedRequests.push(request);
        saveRequests();

        return response;
    };

    // Перехватываем XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._interceptedMethod = method;
        this._interceptedUrl = url;
        return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const xhr = this;

        // Фильтруем только API запросы
        if (!xhr._interceptedUrl.includes('/api/')) {
            return originalXHRSend.apply(this, arguments);
        }

        const request = {
            timestamp: new Date().toISOString(),
            type: 'XHR',
            url: xhr._interceptedUrl,
            method: xhr._interceptedMethod,
            body: tryParseJSON(body)
        };

        console.log(`🟡 [Interceptor] ${request.method} ${request.url}`);

        xhr.addEventListener('load', function() {
            try {
                request.response = JSON.parse(xhr.responseText);
            } catch (e) {
                request.response = null;
            }
            request.status = xhr.status;
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

    // Уведомление при загрузке
    console.log('%c🔍 Ozon Interceptor активен', 'color: #00f; font-weight: bold; font-size: 14px;');
    console.log(`📦 Сохранено запросов: ${capturedRequests.length}`);
    console.log('Команды: showRequests() | copyRequests() | downloadRequests() | clearRequests() | findCompanyId()');

})();
