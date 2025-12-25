// ============================================
// Скрипт для отладки: Сбор элементов страницы
// Скопируйте весь код и выполните в консоли браузера (F12)
// ============================================

(function() {
    console.log("🔍 Запуск сканирования страницы...");
    
    // Селекторы элементов для ИИ:
    // - button, a, input, select — стандартные интерактивные элементы
    // - [role="button"], [role="option"] — ARIA-роли для кастомных компонентов (React, Vue)
    // - .tsBody500Small — специфичный класс Ozon для текстовых блоков
    // - span[class*="text"] — спаны с текстом (часто это лейблы, цены, описания)
    // - div[class*="card"] — карточки товаров на Ozon
    const selector = 'button, a, input, select, [role="button"], [role="option"], .tsBody500Small, span[class*="text"], div[class*="card"]';
    const elements = document.querySelectorAll(selector);
    const simplifiedDOM = [];
    const seenTexts = new Set(); // Для отслеживания дублей
    let refCounter = 1;

    elements.forEach(el => {
        // Проверка видимости
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0 || el.offsetParent === null) return;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return;

        // Сбор атрибутов
        const text = el.innerText.slice(0, 50).replace(/\n/g, ' ').trim();
        const ariaLabel = el.getAttribute('aria-label') || '';
        const placeholder = el.getAttribute('placeholder') || '';
        
        if (!text && !ariaLabel && !placeholder && el.tagName.toLowerCase() !== 'input') return;

        // Убираем дубли: если текст уже встречался, пропускаем
        const uniqueKey = `${el.tagName.toLowerCase()}-${text}-${ariaLabel}-${placeholder}`;
        if (seenTexts.has(uniqueKey)) return;
        seenTexts.add(uniqueKey);

        // Регистрация элемента
        simplifiedDOM.push({
            ref: refCounter++,
            tag: el.tagName.toLowerCase(),
            text: text,
            type: el.type || '',
            placeholder: placeholder,
            ariaLabel: ariaLabel
        });
    });

    console.log(`✅ Сканирование завершено. Найдено элементов: ${simplifiedDOM.length} (без дублей)`);
    console.log("📋 Данные (JSON):");
    console.log(JSON.stringify(simplifiedDOM, null, 2));
    
    console.log("\n📊 Статистика по типам элементов:");
    const stats = {};
    simplifiedDOM.forEach(item => {
        const key = item.tag;
        stats[key] = (stats[key] || 0) + 1;
    });
    console.table(stats);

    console.log("\n💾 Скопировать JSON в буфер обмена:");
    console.log("copy(window.__debugScanResult)");
    
    // Сохраняем в глобальную переменную для удобства
    window.__debugScanResult = simplifiedDOM;
    
    return simplifiedDOM;
})();
