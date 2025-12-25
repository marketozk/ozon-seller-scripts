// ==UserScript==
// @name         Ozon Seller Interceptor GUI
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Перехватчик API запросов с GUI панелью
// @author       You
// @match        https://seller.ozon.ru/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════
    // ПОЛУЧЕНИЕ COMPANY ID ИЗ COOKIE
    // ═══════════════════════════════════════════════════════════════

    function getCompanyIdFromCookie() {
        const match = document.cookie.match(/sc_company_id=(\d+)/);
        return match ? match[1] : null;
    }

    // Сохраняем Company ID сразу при загрузке
    const COMPANY_ID = getCompanyIdFromCookie();

    // ═══════════════════════════════════════════════════════════════
    // ПЕРЕХВАТЧИК
    // ═══════════════════════════════════════════════════════════════

    let capturedRequests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
    let isRecording = JSON.parse(localStorage.getItem('_interceptorRecording') ?? 'true');

    function saveRequests() {
        localStorage.setItem('_interceptedRequests', JSON.stringify(capturedRequests));
        updateCounter();
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
            body: options.body ? tryParseJSON(options.body) : null
        };

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

    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._interceptedMethod = method;
        this._interceptedUrl = url;
        return originalXHROpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const xhr = this;

        if (!isRecording || !xhr._interceptedUrl.includes('/api/')) {
            return originalXHRSend.apply(this, arguments);
        }

        const request = {
            timestamp: new Date().toISOString(),
            type: 'XHR',
            url: xhr._interceptedUrl,
            method: xhr._interceptedMethod,
            body: tryParseJSON(body)
        };

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
        try { return JSON.parse(str); } catch (e) { return str; }
    }

    // ═══════════════════════════════════════════════════════════════
    // GUI ВИДЖЕТ
    // ═══════════════════════════════════════════════════════════════

    function createWidget() {
        // Стили
        const style = document.createElement('style');
        style.textContent = `
            #ozon-interceptor-widget {
                position: fixed;
                top: 10px;
                right: 10px;
                z-index: 999999;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 12px;
            }
            #ozon-interceptor-widget .widget-toggle {
                width: 40px;
                height: 40px;
                border-radius: 50%;
                background: linear-gradient(135deg, #005bff 0%, #0044cc 100%);
                border: none;
                cursor: pointer;
                display: flex;
                align-items: center;
                justify-content: center;
                box-shadow: 0 2px 10px rgba(0,91,255,0.3);
                transition: transform 0.2s, box-shadow 0.2s;
            }
            #ozon-interceptor-widget .widget-toggle:hover {
                transform: scale(1.1);
                box-shadow: 0 4px 15px rgba(0,91,255,0.4);
            }
            #ozon-interceptor-widget .widget-toggle svg {
                width: 20px;
                height: 20px;
                fill: white;
            }
            #ozon-interceptor-widget .widget-toggle .badge {
                position: absolute;
                top: -5px;
                right: -5px;
                background: #ff4444;
                color: white;
                border-radius: 10px;
                padding: 2px 6px;
                font-size: 10px;
                font-weight: bold;
            }
            #ozon-interceptor-widget .widget-panel {
                display: none;
                position: absolute;
                top: 50px;
                right: 0;
                background: white;
                border-radius: 12px;
                box-shadow: 0 4px 20px rgba(0,0,0,0.15);
                width: 280px;
                overflow: hidden;
            }
            #ozon-interceptor-widget .widget-panel.open {
                display: block;
                animation: slideIn 0.2s ease;
            }
            @keyframes slideIn {
                from { opacity: 0; transform: translateY(-10px); }
                to { opacity: 1; transform: translateY(0); }
            }
            #ozon-interceptor-widget .widget-header {
                background: linear-gradient(135deg, #005bff 0%, #0044cc 100%);
                color: white;
                padding: 12px 15px;
                font-weight: 600;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }
            #ozon-interceptor-widget .widget-header .status {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 11px;
                opacity: 0.9;
            }
            #ozon-interceptor-widget .widget-header .status-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: #4ade80;
            }
            #ozon-interceptor-widget .widget-header .status-dot.paused {
                background: #fbbf24;
            }
            #ozon-interceptor-widget .widget-body {
                padding: 15px;
            }
            #ozon-interceptor-widget .stat-row {
                display: flex;
                justify-content: space-between;
                padding: 8px 0;
                border-bottom: 1px solid #f0f0f0;
            }
            #ozon-interceptor-widget .stat-row:last-child {
                border-bottom: none;
            }
            #ozon-interceptor-widget .stat-label {
                color: #666;
            }
            #ozon-interceptor-widget .stat-value {
                font-weight: 600;
                color: #333;
            }
            #ozon-interceptor-widget .btn-group {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 8px;
                margin-top: 12px;
            }
            #ozon-interceptor-widget .btn {
                padding: 10px 12px;
                border: none;
                border-radius: 8px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                transition: all 0.2s;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
            }
            #ozon-interceptor-widget .btn-primary {
                background: #005bff;
                color: white;
            }
            #ozon-interceptor-widget .btn-primary:hover {
                background: #0044cc;
            }
            #ozon-interceptor-widget .btn-secondary {
                background: #f0f0f0;
                color: #333;
            }
            #ozon-interceptor-widget .btn-secondary:hover {
                background: #e0e0e0;
            }
            #ozon-interceptor-widget .btn-danger {
                background: #fee2e2;
                color: #dc2626;
            }
            #ozon-interceptor-widget .btn-danger:hover {
                background: #fecaca;
            }
            #ozon-interceptor-widget .btn-success {
                background: #dcfce7;
                color: #16a34a;
            }
            #ozon-interceptor-widget .btn-success:hover {
                background: #bbf7d0;
            }
            #ozon-interceptor-widget .btn-full {
                grid-column: 1 / -1;
            }
            #ozon-interceptor-widget .company-id {
                margin-top: 12px;
                padding: 10px;
                background: #f8fafc;
                border-radius: 8px;
                text-align: center;
            }
            #ozon-interceptor-widget .company-id-label {
                font-size: 10px;
                color: #666;
                text-transform: uppercase;
            }
            #ozon-interceptor-widget .company-id-value {
                font-size: 18px;
                font-weight: 700;
                color: #005bff;
                cursor: pointer;
            }
            #ozon-interceptor-widget .company-id-value:hover {
                text-decoration: underline;
            }
            #ozon-interceptor-widget .toast {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #333;
                color: white;
                padding: 12px 20px;
                border-radius: 8px;
                font-size: 13px;
                animation: toastIn 0.3s ease;
                z-index: 9999999;
            }
            @keyframes toastIn {
                from { opacity: 0; transform: translateY(20px); }
                to { opacity: 1; transform: translateY(0); }
            }
        `;
        document.head.appendChild(style);

        // HTML виджета
        const widget = document.createElement('div');
        widget.id = 'ozon-interceptor-widget';
        widget.innerHTML = `
            <button class="widget-toggle" title="Ozon Interceptor">
                <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
                <span class="badge" id="request-badge">0</span>
            </button>
            <div class="widget-panel">
                <div class="widget-header">
                    <span>🔍 Interceptor</span>
                    <div class="status">
                        <span class="status-dot" id="status-dot"></span>
                        <span id="status-text">Запись</span>
                    </div>
                </div>
                <div class="widget-body">
                    <div class="stat-row">
                        <span class="stat-label">Запросов</span>
                        <span class="stat-value" id="total-requests">0</span>
                    </div>
                    <div class="stat-row">
                        <span class="stat-label">API запросов</span>
                        <span class="stat-value" id="api-requests">0</span>
                    </div>
                    
                    <div class="company-id" id="company-section" style="${COMPANY_ID ? '' : 'display:none'}">
                        <div class="company-id-label">Company ID <span id="company-source" style="font-size:10px;color:#888">${COMPANY_ID ? '(cookie)' : ''}</span></div>
                        <div class="company-id-value" id="company-id-value" title="Нажми чтобы скопировать">${COMPANY_ID || '—'}</div>
                    </div>
                    
                    <div class="btn-group">
                        <button class="btn btn-primary" id="btn-toggle">
                            ⏸️ Пауза
                        </button>
                        <button class="btn btn-secondary" id="btn-show">
                            📋 Лог
                        </button>
                        <button class="btn btn-success" id="btn-download">
                            💾 Скачать
                        </button>
                        <button class="btn btn-secondary" id="btn-copy">
                            📎 Копировать
                        </button>
                        <button class="btn btn-danger btn-full" id="btn-clear">
                            🗑️ Очистить всё
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(widget);

        // Логика
        const toggle = widget.querySelector('.widget-toggle');
        const panel = widget.querySelector('.widget-panel');
        const badge = widget.querySelector('#request-badge');
        const statusDot = widget.querySelector('#status-dot');
        const statusText = widget.querySelector('#status-text');

        toggle.addEventListener('click', () => {
            panel.classList.toggle('open');
        });

        // Закрыть при клике вне
        document.addEventListener('click', (e) => {
            if (!widget.contains(e.target)) {
                panel.classList.remove('open');
            }
        });

        // Кнопки
        widget.querySelector('#btn-toggle').addEventListener('click', toggleRecording);
        widget.querySelector('#btn-show').addEventListener('click', showRequestsConsole);
        widget.querySelector('#btn-download').addEventListener('click', downloadRequests);
        widget.querySelector('#btn-copy').addEventListener('click', copyRequests);
        widget.querySelector('#btn-clear').addEventListener('click', clearRequests);
        
        widget.querySelector('#company-id-value').addEventListener('click', function() {
            const id = this.textContent;
            if (id !== '—') {
                navigator.clipboard.writeText(id);
                showToast('Company ID скопирован!');
            }
        });

        // Инициализация
        updateCounter();
        updateRecordingStatus();
    }

    function updateCounter() {
        const requests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        const total = requests.length;
        const apiCount = requests.filter(r => r.url?.includes('/api/')).length;
        
        const badge = document.querySelector('#request-badge');
        const totalEl = document.querySelector('#total-requests');
        const apiEl = document.querySelector('#api-requests');
        
        if (badge) badge.textContent = total;
        if (totalEl) totalEl.textContent = total;
        if (apiEl) apiEl.textContent = apiCount;
        
        // Поиск Company ID
        findAndShowCompanyId(requests);
    }

    function findAndShowCompanyId(requests) {
        // Приоритет 1: из cookie (уже получен при загрузке)
        let companyId = COMPANY_ID;
        
        // Приоритет 2: из перехваченных запросов (если cookie нет)
        if (!companyId) {
            for (const req of requests) {
                if (req.response?.company_id) {
                    companyId = req.response.company_id;
                    break;
                }
                if (req.response?.result?.company_id) {
                    companyId = req.response.result.company_id;
                    break;
                }
                if (req.body?.company_id) {
                    companyId = req.body.company_id;
                    break;
                }
                // Поиск в URL
                const match = req.url?.match(/company[_-]?id[=\/](\d+)/i);
                if (match) {
                    companyId = match[1];
                    break;
                }
            }
        }
        
        const section = document.querySelector('#company-section');
        const valueEl = document.querySelector('#company-id-value');
        const sourceEl = document.querySelector('#company-source');
        
        if (companyId && section && valueEl) {
            section.style.display = 'block';
            valueEl.textContent = companyId;
            // Показываем источник
            if (sourceEl) {
                sourceEl.textContent = COMPANY_ID ? '(cookie)' : '(api)';
            }
        }
    }

    function updateRecordingStatus() {
        const statusDot = document.querySelector('#status-dot');
        const statusText = document.querySelector('#status-text');
        const btnToggle = document.querySelector('#btn-toggle');
        
        if (statusDot && statusText && btnToggle) {
            if (isRecording) {
                statusDot.classList.remove('paused');
                statusText.textContent = 'Запись';
                btnToggle.innerHTML = '⏸️ Пауза';
            } else {
                statusDot.classList.add('paused');
                statusText.textContent = 'Пауза';
                btnToggle.innerHTML = '▶️ Запись';
            }
        }
    }

    function toggleRecording() {
        isRecording = !isRecording;
        localStorage.setItem('_interceptorRecording', JSON.stringify(isRecording));
        updateRecordingStatus();
        showToast(isRecording ? '▶️ Запись включена' : '⏸️ Запись на паузе');
    }

    function showRequestsConsole() {
        const requests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        console.clear();
        console.log('%c📋 Перехваченные запросы', 'font-size: 16px; font-weight: bold;');
        console.table(requests.map(r => ({
            time: r.timestamp?.split('T')[1]?.split('.')[0] || '',
            method: r.method,
            url: r.url?.replace('https://seller.ozon.ru', '') || '',
            status: r.status
        })));
        showToast('Открой консоль (F12)');
    }

    function downloadRequests() {
        const requests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        const blob = new Blob([JSON.stringify(requests, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `ozon_requests_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        showToast(`📥 Скачано ${requests.length} запросов`);
    }

    function copyRequests() {
        const requests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        navigator.clipboard.writeText(JSON.stringify(requests, null, 2));
        showToast(`📎 ${requests.length} запросов скопировано`);
    }

    function clearRequests() {
        if (confirm('Очистить все запросы?')) {
            capturedRequests = [];
            localStorage.removeItem('_interceptedRequests');
            updateCounter();
            showToast('🗑️ Очищено');
        }
    }

    function showToast(message) {
        const existing = document.querySelector('.toast');
        if (existing) existing.remove();
        
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        
        setTimeout(() => toast.remove(), 2000);
    }

    // Глобальные функции (для консоли)
    window.showRequests = () => {
        const r = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
        console.table(r.map(x => ({ method: x.method, url: x.url, status: x.status })));
        return r;
    };
    window.getRequests = () => JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
    window.copyRequests = copyRequests;
    window.downloadRequests = downloadRequests;
    window.clearRequests = () => { capturedRequests = []; localStorage.removeItem('_interceptedRequests'); updateCounter(); };

    // Запуск GUI после загрузки DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createWidget);
    } else {
        createWidget();
    }

})();
