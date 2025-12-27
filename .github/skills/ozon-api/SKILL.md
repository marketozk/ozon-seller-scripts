---
name: ozon-api
description: Работа с Ozon Seller API - эндпоинты, авторизация через x-o3-app-name, перехват запросов, работа с куками. Используй когда нужно делать запросы к API Озона или разбираться в их структуре.
---

# Ozon Seller API

## Авторизация

Все запросы к Ozon Seller API требуют авторизации через cookies браузера. Ключевые заголовки:

```javascript
headers: {
    'Content-Type': 'application/json',
    'x-o3-app-name': 'seller-ui',
    'x-o3-app-version': 'release',
    'Accept': 'application/json'
}
```

Credentials всегда `include` для передачи cookies:
```javascript
fetch(url, { credentials: 'include', headers })
```

## Основные эндпоинты

### Склады (Warehouse)
| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/delivery-method-service/delivery-method/list` | POST | Список складов |
| `/api/delivery-method-service/delivery-method/create` | POST | Создание склада |
| `/api/delivery-method-service/delivery-method/activate` | POST | Активация склада |
| `/api/delivery-method-service/delivery-method/deactivate` | POST | Деактивация склада |
| `/api/delivery-method-service/delivery-method/courier-schedule/set` | POST | Установка расписания курьера |
| `/api/delivery-method-service/polygon/save` | POST | Сохранение зоны доставки |

### Товары (Products)
| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/seller-ui/products` | POST | Список товаров |
| `/api/seller-product/add` | POST | Добавление товара |
| `/api/search/product-search-ssr` | POST | Поиск товаров на Ozon |

### Цены и остатки
| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/v2/product/import/prices` | POST | Обновление цен |
| `/api/v2/product/import/stocks` | POST | Обновление остатков |

### Акции
| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/promo-discount/discounts/list` | POST | Список акций |
| `/api/promo-discount/add-products-to-discount` | POST | Добавление товаров в акцию |

## Перехват запросов

Для отладки и изучения API используй перехватчик:

```javascript
const originalFetch = window.fetch;
window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);
    const url = args[0];
    
    if (url.includes('/api/')) {
        console.log('API Call:', url, args[1]?.body);
    }
    
    return response;
};
```

## Геокодирование

Ozon использует собственный геокодер:
```
https://suggest-maps.ozon.ru/suggest?term={address}
```

Fallback на OpenStreetMap:
```
https://nominatim.openstreetmap.org/search?q={address}&format=json
```

## Примеры запросов

### Создание склада
```javascript
const response = await fetch('/api/delivery-method-service/delivery-method/create', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'x-o3-app-name': 'seller-ui' },
    body: JSON.stringify({
        delivery_method_type: 'courier',
        name: 'Склад Москва',
        provider_id: 12345,
        warehouse: {
            address: 'Москва, ул. Примерная, 1',
            phone: '+7 999 123 45 67',
            location: { lat: 55.7558, lng: 37.6173 }
        }
    })
});
```
