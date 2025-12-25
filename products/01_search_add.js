(async () => {
  try {
    // ═══════════════ ПОЛУЧЕНИЕ COMPANY ID ═══════════════
    function getCompanyIdFromCookie() {
        const match = document.cookie.match(/sc_company_id=(\d+)/);
        return match ? match[1] : null;
    }
    
    // ═══════════════ НАСТРОЙКИ ═══════════════
    const searchQuery = "губка";     // ← СЛОВО ДЛЯ ПОИСКА
    const companyId = getCompanyIdFromCookie() || "0";  // ← АВТОМАТИЧЕСКИ из cookie!
    const limit = 10;                 // ← ТОВАРОВ НА СТРАНИЦУ
    const maxPages = 20;              // ← КОЛИЧЕСТВО СТРАНИЦ
    const price = "3100";             // ← ЦЕНА ТОВАРА
    const maxToAdd = 9;               // ← МАКС. ТОВАРОВ ДЛЯ ДОБАВЛЕНИЯ
    // ═════════════════════════════════════════
    
    console.log(`🏢 Company ID: ${companyId} (из cookie)`);
    
    if (!companyId || companyId === "0") {
        throw new Error("❌ Company ID не найден в cookie! Убедитесь что вы залогинены на seller.ozon.ru");
    }
    
    let allItems = [];
    let lastId = null;
    let pageNum = 1;

    // Функция для выполнения запроса
    async function fetchPage(lastId = null) {
      const requestBody = {
        "name": searchQuery,
        "limit": limit.toString()
      };
      
      // Если есть last_id, добавляем его в запрос для получения следующей страницы
      if (lastId) {
        requestBody.last_id = lastId;
      }

      const response = await fetch("https://seller.ozon.ru/api/v1/search-variant-model", {
        method: "POST",
        headers: {
          "accept": "application/json, text/plain, */*",
          "accept-language": "ru",
          "content-type": "application/json",
          "priority": "u=1, i",
          "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "sec-fetch-dest": "empty",
          "sec-fetch-mode": "cors",
          "sec-fetch-site": "same-origin",
          "x-o3-app-name": "seller-ui",
          "x-o3-company-id": companyId,
          "x-o3-language": "ru",
          "x-o3-page-type": "products-other"
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return response.json();
    }

    // Получаем первую страницу
    console.log(`📄 Загрузка страницы ${pageNum}...`);
    let data = await fetchPage();
    console.log(`   Получено товаров: ${data.items?.length || 0}, last_id: ${data.last_id || 'нет'}`);
    console.log('   Полный ответ:', data);
    allItems = allItems.concat(data.items || []);
    lastId = data.last_id;

    // Если есть last_id, продолжаем загружать следующие страницы
    while (lastId && pageNum <= maxPages) {
      pageNum++;
      console.log(`📄 Загрузка страницы ${pageNum}/${maxPages}... (last_id: ${lastId})`);
      data = await fetchPage(lastId);
      console.log(`   Получено товаров: ${data.items?.length || 0}, last_id: ${data.last_id || 'нет'}`);
      console.log('   Полный ответ:', data);
      allItems = allItems.concat(data.items || []);
      lastId = data.last_id;
      
      // Небольшая пауза между запросами
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    if (lastId && pageNum > maxPages) {
      console.log(`⚠️ Достигнут лимит страниц (${maxPages}). Есть ещё результаты.`);
    }

    console.log(`\n✅ Загружено ${pageNum} страниц, всего товаров: ${allItems.length}`);
    
    // Выводим все товары в одной таблице с указанием доступности
    if (allItems.length > 0) {
      console.log(`\n📊 Найдено товаров: ${allItems.length}`);
      console.table(allItems.map(item => {
        const isDenied = item.attributes.find(attr => attr.key === "12085" && attr.value === "deny");
        return {
          id: item.variant_id,
          name: item.name.substring(0, 70) + '...',
          доступность: isDenied ? "❌ Запрещён" : "✅ Доступен"
        };
      }));

      // Статистика
      const availableCount = allItems.filter(item => 
        !item.attributes.find(attr => attr.key === "12085" && attr.value === "deny")
      ).length;
      const deniedCount = allItems.length - availableCount;
      
      console.log(`\n✅ Доступно для выбора: ${availableCount}`);
      console.log(`❌ Запрещено: ${deniedCount}`);
      
      // Добавляем доступные товары на страницу
      const availableItems = allItems.filter(item => 
        !item.attributes.find(attr => attr.key === "12085" && attr.value === "deny")
      );
      
      if (availableItems.length > 0) {
        console.log(`\n🎯 Найдено ${availableItems.length} доступных товаров!`);
        
        // Выбираем разнообразные товары равномерно из списка
        const toAdd = Math.min(maxToAdd, availableItems.length);
        const step = availableItems.length / toAdd;
        const selectedItems = [];
        
        for (let i = 0; i < toAdd; i++) {
          const index = Math.floor(i * step);
          selectedItems.push(availableItems[index]);
        }
        
        console.log(`📦 Будет добавлено ${selectedItems.length} разных товаров:\n`);
        
        let addedCount = 0;
        let errorCount = 0;
        
        for (const item of selectedItems) {
          // Генерируем случайный артикул для каждого товара
          const randomArticle = Math.floor(10000 + Math.random() * 90000).toString();
          
          console.log(`⏳ [${addedCount + errorCount + 1}/${selectedItems.length}] ${item.name.substring(0, 50)}...`);
          
          // Отправляем запрос напрямую в API
          try {
            const response = await fetch('https://seller.ozon.ru/api/v1/item/create-by-variant', {
              method: 'POST',
              headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'ru',
                'content-type': 'application/json',
                'x-o3-app-name': 'seller-ui',
                'x-o3-company-id': companyId,
                'x-o3-language': 'ru',
                'x-o3-page-type': 'products-other'
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
              const result = await response.json();
              console.log(`   ✅ Добавлен! Артикул: ${randomArticle}, item_id: ${result.item_id}`);
              addedCount++;
            } else {
              const error = await response.text();
              console.error(`   ❌ Ошибка: ${error.substring(0, 100)}`);
              errorCount++;
            }
          } catch (error) {
            console.error(`   ❌ Ошибка запроса: ${error.message}`);
            errorCount++;
          }
          
          // Пауза между добавлениями
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log(`\n═══════════════ ИТОГО ═══════════════`);
        console.log(`✅ Успешно добавлено: ${addedCount}`);
        console.log(`❌ Ошибок: ${errorCount}`);
        console.log(`═════════════════════════════════════`);
      }
    } else {
      console.log("\n⚠️ Товары не найдены.");
    }

  } catch (error) {
    console.error("Ошибка выполнения запроса:", error);
  }
})();
