// ==UserScript==
// @name         Ozon Seller Toolbox
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Полный набор инструментов: перехват API + поиск товаров + создание складов
// @author       You
// @match        https://seller.ozon.ru/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function() {
    'use strict';

    // ═══════════════════════════════════════════════════════════════════════════
    // КОНФИГУРАЦИЯ - ЛЕГКО МЕНЯТЬ!
    // Синхронизируется с: products/01_search_add.js и warehouse/01_full_auto.js
    // ═══════════════════════════════════════════════════════════════════════════

    const DEFAULT_CONFIG = {
        // === ПОИСК ТОВАРОВ ===
        products: {
            searchQuery: "губка",        // Слово для поиска
            limit: 10,                    // Товаров на страницу
            maxPages: 20,                 // Макс. страниц
            price: "3100",                // Цена товара
            maxToAdd: 9                   // Макс. товаров для добавления
        },
        
        // === СОЗДАНИЕ СКЛАДА ===
        warehouse: {
            warehouseAddress: "",         // Полный адрес склада
            warehouseName: "",            // Название (авто из города)
            warehousePhone: "",           // Телефон (авто)
            deliveryTimeMinutes: 15,      // Время доставки
            courierSpeedKmh: 30,          // Скорость курьера км/ч
            workingDays: [1,2,3,4,5,6,7], // Рабочие дни
            workingHoursFrom: "09:00",    // Начало работы
            workingHoursTo: "21:00",      // Конец работы
            speedMode: "human"            // human | fast
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
        const saved = localStorage.getItem('_ozonToolboxConfig');
        return saved ? { ...DEFAULT_CONFIG, ...JSON.parse(saved) } : DEFAULT_CONFIG;
    }

    function saveConfig(config) {
        localStorage.setItem('_ozonToolboxConfig', JSON.stringify(config));
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function log(message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        const logEl = document.querySelector('#toolbox-log');
        const text = `[${timestamp}] ${message}`;
        console.log(text, data || '');
        if (logEl) {
            logEl.innerHTML += `<div>${text}</div>`;
            logEl.scrollTop = logEl.scrollHeight;
        }
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

    // ═══════════════════════════════════════════════════════════════════════════
    // МОДУЛЬ: ПОИСК И ДОБАВЛЕНИЕ ТОВАРОВ
    // Синхронизируется с: products/01_search_add.js
    // ═══════════════════════════════════════════════════════════════════════════

    const ProductsModule = {
        isRunning: false,
        
        async run(config) {
            if (this.isRunning) {
                showToast('Уже выполняется!', 'error');
                return;
            }
            
            this.isRunning = true;
            const { searchQuery, limit, maxPages, price, maxToAdd } = config.products;
            const companyId = COMPANY_ID;
            
            log(`Поиск товаров: "${searchQuery}"`);
            log(`Company ID: ${companyId}`);
            
            if (!companyId) {
                log('Company ID не найден!');
                this.isRunning = false;
                return;
            }
            
            try {
                let allItems = [];
                let lastId = null;
                let pageNum = 1;
                
                // Функция запроса страницы
                const fetchPage = async (lastId = null) => {
                    const requestBody = { name: searchQuery, limit: limit.toString() };
                    if (lastId) requestBody.last_id = lastId;
                    
                    const response = await fetch("https://seller.ozon.ru/api/v1/search-variant-model", {
                        method: "POST",
                        headers: {
                            "accept": "application/json",
                            "content-type": "application/json",
                            "x-o3-app-name": "seller-ui",
                            "x-o3-company-id": companyId,
                            "x-o3-language": "ru"
                        },
                        body: JSON.stringify(requestBody)
                    });
                    return response.json();
                };
                
                // Загрузка страниц
                log(`Загрузка страницы ${pageNum}...`);
                let data = await fetchPage();
                allItems = allItems.concat(data.items || []);
                lastId = data.last_id;
                
                while (lastId && pageNum < maxPages) {
                    pageNum++;
                    log(`Страница ${pageNum}/${maxPages}...`);
                    data = await fetchPage(lastId);
                    allItems = allItems.concat(data.items || []);
                    lastId = data.last_id;
                    await sleep(300);
                }
                
                log(`Загружено: ${allItems.length} товаров`);
                
                // Фильтрация доступных
                const availableItems = allItems.filter(item => 
                    !item.attributes?.find(attr => attr.key === "12085" && attr.value === "deny")
                );
                
                log(`Доступно: ${availableItems.length} из ${allItems.length}`);
                
                if (availableItems.length === 0) {
                    log('Нет доступных товаров для добавления');
                    this.isRunning = false;
                    return;
                }
                
                // Выбор товаров
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
                    const randomArticle = Math.floor(10000 + Math.random() * 90000).toString();
                    
                    try {
                        const response = await fetch('https://seller.ozon.ru/api/v1/item/create-by-variant', {
                            method: 'POST',
                            headers: {
                                'accept': 'application/json',
                                'content-type': 'application/json',
                                'x-o3-app-name': 'seller-ui',
                                'x-o3-company-id': companyId,
                                'x-o3-language': 'ru'
                            },
                            body: JSON.stringify({
                                variant_id: item.variant_id,
                                offer_id: randomArticle,
                                price: price,
                                vat: 0,
                                company_id: companyId,
                                currency: "RUB"
                            })
                        });
                        
                        if (response.ok) {
                            log(`Добавлен: ${item.name.substring(0, 40)}... [${randomArticle}]`);
                            addedCount++;
                        } else {
                            log(`Ошибка: ${item.name.substring(0, 30)}...`);
                            errorCount++;
                        }
                    } catch (e) {
                        log(`Ошибка: ${e.message}`);
                        errorCount++;
                    }
                    
                    await sleep(500);
                }
                
                log(`ГОТОВО! Добавлено: ${addedCount}, Ошибок: ${errorCount}`);
                showToast(`Добавлено ${addedCount} товаров!`, 'success');
                
            } catch (error) {
                log(`Ошибка: ${error.message}`);
                showToast('Ошибка выполнения', 'error');
            }
            
            this.isRunning = false;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // МОДУЛЬ: СОЗДАНИЕ СКЛАДА
    // Синхронизируется с: warehouse/01_full_auto.js
    // ═══════════════════════════════════════════════════════════════════════════

    const WarehouseModule = {
        isRunning: false,
        state: {},
        
        async run(config) {
            if (this.isRunning) {
                showToast('Уже выполняется!', 'error');
                return;
            }
            
            const { warehouseAddress, warehouseName, deliveryTimeMinutes, courierSpeedKmh, speedMode } = config.warehouse;
            const companyId = parseInt(COMPANY_ID);
            
            if (!warehouseAddress || warehouseAddress.length < 10) {
                showToast('Укажите адрес склада!', 'error');
                return;
            }
            
            this.isRunning = true;
            log('Создание склада Express');
            log(`Company ID: ${companyId}`);
            log(`Адрес: ${warehouseAddress}`);
            
            const delay = (ms) => speedMode === 'fast' ? sleep(500) : sleep(ms);
            
            try {
                // ШАГ 1: Создание черновика
                log('Шаг 1: Создание черновика склада...');
                
                const draftResponse = await fetch('https://seller.ozon.ru/api/v1/warehouse/create-draft', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        company_id: companyId,
                        warehouse_type: 'express'
                    })
                });
                
                const draftData = await draftResponse.json();
                this.state.warehouseDraftId = draftData.warehouse_id;
                log(`Черновик создан: ${this.state.warehouseDraftId}`);
                
                await delay(2000);
                
                // ШАГ 2: Геокодирование адреса
                log('Шаг 2: Геокодирование адреса...');
                
                const geoResponse = await fetch('https://seller.ozon.ru/api/v1/geo/suggest', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        query: warehouseAddress,
                        types: ['ADDRESS'],
                        with_postal_code: true
                    })
                });
                
                const geoData = await geoResponse.json();
                if (!geoData.items || geoData.items.length === 0) {
                    throw new Error('Адрес не найден');
                }
                
                const geo = geoData.items[0];
                this.state.coordinates = { lat: geo.lat, lng: geo.lng };
                log(`Координаты: ${geo.lat}, ${geo.lng}`);
                
                await delay(1000);
                
                // ШАГ 3: Обновление черновика
                log('Шаг 3: Заполнение данных склада...');
                
                // Генерация названия из адреса если не указано
                const cityMatch = warehouseAddress.match(/г\.?\s*([^,]+)/i) || 
                                  warehouseAddress.match(/город\s+([^,]+)/i);
                const autoName = warehouseName || (cityMatch ? `Экспресс ${cityMatch[1].trim()}` : 'Экспресс склад');
                
                // Генерация телефона
                const autoPhone = config.warehouse.warehousePhone || 
                    `+7${Math.floor(900 + Math.random() * 99)}${Math.floor(1000000 + Math.random() * 9000000)}`;
                
                await fetch('https://seller.ozon.ru/api/v1/warehouse/update', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        company_id: companyId,
                        warehouse_id: this.state.warehouseDraftId,
                        name: autoName,
                        address: warehouseAddress,
                        phone: autoPhone,
                        lat: this.state.coordinates.lat,
                        lng: this.state.coordinates.lng
                    })
                });
                
                log(`Название: ${autoName}`);
                
                await delay(2000);
                
                // ШАГ 4: Создание метода доставки
                log('Шаг 4: Создание метода доставки...');
                
                const methodResponse = await fetch('https://seller.ozon.ru/api/site/seller-delivery-zones/express/method/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        company_id: companyId,
                        warehouse_id: this.state.warehouseDraftId,
                        delivery_time_minutes: deliveryTimeMinutes
                    })
                });
                
                const methodData = await methodResponse.json();
                this.state.deliveryMethodId = methodData.result?.method_id || methodData.method_id;
                log(`Метод доставки: ${this.state.deliveryMethodId}`);
                
                await delay(2000);
                
                // ШАГ 5: Расчет и создание зоны доставки
                log('Шаг 5: Расчет зоны доставки...');
                
                const radiusKm = (deliveryTimeMinutes / 60) * courierSpeedKmh;
                const points = 32;
                const polygon = [];
                
                for (let i = 0; i < points; i++) {
                    const angle = (i / points) * 2 * Math.PI;
                    const latOffset = (radiusKm / 111) * Math.cos(angle);
                    const lngOffset = (radiusKm / (111 * Math.cos(this.state.coordinates.lat * Math.PI / 180))) * Math.sin(angle);
                    polygon.push([
                        this.state.coordinates.lng + lngOffset,
                        this.state.coordinates.lat + latOffset
                    ]);
                }
                polygon.push(polygon[0]); // Замыкаем полигон
                
                log(`Радиус доставки: ${radiusKm.toFixed(1)} км`);
                
                await delay(1000);
                
                // ШАГ 6: Создание зоны
                log('Шаг 6: Создание зоны доставки...');
                
                const areaResponse = await fetch('https://seller.ozon.ru/api/site/seller-delivery-zones/express/area/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        company_id: companyId,
                        method_id: this.state.deliveryMethodId,
                        polygon: { coordinates: [polygon] }
                    })
                });
                
                const areaData = await areaResponse.json();
                this.state.areaId = areaData.result?.area_id || areaData.area_id;
                log(`Зона создана: ${this.state.areaId}`);
                
                await delay(2000);
                
                // ШАГ 7: Активация склада
                log('Шаг 7: Активация склада...');
                
                await fetch('https://seller.ozon.ru/api/v1/warehouse/activate', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        company_id: companyId,
                        warehouse_id: this.state.warehouseDraftId
                    })
                });
                
                log('═══════════════════════════════════════');
                log('СКЛАД УСПЕШНО СОЗДАН!');
                log(`ID склада: ${this.state.warehouseDraftId}`);
                log(`Радиус: ${radiusKm.toFixed(1)} км`);
                log('═══════════════════════════════════════');
                
                showToast('Склад успешно создан!', 'success');
                
            } catch (error) {
                log(`Ошибка: ${error.message}`);
                showToast(`Ошибка: ${error.message}`, 'error');
            }
            
            this.isRunning = false;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // GUI ВИДЖЕТ
    // ═══════════════════════════════════════════════════════════════════════════

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
                font-size: 20px;
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
                max-height: 80vh;
                overflow: hidden;
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
                max-height: 400px;
                overflow-y: auto;
            }
            
            #ozon-toolbox .tab-content.active { display: block; }
            
            #ozon-toolbox .field {
                margin-bottom: 12px;
            }
            
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
            #ozon-toolbox .btn-primary:disabled { background: #ccc; cursor: not-allowed; transform: none; }
            
            #ozon-toolbox .btn-success {
                background: linear-gradient(135deg, #28a745 0%, #1e7e34 100%);
                color: white;
            }
            
            #ozon-toolbox .btn-success:hover { transform: translateY(-1px); }
            
            #ozon-toolbox .log-area {
                background: #1e1e1e;
                color: #0f0;
                font-family: 'Consolas', monospace;
                font-size: 11px;
                padding: 10px;
                border-radius: 6px;
                max-height: 150px;
                overflow-y: auto;
                margin-top: 10px;
            }
            
            #ozon-toolbox .log-area div {
                margin-bottom: 2px;
                word-break: break-all;
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
            <button class="toggle-btn" title="Ozon Toolbox"></button>
            <div class="panel">
                <div class="header">
                    <span> Ozon Toolbox</span>
                    <span class="company-badge">ID: ${COMPANY_ID || '—'}</span>
                </div>
                
                <div class="tabs">
                    <button class="tab active" data-tab="products"> Товары</button>
                    <button class="tab" data-tab="warehouse"> Склад</button>
                </div>
                
                <!-- ВКЛАДКА: ТОВАРЫ -->
                <div class="tab-content active" id="tab-products">
                    <div class="field">
                        <label>Поисковый запрос</label>
                        <input type="text" id="cfg-searchQuery" value="${config.products.searchQuery}" placeholder="Например: губка">
                    </div>
                    
                    <div class="row">
                        <div class="field">
                            <label>Цена (₽)</label>
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
                    
                    <button class="btn btn-primary" id="btn-run-products"> Найти и добавить товары</button>
                    
                    <div class="log-area" id="toolbox-log"></div>
                </div>
                
                <!-- ВКЛАДКА: СКЛАД -->
                <div class="tab-content" id="tab-warehouse">
                    <div class="field">
                        <label>Адрес склада *</label>
                        <textarea id="cfg-warehouseAddress" placeholder="Полный адрес с индексом...">${config.warehouse.warehouseAddress}</textarea>
                        <div class="hint">Формат: 123456, Россия, Область, г Город, ул Улица, д 1</div>
                    </div>
                    
                    <div class="field">
                        <label>Название склада</label>
                        <input type="text" id="cfg-warehouseName" value="${config.warehouse.warehouseName}" placeholder="Авто из адреса">
                    </div>
                    
                    <div class="row">
                        <div class="field">
                            <label>Время доставки (мин)</label>
                            <input type="number" id="cfg-deliveryTime" value="${config.warehouse.deliveryTimeMinutes}" min="5" max="180">
                        </div>
                        <div class="field">
                            <label>Скорость (км/ч)</label>
                            <input type="number" id="cfg-courierSpeed" value="${config.warehouse.courierSpeedKmh}" min="10" max="60">
                        </div>
                    </div>
                    
                    <div class="row">
                        <div class="field">
                            <label>Начало работы</label>
                            <input type="time" id="cfg-workFrom" value="${config.warehouse.workingHoursFrom}">
                        </div>
                        <div class="field">
                            <label>Конец работы</label>
                            <input type="time" id="cfg-workTo" value="${config.warehouse.workingHoursTo}">
                        </div>
                    </div>
                    
                    <div class="field">
                        <label>Режим</label>
                        <select id="cfg-speedMode">
                            <option value="human" ${config.warehouse.speedMode === 'human' ? 'selected' : ''}> Человечный (надёжный)</option>
                            <option value="fast" ${config.warehouse.speedMode === 'fast' ? 'selected' : ''}> Быстрый (для тестов)</option>
                        </select>
                    </div>
                    
                    <button class="btn btn-success" id="btn-run-warehouse"> Создать склад Express</button>
                    
                    <div class="log-area" id="toolbox-log-wh"></div>
                </div>
            </div>
        `;
        document.body.appendChild(widget);

        // Логика переключения
        const toggle = widget.querySelector('.toggle-btn');
        const panel = widget.querySelector('.panel');
        
        toggle.addEventListener('click', () => panel.classList.toggle('open'));
        
        document.addEventListener('click', (e) => {
            if (!widget.contains(e.target)) panel.classList.remove('open');
        });

        // Переключение вкладок
        widget.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                widget.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                widget.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                widget.querySelector(`#tab-${tab.dataset.tab}`).classList.add('active');
            });
        });

        // Кнопка запуска поиска товаров
        widget.querySelector('#btn-run-products').addEventListener('click', () => {
            const config = {
                products: {
                    searchQuery: widget.querySelector('#cfg-searchQuery').value,
                    limit: parseInt(widget.querySelector('#cfg-limit').value),
                    maxPages: parseInt(widget.querySelector('#cfg-maxPages').value),
                    price: widget.querySelector('#cfg-price').value,
                    maxToAdd: parseInt(widget.querySelector('#cfg-maxToAdd').value)
                }
            };
            saveConfig(config);
            widget.querySelector('#toolbox-log').innerHTML = '';
            ProductsModule.run(config);
        });

        // Кнопка создания склада
        widget.querySelector('#btn-run-warehouse').addEventListener('click', () => {
            const config = {
                warehouse: {
                    warehouseAddress: widget.querySelector('#cfg-warehouseAddress').value,
                    warehouseName: widget.querySelector('#cfg-warehouseName').value,
                    deliveryTimeMinutes: parseInt(widget.querySelector('#cfg-deliveryTime').value),
                    courierSpeedKmh: parseInt(widget.querySelector('#cfg-courierSpeed').value),
                    workingHoursFrom: widget.querySelector('#cfg-workFrom').value,
                    workingHoursTo: widget.querySelector('#cfg-workTo').value,
                    speedMode: widget.querySelector('#cfg-speedMode').value
                }
            };
            saveConfig(config);
            widget.querySelector('#toolbox-log').innerHTML = '';
            WarehouseModule.run(config);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // ИНИЦИАЛИЗАЦИЯ
    // ═══════════════════════════════════════════════════════════════════════════

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createWidget);
    } else {
        createWidget();
    }

    // Экспорт в window для отладки
    window.OzonToolbox = {
        ProductsModule,
        WarehouseModule,
        getCompanyId: () => COMPANY_ID,
        getConfig: loadConfig,
        setConfig: saveConfig
    };

    console.log(' Ozon Toolbox v2.0 загружен');
    console.log(` Company ID: ${COMPANY_ID}`);
    console.log('📖 Команды: OzonToolbox.ProductsModule.run(config), OzonToolbox.WarehouseModule.run(config)');

})();
