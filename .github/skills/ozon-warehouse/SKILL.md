---
name: ozon-warehouse
description: Создание складов на Ozon Seller - 9 шагов от геокодирования до активации. Генерация полигонов зон доставки, расписание курьера, провайдеры. Используй для автоматизации создания складов.
---

# Создание склада Ozon - 9 шагов

## Полный процесс создания склада

### Шаг 1: Геокодирование адреса
```javascript
// Ozon геокодер
const response = await fetch(`https://suggest-maps.ozon.ru/suggest?term=${encodeURIComponent(address)}`);
const data = await response.json();
const coords = { lat: data[0].lat, lng: data[0].lon };
```

### Шаг 2: Получение провайдеров
```javascript
const providers = await fetch('/api/delivery-method-service/provider/filter-by-location', {
    method: 'POST',
    body: JSON.stringify({
        delivery_method_type: 'courier',
        warehouse: { location: coords }
    })
});
```

### Шаг 3: Создание склада
```javascript
const warehouse = await fetch('/api/delivery-method-service/delivery-method/create', {
    method: 'POST',
    body: JSON.stringify({
        delivery_method_type: 'courier',
        name: `Склад ${cityName}`,
        provider_id: providerId,
        warehouse: {
            address: fullAddress,
            phone: '+7 9XX XXX XX XX',
            location: coords
        }
    })
});
```

### Шаг 4: Генерация полигона (неровный круг)
```javascript
function generateIrregularPolygon(centerLat, centerLng, radiusKm, points = 24) {
    const coordinates = [];
    for (let i = 0; i < points; i++) {
        const angle = (i / points) * 2 * Math.PI;
        // ±15% случайное отклонение для естественного вида
        const variation = 0.85 + Math.random() * 0.30;
        const currentRadius = radiusKm * variation;
        
        const lat = centerLat + (currentRadius / 111.32) * Math.cos(angle);
        const lng = centerLng + (currentRadius / (111.32 * Math.cos(centerLat * Math.PI / 180))) * Math.sin(angle);
        coordinates.push([lat, lng]);
    }
    coordinates.push(coordinates[0]); // Замыкаем полигон
    return coordinates;
}
```

### Шаг 5: Сохранение полигона
```javascript
await fetch('/api/delivery-method-service/polygon/save', {
    method: 'POST',
    body: JSON.stringify({
        polygon_id: '', // Пустой для нового
        delivery_method_id: warehouseId,
        is_promo: false,
        polygon_type: 'custom',
        time_from: timeFrom,
        time_to: timeTo,
        polygons: [{ shell: coordinates }]
    })
});
```

### Шаг 6: Установка расписания
```javascript
await fetch('/api/delivery-method-service/delivery-method/schedule/set', {
    method: 'POST',
    body: JSON.stringify({
        delivery_method_id: warehouseId,
        schedule: weekSchedule // 7 дней, часы работы
    })
});
```

### Шаг 7: Настройка cutoff (время отсечки заказов)
```javascript
await fetch('/api/delivery-method-service/cutoff/save', {
    method: 'POST',
    body: JSON.stringify({
        delivery_method_id: warehouseId,
        cutoff_schedules: [/* расписание cutoff */]
    })
});
```

### Шаг 8: Установка расписания курьера (ОБЯЗАТЕЛЬНО!)
```javascript
// Без этого шага активация вернёт ошибку 400
await fetch('/api/delivery-method-service/delivery-method/courier-schedule/set', {
    method: 'POST',
    body: JSON.stringify({
        delivery_method_id: warehouseId,
        courier_schedule: weekSchedule
    })
});
```

### Шаг 9: Активация склада
```javascript
await fetch('/api/delivery-method-service/delivery-method/activate', {
    method: 'POST',
    body: JSON.stringify({
        delivery_method_id: warehouseId
    })
});
```

## Важные замечания

1. **Телефон**: Генерируй только с кодами 900-999 (реальные мобильные РФ)
2. **Полигон**: Неровный круг выглядит естественнее идеального
3. **Courier Schedule**: Обязателен перед активацией! Без него - ошибка 400
4. **Город из адреса**: Если геокодер не вернул город, парси из строки:
   ```javascript
   const cityMatch = address.match(/(?:г\.?\s*|город\s+)([^,]+)/i);
   ```

## Структура расписания

```javascript
const weekSchedule = [
    { day_num: 1, is_active: true, time_from: '09:00', time_to: '21:00' },
    { day_num: 2, is_active: true, time_from: '09:00', time_to: '21:00' },
    // ... до day_num: 7
];
```
