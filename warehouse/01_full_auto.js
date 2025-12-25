/**
 * Ozon Seller - ПОЛНАЯ АВТОМАТИЗАЦИЯ создания склада Express
 * 
 * Запускать на странице: https://seller.ozon.ru/app/warehouse
 * 
 * Company ID берётся автоматически из cookie!
 * Указать только:
 * 1. warehouseAddress - полный адрес склада
 * 
 * Всё остальное скрипт сделает автоматически!
 */

// ==================== ПОЛУЧЕНИЕ COMPANY ID ИЗ COOKIE ====================

function getCompanyIdFromCookie() {
    const match = document.cookie.match(/sc_company_id=(\d+)/);
    return match ? parseInt(match[1]) : null;
}

const AUTO_COMPANY_ID = getCompanyIdFromCookie();

// ==================== НАСТРОЙКИ (ТОЛЬКО ЭТО МЕНЯТЬ!) ====================

const CONFIG = {
    // ID компании (автоматически из cookie, или укажите вручную)
    companyId: AUTO_COMPANY_ID || 0,  // ← Автоматически!
    
    // Полный адрес склада (обязательно)
    warehouseAddress: "188490, Россия, Ленинградская обл, Кингисеппский р-н, г Ивангород, ул Матросова, 2",
    
    // Название склада (если пусто - сгенерируется из города)
    warehouseName: "",
    
    // Телефон склада (если пусто - сгенерируется)
    warehousePhone: "",
    
    // Время доставки в минутах
    deliveryTimeMinutes: 15,
    
    // Скорость курьера км/ч (для расчета радиуса)
    courierSpeedKmh: 30,
    
    // Рабочие дни (1=Пн, 7=Вс)
    workingDays: [1, 2, 3, 4, 5, 6, 7],
    
    // Расписание работы
    workingHours: { from: "09:00", to: "21:00" },
    
    // Режим скорости:
    // "human" - реалистичные задержки как при ручном заполнении (~1.5 мин)
    // "fast"  - минимальные задержки для быстрого тестирования (~5 сек)
    speedMode: "human"
};

// ==================== ВНУТРЕННИЕ ПЕРЕМЕННЫЕ ====================

const STATE = {
    warehouseDraftId: null,
    deliveryMethodId: null,
    warehouseId: null,
    areaId: null,
    polygonId: null,
    coordinates: { lat: null, lng: null },
    deliveryRadiusKm: null,
    polygonCoordinates: [],
    parsedAddress: {}
};

// ==================== УТИЛИТЫ ====================

function log(emoji, message, data = null) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`[${timestamp}] ${emoji} ${message}`);
    if (data) console.log("   ", data);
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Человеческая задержка с рандомизацией (±30%)
function humanDelay(baseMs) {
    // В быстром режиме - минимальные задержки
    if (CONFIG.speedMode === "fast") {
        return sleep(500);
    }
    
    const variance = 0.3;
    const min = baseMs * (1 - variance);
    const max = baseMs * (1 + variance);
    const delay = Math.floor(Math.random() * (max - min) + min);
    log("⏱️", `Ожидание ${Math.round(delay / 1000)} сек...`);
    return sleep(delay);
}

// Тайминги из реального перехвата (в мс)
const DELAYS = {
    afterDraftCreate: 16000,      // 16 сек - заполнение формы создания склада
    afterMethodCreate: 18000,     // 18 сек - настройка метода доставки  
    afterAreaCreate: 15000,       // 15 сек - рисование зоны на карте
    afterPolygonCreate: 2000,     // 2 сек - быстрый клик
    afterAreaUpdate: 7000,        // 7 сек - подтверждение
    afterSaveWarehouse: 17000,    // 17 сек - настройка возвратов
    betweenSmallSteps: 1500       // 1.5 сек - между мелкими операциями
};

// Общее время выполнения:
// human mode: ~75 сек (1 мин 15 сек) + вариативность ±30%
// fast mode:  ~5 сек

function generatePhone() {
    const code = Math.floor(Math.random() * 900) + 100;
    const num1 = Math.floor(Math.random() * 900) + 100;
    const num2 = Math.floor(Math.random() * 90) + 10;
    const num3 = Math.floor(Math.random() * 90) + 10;
    return `+7 ${code} ${num1} ${num2} ${num3}`;
}

function calculateRadiusByTime(minutes, speedKmh) {
    return Math.round((speedKmh * minutes / 60) * 0.7 * 10) / 10;
}

