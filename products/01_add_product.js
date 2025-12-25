// Автоматизация выбора товаров на Ozon
(async function() {
  // Список запросов/артикулов для поиска
  const searchQueries = [
    "https://www.ozon.ru/product/1417782887",
    "https://www.ozon.ru/product/1611499857",
    "https://www.ozon.ru/product/1782244260",
    "https://www.ozon.ru/product/196538347",
    "https://www.ozon.ru/product/1611499746",
    "https://www.ozon.ru/product/1127334733",
    "https://www.ozon.ru/product/1782261812",
    "https://www.ozon.ru/product/1212252446",
    "https://www.ozon.ru/product/1779817919",
    "https://www.ozon.ru/product/1127335693",
    "https://www.ozon.ru/product/343932618",
    "https://www.ozon.ru/product/1143616770",
    "https://www.ozon.ru/product/1877346323",
    "https://www.ozon.ru/product/559168285",
    "https://www.ozon.ru/product/223766725",
    "https://www.ozon.ru/product/1735849410",
    "https://www.ozon.ru/product/1163046528",
    "https://www.ozon.ru/product/1696840992",
    "https://www.ozon.ru/product/1421534275",
    "https://www.ozon.ru/product/557837314",
    "https://www.ozon.ru/product/466340126",
    "https://www.ozon.ru/product/487174314",
    "https://www.ozon.ru/product/1685662846",
    "https://www.ozon.ru/product/262149397",
    "https://www.ozon.ru/product/976725225",
    "https://www.ozon.ru/product/1637396886",
    "https://www.ozon.ru/product/223764865",
    "https://www.ozon.ru/product/880551390",
    "https://www.ozon.ru/product/488476041",
    "https://www.ozon.ru/product/262149363",
    "https://www.ozon.ru/product/1845624800",
    "https://www.ozon.ru/product/1781437065",
    "https://www.ozon.ru/product/511701654",
    "https://www.ozon.ru/product/963479668",
    "https://www.ozon.ru/product/1623067845",
    "https://www.ozon.ru/product/1858760611",
    "https://www.ozon.ru/product/262143127",
    "https://www.ozon.ru/product/1063503746",
    "https://www.ozon.ru/product/1753963593",
    "https://www.ozon.ru/product/262156056",
    "https://www.ozon.ru/product/1731464187",
    "https://www.ozon.ru/product/491653062",
    "https://www.ozon.ru/product/708790653",
    "https://www.ozon.ru/product/875468298",
    "https://www.ozon.ru/product/666039813",
    "https://www.ozon.ru/product/519317030",
    "https://www.ozon.ru/product/764702105",
    "https://www.ozon.ru/product/1543288709",
    "https://www.ozon.ru/product/544304538",
    "https://www.ozon.ru/product/1415390066",
    "https://www.ozon.ru/product/557979213",
    "https://www.ozon.ru/product/257261188",
    "https://www.ozon.ru/product/720267517",
    "https://www.ozon.ru/product/1719388991",
    "https://www.ozon.ru/product/334936746",
    "https://www.ozon.ru/product/750834547",
    "https://www.ozon.ru/product/354605502",
    "https://www.ozon.ru/product/1766898472",
    "https://www.ozon.ru/product/1654584228",
    "https://www.ozon.ru/product/1553874290",
    "https://www.ozon.ru/product/878623959",
    "https://www.ozon.ru/product/820586255",
    "https://www.ozon.ru/product/1823858350",
    "https://www.ozon.ru/product/257258313",
    "https://www.ozon.ru/product/1654551125",
    "https://www.ozon.ru/product/1329479972",
    "https://www.ozon.ru/product/1824002639",
    "https://www.ozon.ru/product/400919989",
    "https://www.ozon.ru/product/951703673",
    "https://www.ozon.ru/product/1573150688",
    "https://www.ozon.ru/product/1356700928",
    "https://www.ozon.ru/product/1375392316"
  ];

  // Функция для проверки товара через API
  async function checkProductAPI(query) {
    try {
      const response = await fetch("https://seller.ozon.ru/api/v1/search-variant-model", {
        method: "POST",
        headers: {
          "accept": "application/json, text/plain, */*",
          "accept-language": "ru",
          "content-type": "application/json",
          "x-o3-app-name": "seller-ui",
          "x-o3-company-id": "2656710",  // ИЗМЕНИТЬ ID МАГАЗИНА НА СВОЙ!!!
          "x-o3-language": "ru",
          "x-o3-page-type": "products-other"
        },
        body: JSON.stringify({
          name: query,
          limit: "10"
        })
      });

      if (!response.ok) {
        console.error(`Запрос для "${query}" вернул ошибку:`, response.status, response.statusText);
        return { success: false, items: [] };
      }

      const data = await response.json();

      // Предположим, что "нельзя выбрать" = атрибут key=12085 со значением "deny"
      const selectableItems = (data.items || []).filter(item => {
        const denyAttr = item.attributes.find(a => a.key === "12085" && a.value === "deny");
        // Если атрибута с deny нет, значит выбирать можно
        return !denyAttr;
      });

      if (selectableItems.length === 0) {
        console.log(`По запросу "${query}" не найдено доступных для выбора товаров`);
        return { success: false, items: [] };
      } else {
        selectableItems.forEach(it => {
          console.log(`\n"${query}"`);
          console.log("—", it.variant_id, it.name);
        });
        return { success: true, items: selectableItems };
      }

    } catch (error) {
      console.error(`Ошибка при обработке "${query}":`, error);
      return { success: false, items: [] };
    }
  }

  // Функция для очистки поля ввода
  async function clearInput(inputElement) {
    inputElement.value = "";
    // Симулируем событие изменения для обновления состояния поля
    inputElement.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  // Функция для ввода URL в поле поиска
  async function enterSearchQuery(query) {
    // Находим поле ввода по ID или другим атрибутам
    const inputField = document.querySelector('input[id^="baseInput_"]');

    if (!inputField) {
      console.error("Поле ввода не найдено");
      return false;
    }

    // Очищаем поле ввода перед вводом нового запроса
    await clearInput(inputField);

    // Вводим URL в поле
    inputField.value = query;
    inputField.dispatchEvent(new Event('input', { bubbles: true }));

    // Возвращаем true, если поле ввода найдено и заполнено
    return true;
  }

  // Функция для ожидания результатов поиска
  async function waitForSearchResults() {
    const maxWaitTime = 10000; // 10 секунд
    const checkInterval = 200; // 200 мс
    let elapsedTime = 0;

    return new Promise(resolve => {
      const checkResults = () => {
        // Проверяем наличие кнопки "Выбрать"
        const selectButton = document.querySelector('button[name][class*="button-module_button_"][class*="product-option_action_"]');

        // Проверяем наличие сообщения "Не нашли такой товар"
        const notFoundMessage = document.querySelector('div[class*="index_header_"]');
        const isNotFound = notFoundMessage && notFoundMessage.textContent.includes("Не нашли такой товар");

        if (selectButton) {
          resolve({ found: true, button: selectButton });
        } else if (isNotFound) {
          resolve({ found: false, message: "Товар не найден" });
        } else if (elapsedTime >= maxWaitTime) {
          resolve({ found: false, message: "Время ожидания истекло" });
        } else {
          elapsedTime += checkInterval;
          setTimeout(checkResults, checkInterval);
        }
      };

      checkResults();
    });
  }

  // Главная функция для обработки всех запросов
  async function processQueries() {
    for (const query of searchQueries) {
      console.log(`Обработка запроса: ${query}`);

      // Сначала проверяем товар через API
      const apiResult = await checkProductAPI(query);

      if (!apiResult.success) {
        console.log(`Пропускаем запрос: ${query} (недоступен по API)`);
        continue;
      }

      // Вводим URL в поле поиска
      const inputSuccess = await enterSearchQuery(query);
      if (!inputSuccess) {
        console.error(`Не удалось ввести запрос: ${query}`);
        continue;
      }

      // Ждем результаты поиска
      const result = await waitForSearchResults();

      if (result.found) {
        console.log(`Товар найден: ${query}`);
        // Кликаем на кнопку "Выбрать"
        result.button.click();
        // Ждем 2 секунды перед следующим запросом
        await new Promise(resolve => setTimeout(resolve, 2000));
      } else {
        console.log(`${result.message}: ${query}`);
        // Короткая пауза перед следующим запросом
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    console.log("Все запросы обработаны");
  }

  // Запускаем процесс
  try {
    await processQueries();
  } catch (error) {
    console.error("Произошла ошибка:", error);
  }
})();