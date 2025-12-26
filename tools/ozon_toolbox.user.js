// ==UserScript==
// @name         Ozon Seller Toolbox
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Полный набор: товары + склады + перехватчик (логи в консоль)
// @author       You
// @match        https://seller.ozon.ru/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // ПЕРЕХВАТЧИК ЗАПРОСОВ (запускается сразу при загрузке)
    // ═══════════════════════════════════════════════════════════════════════════

    let capturedRequests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
    let isRecording = JSON.parse(localStorage.getItem('_interceptorRecording') ?? 'true');

    function saveRequests() {
        localStorage.setItem('_interceptedRequests', JSON.stringify(capturedRequests));
    }

    function tryParseJSON(str) {
        if (!str) return null;
        try { return JSON.parse(str); } catch { return str; }
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

        try { request.response = await clone.json(); } catch { request.response = null; }
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
            try { request.response = JSON.parse(xhr.responseText); } catch { request.response = null; }
            request.status = xhr.status;
            capturedRequests.push(request);
            saveRequests();
        });

        return originalXHRSend.apply(this, arguments);
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // API ENDPOINTS
    // ═══════════════════════════════════════════════════════════════════════════

    const API = {
        SEARCH_PRODUCTS: 'https://seller.ozon.ru/api/v1/search-variant-model',
        CREATE_PRODUCT: 'https://seller.ozon.ru/api/v1/item/create-by-variant',
        WAREHOUSE_CREATE_DRAFT: 'https://seller.ozon.ru/api/v1/warehouse/create-draft',
        WAREHOUSE_UPDATE: 'https://seller.ozon.ru/api/v1/warehouse/update',
        WAREHOUSE_ACTIVATE: 'https://seller.ozon.ru/api/v1/warehouse/activate',
        GEO_SUGGEST: 'https://seller.ozon.ru/api/v1/geo/suggest',
        DELIVERY_METHOD_CREATE: 'https://seller.ozon.ru/api/site/seller-delivery-zones/express/method/create',
        DELIVERY_AREA_CREATE: 'https://seller.ozon.ru/api/site/seller-delivery-zones/express/area/create'
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
            speedMode: "human"
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // УТИЛИТЫ
    // ═══════════════════════════════════════════════════════════════════════════

    function getCompanyIdFromCookie() {
        const match = document.cookie.match(/sc_company_id=(\d+)/);
        return match ? match[1] : null;
    }

    const COMPANY_ID = getCompanyIdFromCookie();

    function loadConfig() {
        try {
            const saved = localStorage.getItem('_ozonToolboxConfig');
            if (!saved) return DEFAULT_CONFIG;
            const parsed = JSON.parse(saved);
            return {
                products: { ...DEFAULT_CONFIG.products, ...parsed.products },
                warehouse: { ...DEFAULT_CONFIG.warehouse, ...parsed.warehouse }
            };
        } catch {
            return DEFAULT_CONFIG;
        }
    }

    function saveConfig(partial) {
        const current = loadConfig();
        const merged = {
            products: { ...current.products, ...partial.products },
            warehouse: { ...current.warehouse, ...partial.warehouse }
        };
        localStorage.setItem('_ozonToolboxConfig', JSON.stringify(merged));
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function log(message) {
        const timestamp = new Date().toLocaleTimeString();
        console.log(`[${timestamp}] ${message}`);
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
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            }
        });
        
        if (!response.ok) {
            const errorText = await response.text().catch(() => 'Unknown error');
            throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
        }
        
        return response.json();
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
                showToast(`Добавлено ${addedCount} товаров`, addedCount > 0 ? 'success' : 'error');
                
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
    // МОДУЛЬ: СОЗДАНИЕ СКЛАДА
    // ═══════════════════════════════════════════════════════════════════════════

    const WarehouseModule = {
        isRunning: false,
        shouldStop: false,
        state: {},
        
        stop() {
            this.shouldStop = true;
            log('Остановка...');
        },
        
        async run(config) {
            if (this.isRunning) {
                showToast('Уже выполняется!', 'error');
                return;
            }
            
            const { warehouseAddress, warehouseName, deliveryTimeMinutes, courierSpeedKmh, 
                    speedMode, workingHoursFrom, workingHoursTo, workingDays } = config.warehouse;
            const companyId = parseInt(COMPANY_ID);
            
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
            
            const logWh = (msg) => log(msg);
            const delay = (ms) => speedMode === 'fast' ? sleep(500) : sleep(ms);
            
            logWh('Создание склада Express');
            logWh(`Company ID: ${companyId}`);
            logWh(`Адрес: ${warehouseAddress.substring(0, 50)}...`);
            
            try {
                // ШАГ 1: Черновик
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 1/7: Создание черновика...');
                
                const draftData = await apiRequest(API.WAREHOUSE_CREATE_DRAFT, {
                    method: 'POST',
                    body: JSON.stringify({
                        company_id: companyId,
                        warehouse_type: 'express'
                    })
                });
                
                this.state.warehouseId = draftData.warehouse_id;
                logWh(`Черновик: ${this.state.warehouseId}`);
                await delay(2000);
                
                // ШАГ 2: Геокодирование
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 2/7: Геокодирование...');
                
                const geoData = await apiRequest(API.GEO_SUGGEST, {
                    method: 'POST',
                    body: JSON.stringify({
                        query: warehouseAddress.trim(),
                        types: ['ADDRESS'],
                        with_postal_code: true
                    })
                });
                
                if (!geoData.items?.length) {
                    throw new Error('Адрес не найден в геокодере');
                }
                
                const geo = geoData.items[0];
                this.state.lat = geo.lat;
                this.state.lng = geo.lng;
                logWh(`Координаты: ${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)}`);
                await delay(1000);
                
                // ШАГ 3: Обновление данных
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 3/7: Заполнение данных...');
                
                const cityMatch = warehouseAddress.match(/г\.?\s*([^,]+)/i) || 
                                  warehouseAddress.match(/город\s+([^,]+)/i);
                const autoName = warehouseName?.trim() || 
                                 (cityMatch ? `Экспресс ${cityMatch[1].trim()}` : 'Экспресс склад');
                const autoPhone = config.warehouse.warehousePhone?.trim() || 
                    `+7${Math.floor(900 + Math.random() * 99)}${Math.floor(1000000 + Math.random() * 9000000)}`;
                
                await apiRequest(API.WAREHOUSE_UPDATE, {
                    method: 'POST',
                    body: JSON.stringify({
                        company_id: companyId,
                        warehouse_id: this.state.warehouseId,
                        name: autoName,
                        address: warehouseAddress.trim(),
                        phone: autoPhone,
                        lat: this.state.lat,
                        lng: this.state.lng,
                        working_days: workingDays,
                        work_time_from: workingHoursFrom,
                        work_time_to: workingHoursTo
                    })
                });
                
                logWh(`Название: ${autoName}`);
                await delay(2000);
                
                // ШАГ 4: Метод доставки
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 4/7: Метод доставки...');
                
                const methodData = await apiRequest(API.DELIVERY_METHOD_CREATE, {
                    method: 'POST',
                    body: JSON.stringify({
                        company_id: companyId,
                        warehouse_id: this.state.warehouseId,
                        delivery_time_minutes: deliveryTimeMinutes
                    })
                });
                
                this.state.methodId = methodData.result?.method_id || methodData.method_id;
                logWh(`Метод: ${this.state.methodId}`);
                await delay(2000);
                
                // ШАГ 5: Расчёт зоны
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 5/7: Расчёт зоны...');
                
                const radiusKm = (deliveryTimeMinutes / 60) * courierSpeedKmh;
                const points = 32;
                const polygon = [];
                
                for (let i = 0; i < points; i++) {
                    const angle = (i / points) * 2 * Math.PI;
                    const latOffset = (radiusKm / 111) * Math.cos(angle);
                    const lngOffset = (radiusKm / (111 * Math.cos(this.state.lat * Math.PI / 180))) * Math.sin(angle);
                    polygon.push([this.state.lng + lngOffset, this.state.lat + latOffset]);
                }
                polygon.push(polygon[0]);
                
                logWh(`Радиус: ${radiusKm.toFixed(1)} км`);
                await delay(1000);
                
                // ШАГ 6: Создание зоны
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 6/7: Создание зоны...');
                
                const areaData = await apiRequest(API.DELIVERY_AREA_CREATE, {
                    method: 'POST',
                    body: JSON.stringify({
                        company_id: companyId,
                        method_id: this.state.methodId,
                        polygon: { coordinates: [polygon] }
                    })
                });
                
                this.state.areaId = areaData.result?.area_id || areaData.area_id;
                logWh(`Зона: ${this.state.areaId}`);
                await delay(2000);
                
                // ШАГ 7: Активация
                if (this.shouldStop) throw new Error('Остановлено');
                logWh('Шаг 7/7: Активация...');
                
                await apiRequest(API.WAREHOUSE_ACTIVATE, {
                    method: 'POST',
                    body: JSON.stringify({
                        company_id: companyId,
                        warehouse_id: this.state.warehouseId
                    })
                });
                
                logWh('================================');
                logWh('СКЛАД СОЗДАН!');
                logWh(`ID: ${this.state.warehouseId}`);
                logWh(`Радиус: ${radiusKm.toFixed(1)} км`);
                logWh('================================');
                
                showToast('Склад создан!', 'success');
                
            } catch (error) {
                logWh(`Ошибка: ${error.message}`);
                showToast(`Ошибка: ${error.message.substring(0, 30)}`, 'error');
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
        
        if (btnProducts && btnStopProducts) {
            btnProducts.style.display = ProductsModule.isRunning ? 'none' : 'block';
            btnStopProducts.style.display = ProductsModule.isRunning ? 'block' : 'none';
        }
        
        if (btnWarehouse && btnStopWarehouse) {
            btnWarehouse.style.display = WarehouseModule.isRunning ? 'none' : 'block';
            btnStopWarehouse.style.display = WarehouseModule.isRunning ? 'block' : 'none';
        }
    }

    function createWidget() {
        const config = loadConfig();
        
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
                    
                    <button class="btn btn-success" id="btn-run-warehouse">Создать склад</button>
                    <button class="btn btn-danger" id="btn-stop-warehouse" style="display:none">СТОП</button>
                    <div class="hint" style="margin-top:8px">Логи в консоли браузера (F12)</div>
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
                    speedMode: widget.querySelector('#cfg-speedMode').value
                }
            };
            saveConfig(cfg);
            WarehouseModule.run(cfg);
        });
        
        widget.querySelector('#btn-stop-warehouse').addEventListener('click', () => {
            WarehouseModule.stop();
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
            a.href = URL.createObjectURL(blob);
            a.download = `ozon_requests_${new Date().toISOString().split('T')[0]}.json`;
            a.click();
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
        
        // Обновление счётчика запросов
        setInterval(() => {
            const countEl = widget.querySelector('#req-count');
            if (countEl) countEl.textContent = capturedRequests.length;
        }, 2000);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ИНИЦИАЛИЗАЦИЯ
    // ═══════════════════════════════════════════════════════════════════════════

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createWidget);
    } else {
        createWidget();
    }

    window.OzonToolbox = {
        ProductsModule,
        WarehouseModule,
        getCompanyId: () => COMPANY_ID,
        getConfig: loadConfig,
        setConfig: saveConfig,
        getRequests: () => capturedRequests
    };

    console.log('Ozon Toolbox v3.0 loaded');
    console.log(`Company ID: ${COMPANY_ID}`);

})();