function generateCirclePolygon(centerLat, centerLng, radiusKm, points = 24) {
    const coordinates = [];
    const earthRadius = 6371;
    
    for (let i = 0; i < points; i++) {  // < вместо <= чтобы не дублировать
        const angle = (2 * Math.PI * i) / points;
        const dLat = (radiusKm / earthRadius) * Math.cos(angle) * (180 / Math.PI);
        const dLng = (radiusKm / earthRadius) * Math.sin(angle) * (180 / Math.PI) / Math.cos(centerLat * Math.PI / 180);
        coordinates.push([centerLat + dLat, centerLng + dLng]);
    }
    
    coordinates.push(coordinates[0]);  // Замыкаем полигон
    return coordinates;
}

// ==================== API ЗАПРОСЫ ====================

async function apiRequest(url, method = "POST", body = null, retries = 2) {
    const options = {
        method,
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        credentials: "include"
    };
    
    if (body && method !== "GET") {
        options.body = JSON.stringify(body);
    }
    
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const response = await fetch(url, options);
            
            let data;
            const text = await response.text();
            try {
                data = text ? JSON.parse(text) : {};
            } catch {
                data = { raw: text };
            }
            
            if (!response.ok) {
                // Retry на 5xx ошибки
                if (response.status >= 500 && attempt < retries) {
                    log("⚠️", `Сервер вернул ${response.status}, повтор ${attempt + 1}/${retries}...`);
                    await sleep(1000 * (attempt + 1));
                    continue;
                }
                throw new Error(`API Error ${response.status}: ${JSON.stringify(data)}`);
            }
            
            return data;
        } catch (e) {
            if (attempt < retries && e.message.includes("fetch")) {
                log("⚠️", `Сетевая ошибка, повтор ${attempt + 1}/${retries}...`);
                await sleep(1000 * (attempt + 1));
                continue;
            }
            throw e;
        }
    }
}

// ==================== ШАГ 1: ГЕОКОДИРОВАНИЕ ====================

