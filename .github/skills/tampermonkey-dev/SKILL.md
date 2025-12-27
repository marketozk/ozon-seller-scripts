---
name: tampermonkey-dev
description: Разработка Tampermonkey userscripts - структура, GM_* API, @grant директивы, UI паттерны, работа с DOM. Используй при создании или модификации userscripts.
---

# Tampermonkey Userscript Development

## Структура заголовка

```javascript
// ==UserScript==
// @name         Script Name
// @namespace    https://example.com/
// @version      1.0.0
// @description  Description
// @author       Author
// @match        https://seller.ozon.ru/*
// @icon         https://example.com/favicon.ico
// @updateURL    https://raw.githubusercontent.com/user/repo/main/script.user.js
// @downloadURL  https://raw.githubusercontent.com/user/repo/main/script.user.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// ==/UserScript==
```

## GM_* API

### Хранение данных
```javascript
// Сохранение (поддерживает объекты)
GM_setValue('config', { key: 'value', nested: { a: 1 } });

// Чтение с дефолтом
const config = GM_getValue('config', { key: 'default' });
```

### Стили
```javascript
GM_addStyle(`
    .my-panel {
        position: fixed;
        top: 10px;
        right: 10px;
        z-index: 10000;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.15);
    }
`);
```

### Кросс-доменные запросы
```javascript
GM_xmlhttpRequest({
    method: 'GET',
    url: 'https://api.example.com/data',
    headers: { 'Authorization': 'Bearer token' },
    onload: (response) => {
        const data = JSON.parse(response.responseText);
    },
    onerror: (error) => console.error(error)
});
```

## UI Паттерны

### Плавающая панель
```javascript
const panel = document.createElement('div');
panel.innerHTML = `
    <div class="panel-header">
        <span class="title">🛠 Toolbox</span>
        <button class="minimize-btn">−</button>
    </div>
    <div class="panel-content">
        <!-- Содержимое -->
    </div>
`;
document.body.appendChild(panel);
```

### Drag & Drop
```javascript
let isDragging = false, offsetX, offsetY;

header.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - panel.offsetLeft;
    offsetY = e.clientY - panel.offsetTop;
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    panel.style.left = (e.clientX - offsetX) + 'px';
    panel.style.top = (e.clientY - offsetY) + 'px';
});

document.addEventListener('mouseup', () => isDragging = false);
```

### Система уведомлений
```javascript
const NotificationSystem = {
    container: null,
    
    init() {
        this.container = document.createElement('div');
        this.container.style.cssText = `
            position: fixed; top: 20px; right: 20px;
            z-index: 100000; display: flex; flex-direction: column; gap: 10px;
        `;
        document.body.appendChild(this.container);
    },
    
    show(message, type = 'info', duration = 3000) {
        const colors = {
            success: '#10b981', error: '#ef4444',
            warning: '#f59e0b', info: '#3b82f6'
        };
        
        const notification = document.createElement('div');
        notification.style.cssText = `
            padding: 12px 20px; border-radius: 8px;
            background: ${colors[type]}; color: white;
            animation: slideIn 0.3s ease;
        `;
        notification.textContent = message;
        
        this.container.appendChild(notification);
        setTimeout(() => notification.remove(), duration);
    }
};
```

## Модульная архитектура

```javascript
const Module = {
    name: 'ModuleName',
    state: {},
    
    init() {
        this.loadState();
        this.render();
    },
    
    loadState() {
        const saved = GM_getValue(`module_${this.name}`, {});
        this.state = { ...this.defaultState, ...saved };
    },
    
    saveState() {
        GM_setValue(`module_${this.name}`, this.state);
    },
    
    render() {
        return `<div class="module">${this.name}</div>`;
    },
    
    async action() {
        // Основная логика
    }
};
```

## Версионирование

- Инкрементируй `@version` при каждом изменении
- Используй semver: MAJOR.MINOR.PATCH
- updateURL/downloadURL должны указывать на raw GitHub URL

## Отладка

```javascript
// Логирование с префиксом
const log = (...args) => console.log('[Toolbox]', ...args);

// Сохранение дебаг-информации
const debug = {
    lastRequest: null,
    lastResponse: null,
    errors: []
};
```