async function geocodeAddress() {
    log("🗺️", `Геокодирование: ${CONFIG.warehouseAddress}`);
    
    const encodedAddress = encodeURIComponent(CONFIG.warehouseAddress);
    
    // Пробуем Ozon API
    try {
        const data = await apiRequest(
            `/api/site/address-service/v2/suggest?query=${encodedAddress}&country=RU&limit=1`,
            "GET"
        );
        
        if (data.suggestions && data.suggestions.length > 0) {
            const s = data.suggestions[0];
            if (s.geo) {
                STATE.coordinates = { lat: s.geo.lat, lng: s.geo.lon };
                STATE.parsedAddress = {
                    country: s.data?.country || "Россия",
                    region: s.data?.region || s.data?.area || "",
                    city: s.data?.city || s.data?.settlement || "",
                    street: s.data?.street || "",
                    house: s.data?.house || "",
                    zipcode: s.data?.postal_code || ""
                };
                log("✅", `Координаты: ${STATE.coordinates.lat}, ${STATE.coordinates.lng}`);
                return;
            }
        }
    } catch (e) {
        log("⚠️", "Ozon API не сработал, пробуем OSM...");
    }
    
    // Fallback на OpenStreetMap (с User-Agent по правилам Nominatim)
    try {
        const response = await fetch(
            `https://nominatim.openstreetmap.org/search?format=json&q=${encodedAddress}&limit=1&addressdetails=1`,
            { headers: { "User-Agent": "OzonSellerWarehouseScript/1.0" } }
        );
        const data = await response.json();
        
        if (data && data.length > 0) {
            const r = data[0];
            STATE.coordinates = { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
            STATE.parsedAddress = {
                country: r.address?.country || "Россия",
                region: r.address?.state || r.address?.region || "",
                city: r.address?.city || r.address?.town || r.address?.village || "",
                street: r.address?.road || "",
                house: r.address?.house_number || "",
                zipcode: r.address?.postcode || ""
            };
            log("✅", `Координаты (OSM): ${STATE.coordinates.lat}, ${STATE.coordinates.lng}`);
            return;
        }
    } catch (e) {
        log("❌", "Ошибка OSM", e);
    }
    
    throw new Error("Не удалось получить координаты. Проверьте адрес.");
}

// ==================== ШАГ 2: СОЗДАНИЕ ЧЕРНОВИКА СКЛАДА ====================

async function createWarehouseDraft() {
    log("🏭", "Создание черновика склада...");
    
    const name = CONFIG.warehouseName || 
        `Склад ${STATE.parsedAddress.city || "Express"}`;
    
    const phone = CONFIG.warehousePhone || generatePhone();
    
    // Формируем расписание работы (по перехваченному формату)
    const workingHours = {};
    for (const day of CONFIG.workingDays) {
        workingHours[day.toString()] = CONFIG.workingHours;
    }
    
    // Точный формат из перехвата: /api/site/logistic-service/v3/warehouse/draft/create
    const body = {
        company_id: CONFIG.companyId,
        name: name,
        phone: phone,
        warehouse_type: "rfbs_express",
        address: {
            address: CONFIG.warehouseAddress,
            longitude: STATE.coordinates.lng,
            latitude: STATE.coordinates.lat,
            is_new_address_scheme: true,
            is_house_missing: false,
            country: STATE.parsedAddress.country || "Россия"
        },
        timetable_template: {
            holidays_override: [],
            working_hours: workingHours
        },
        postings_limit: -1,
        goods_by_request: false,
        is_auto_assembly: false
    };
    
    log("📤", "Отправка данных склада", body);
    
    try {
        // Основной endpoint из перехвата
        const data = await apiRequest(
            "/api/site/logistic-service/v3/warehouse/draft/create",
            "POST",
            body
        );
        
        if (data.result) {
            STATE.warehouseDraftId = data.result;
            log("✅", `Черновик создан: ${STATE.warehouseDraftId}`);
            return;
        }
        
        throw new Error(`Неожиданный ответ: ${JSON.stringify(data)}`);
    } catch (e) {
        log("❌", "Ошибка создания черновика", e.message);
        throw new Error(`Не удалось создать черновик склада: ${e.message}`);
    }
}

// ==================== ШАГ 3: СОЗДАНИЕ МЕТОДА ДОСТАВКИ ====================

async function createDeliveryMethod() {
    log("🚚", "Создание метода доставки Express...");
    
    const warehouseName = CONFIG.warehouseName || 
        `Склад ${STATE.parsedAddress.city || "Express"}`;
    
    // Точный формат из перехвата: /api/delivery-method-service/delivery-method/create
    const body = {
        company_id: CONFIG.companyId,
        delivery_type_id: 1,  // 1 = self-delivery (самостоятельная доставка)
        cutoff: "17:00",
        name: `Экспресс. Самостоятельно. ${warehouseName}`,
        tariff_type: "STANDARD_OZON",
        prr_setting: "",
        tpl_integration_type: "non_integrated",
        with_item_list: false,
        make_method_group_id: false,
        is_express: true,
        sla_cut_in: 30,  // время сборки заказа в минутах
        courier_cutoff: CONFIG.deliveryTimeMinutes,  // время доставки курьером
        working_days: CONFIG.workingDays,
        warehouse_draft_id: parseInt(STATE.warehouseDraftId)
    };
    
    log("📤", "Отправка данных метода доставки", body);
    
    try {
        const data = await apiRequest(
            "/api/delivery-method-service/delivery-method/create",
            "POST",
            body
        );
        
        if (data.result?.id) {
            STATE.deliveryMethodId = String(data.result.id);
            log("✅", `Метод доставки создан: ${STATE.deliveryMethodId}`);
            return;
        }
        
        throw new Error(`Неожиданный ответ: ${JSON.stringify(data)}`);
    } catch (e) {
        log("❌", "Ошибка создания метода доставки", e.message);
        throw new Error(`Не удалось создать метод доставки: ${e.message}`);
    }
}

// ==================== ШАГ 4: СОЗДАНИЕ ЗОНЫ И ПОЛИГОНА ====================

async function createDeliveryArea() {
    log("📍", "Создание зоны доставки...");
    
    const data = await apiRequest("/api/delivery-polygon-service/area/create", "POST", {
        area: {
            delivery_method_id: STATE.deliveryMethodId,
            delivery_time: String(CONFIG.deliveryTimeMinutes),
            name: `Доставка ${CONFIG.deliveryTimeMinutes} мин`
        }
    });
    
    STATE.areaId = data.id;
    log("✅", `Зона создана: ${STATE.areaId}`);
}

async function createPolygon() {
    log("🗺️", "Создание полигона...");
    
    // Рассчитываем радиус
    STATE.deliveryRadiusKm = calculateRadiusByTime(CONFIG.deliveryTimeMinutes, CONFIG.courierSpeedKmh);
    log("📏", `Радиус: ${STATE.deliveryRadiusKm} км (${CONFIG.deliveryTimeMinutes} мин @ ${CONFIG.courierSpeedKmh} км/ч)`);
    
    // Генерируем полигон
    STATE.polygonCoordinates = generateCirclePolygon(
        STATE.coordinates.lat,
        STATE.coordinates.lng,
        STATE.deliveryRadiusKm,
        24
    );
    
    const coordinatesString = JSON.stringify([STATE.polygonCoordinates]);
    
    const data = await apiRequest("/api/delivery-polygon-service/v2/polygon/create", "POST", {
        coordinates: coordinatesString
    });
    
    STATE.polygonId = data.polygonId;
    log("✅", `Полигон создан: ${STATE.polygonId} (${STATE.polygonCoordinates.length} точек)`);
}

async function linkPolygonToArea() {
    log("🔗", "Привязка полигона к зоне...");
    
    await apiRequest("/api/delivery-polygon-service/area/update", "POST", {
        area: {
            id: STATE.areaId,
            name: `Доставка ${CONFIG.deliveryTimeMinutes} мин`,
            delivery_time: String(CONFIG.deliveryTimeMinutes),
            multi_polygon_ids: [STATE.polygonId]
        }
    });
    
    log("✅", "Полигон привязан к зоне");
}

// ==================== ШАГ 5: ПРИВЯЗКА И АКТИВАЦИЯ ====================

async function linkWarehouse() {
    log("🏭", "Привязка склада к методу...");
    
    await apiRequest("/api/delivery-polygon-service/delivery-method/save/warehouse", "POST", {
        delivery_method_id: parseInt(STATE.deliveryMethodId),
        warehouse_id: STATE.warehouseDraftId,
        warehouse_location: {
            lat: STATE.coordinates.lat,
            long: STATE.coordinates.lng
        }
    });
    
    log("✅", "Склад привязан");
}

async function configureReturns() {
    log("📦", "Настройка возвратов...");
    
    await apiRequest("/api/seller-returns-methods/v1/returns-setting", "POST", {
        delivery_method_id: parseInt(STATE.deliveryMethodId),
        courier_instruction: {
            comment: "",
            contact_days: 1,
            used_warehouse_phone: true
        }
    });
    
    log("✅", "Возвраты настроены");
}

async function activateDeliveryMethod() {
    log("🚀", "Активация метода доставки...");
    
    const data = await apiRequest("/api/delivery-method-service/delivery-method/activate", "POST", {
        company_id: CONFIG.companyId,
        delivery_method_id: parseInt(STATE.deliveryMethodId)
    });
    
    STATE.warehouseId = data.warehouse_id;
    log("✅", `АКТИВИРОВАНО! Warehouse ID: ${STATE.warehouseId}`);
}

// ==================== ГЛАВНАЯ ФУНКЦИЯ ====================

function validateConfig() {
    const errors = [];
    
    if (!CONFIG.companyId || CONFIG.companyId <= 0) {
        errors.push("❌ Company ID не найден в cookie! Убедитесь что вы залогинены на seller.ozon.ru");
    }
    if (!CONFIG.warehouseAddress || CONFIG.warehouseAddress.trim().length < 10) {
        errors.push("warehouseAddress не указан или слишком короткий");
    }
    if (CONFIG.deliveryTimeMinutes <= 0 || CONFIG.deliveryTimeMinutes > 180) {
        errors.push("deliveryTimeMinutes должен быть от 1 до 180");
    }
    if (CONFIG.courierSpeedKmh <= 0 || CONFIG.courierSpeedKmh > 100) {
        errors.push("courierSpeedKmh должен быть от 1 до 100");
    }
    
    if (errors.length > 0) {
        throw new Error("Ошибки в CONFIG:\n - " + errors.join("\n - "));
    }
}

async function createWarehouseFully() {
    console.clear();
    
    // Валидация настроек
    validateConfig();
    
    console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║        🚀 ПОЛНАЯ АВТОМАТИЗАЦИЯ СОЗДАНИЯ СКЛАДА EXPRESS            ║
╠═══════════════════════════════════════════════════════════════════╣
║  Company ID: ${String(CONFIG.companyId).padEnd(50)}║
║  Адрес: ${CONFIG.warehouseAddress.substring(0, 53).padEnd(55)}║
║  Время доставки: ${String(CONFIG.deliveryTimeMinutes + ' мин').padEnd(45)}║
╚═══════════════════════════════════════════════════════════════════╝
`);
    
    try {
        // ШАГ 1: Геокодирование
        log("📍", "ШАГ 1/7: Геокодирование адреса");
        await geocodeAddress();
        log("⏳", "Имитация заполнения формы склада...");
        await humanDelay(DELAYS.afterDraftCreate);
        
        // ШАГ 2: Черновик склада
        log("🏭", "ШАГ 2/7: Создание черновика склада");
        await createWarehouseDraft();
        log("⏳", "Имитация настройки метода доставки...");
        await humanDelay(DELAYS.afterMethodCreate);
        
        // ШАГ 3: Метод доставки
        log("🚚", "ШАГ 3/7: Создание метода доставки");
        await createDeliveryMethod();
        log("⏳", "Имитация рисования зоны на карте...");
        await humanDelay(DELAYS.afterAreaCreate);
        
        // ШАГ 4: Зона доставки
        log("📍", "ШАГ 4/7: Создание зоны доставки");
        await createDeliveryArea();
        await humanDelay(DELAYS.betweenSmallSteps);
        
        // ШАГ 5: Полигон
        log("🗺️", "ШАГ 5/7: Создание полигона");
        await createPolygon();
        await humanDelay(DELAYS.afterPolygonCreate);
        await linkPolygonToArea();
        log("⏳", "Имитация подтверждения зоны...");
        await humanDelay(DELAYS.afterAreaUpdate);
        
        // ШАГ 6: Привязка
        log("🔗", "ШАГ 6/7: Привязка и настройка");
        await linkWarehouse();
        log("⏳", "Имитация настройки возвратов...");
        await humanDelay(DELAYS.afterSaveWarehouse);
        await configureReturns();
        await humanDelay(DELAYS.betweenSmallSteps);
        
        // ШАГ 7: Активация
        log("🚀", "ШАГ 7/7: Активация");
        await activateDeliveryMethod();
        
        // ГОТОВО!
        console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║                     🎉 СКЛАД УСПЕШНО СОЗДАН!                      ║
╠═══════════════════════════════════════════════════════════════════╣
║  Warehouse ID:      ${String(STATE.warehouseId).padEnd(45)}║
║  Draft ID:          ${String(STATE.warehouseDraftId).padEnd(45)}║
║  Method ID:         ${String(STATE.deliveryMethodId).padEnd(45)}║
║  Area ID:           ${String(STATE.areaId).padEnd(45)}║
║  Polygon ID:        ${String(STATE.polygonId).padEnd(45)}║
║  Радиус доставки:   ${String(STATE.deliveryRadiusKm + ' км').padEnd(45)}║
║  Координаты:        ${String(STATE.coordinates.lat + ', ' + STATE.coordinates.lng).padEnd(45)}║
╚═══════════════════════════════════════════════════════════════════╝
`);
        
        return STATE;
        
    } catch (error) {
        console.error(`
╔═══════════════════════════════════════════════════════════════════╗
║                        ❌ ОШИБКА                                  ║
╠═══════════════════════════════════════════════════════════════════╣
║  ${error.message.substring(0, 63).padEnd(65)}║
╚═══════════════════════════════════════════════════════════════════╝
`);
        console.log("Текущее состояние:", STATE);
        throw error;
    }
}

// ==================== ПОЛУАВТОМАТ (если полный не работает) ====================

/**
 * Если автосоздание черновика не работает - 
 * создайте черновик вручную и запустите эту функцию
 */
async function continueFromDraft(warehouseDraftId, deliveryMethodId = null) {
    if (!warehouseDraftId) {
        throw new Error("warehouseDraftId обязателен!");
    }
    
    STATE.warehouseDraftId = String(warehouseDraftId);
    
    log("📍", "Геокодирование...");
    await geocodeAddress();
    
    if (!deliveryMethodId) {
        log("🚚", "Создание метода доставки...");
        await createDeliveryMethod();
    } else {
        STATE.deliveryMethodId = deliveryMethodId;
    }
    
    log("📍", "Создание зоны...");
    await createDeliveryArea();
    await createPolygon();
    await linkPolygonToArea();
    
    log("🔗", "Привязка...");
    await linkWarehouse();
    await configureReturns();
    
    log("🚀", "Активация...");
    await activateDeliveryMethod();
    
    console.log("🎉 ГОТОВО!", STATE);
    return STATE;
}

// ==================== ЗАПУСК ====================

console.log(`
╔═══════════════════════════════════════════════════════════════════╗
║     Ozon Seller - ПОЛНАЯ АВТОМАТИЗАЦИЯ склада Express             ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  🎯 ОДНА КОМАНДА - ВСЁ АВТОМАТИЧЕСКИ:                            ║
║                                                                   ║
║     createWarehouseFully()                                        ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  📌 Если черновик уже создан вручную:                            ║
║                                                                   ║
║     continueFromDraft("warehouseDraftId")                         ║
║     continueFromDraft("draftId", "methodId")                      ║
║                                                                   ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║  ⚙️ Текущие настройки:                                           ║
║     Company: ${String(CONFIG.companyId).padEnd(50)}║
║     Адрес: ${CONFIG.warehouseAddress.substring(0, 50).padEnd(52)}║
║     Время: ${String(CONFIG.deliveryTimeMinutes + ' мин').padEnd(52)}║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝

👉 Запустите: createWarehouseFully()
`);
