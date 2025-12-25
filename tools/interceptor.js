// ═══════════════════════════════════════════════════════════════
// 🔍 ПЕРЕХВАТЧИК ЗАПРОСОВ - вставь в консоль ПЕРЕД действиями
// Данные сохраняются в localStorage и НЕ теряются при перезагрузке!
// ═══════════════════════════════════════════════════════════════

(function() {
  // Загружаем ранее сохранённые запросы из localStorage
  let capturedRequests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
  
  // Функция сохранения в localStorage
  function saveRequests() {
    localStorage.setItem('_interceptedRequests', JSON.stringify(capturedRequests));
  }
  
  // Сохраняем оригинальный fetch
  const originalFetch = window.fetch;
  
  // Перехватываем fetch
  window.fetch = async function(...args) {
    const [url, options = {}] = args;
    
    // Записываем запрос
    const request = {
      timestamp: new Date().toISOString(),
      url: url,
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.body ? tryParseJSON(options.body) : null
    };
    
    console.log(`🔵 FETCH: ${request.method} ${url}`);
    if (request.body) {
      console.log('   📤 Body:', request.body);
    }
    
    // Выполняем оригинальный запрос
    const response = await originalFetch.apply(this, args);
    
    // Клонируем ответ чтобы прочитать body
    const clone = response.clone();
    
    try {
      const responseBody = await clone.json();
      request.response = responseBody;
      console.log('   📥 Response:', responseBody);
    } catch (e) {
      request.response = 'не JSON';
    }
    
    request.status = response.status;
    capturedRequests.push(request);
    saveRequests(); // Сохраняем после каждого запроса!
    
    return response;
  };
  
  // Перехватываем XMLHttpRequest
  const originalXHROpen = XMLHttpRequest.prototype.open;
  const originalXHRSend = XMLHttpRequest.prototype.send;
  
  XMLHttpRequest.prototype.open = function(method, url) {
    this._interceptedMethod = method;
    this._interceptedUrl = url;
    return originalXHROpen.apply(this, arguments);
  };
  
  XMLHttpRequest.prototype.send = function(body) {
    const xhr = this;
    const request = {
      timestamp: new Date().toISOString(),
      type: 'XHR',
      url: xhr._interceptedUrl,
      method: xhr._interceptedMethod,
      body: tryParseJSON(body)
    };
    
    console.log(`🟡 XHR: ${request.method} ${request.url}`);
    if (request.body) {
      console.log('   📤 Body:', request.body);
    }
    
    xhr.addEventListener('load', function() {
      try {
        request.response = JSON.parse(xhr.responseText);
        console.log('   📥 Response:', request.response);
      } catch (e) {
        request.response = xhr.responseText?.substring(0, 200);
      }
      request.status = xhr.status;
      capturedRequests.push(request);
      saveRequests(); // Сохраняем после каждого запроса!
    });
    
    return originalXHRSend.apply(this, arguments);
  };
  
  function tryParseJSON(str) {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch (e) {
      return str;
    }
  }
  
  // Функции для работы с перехваченными запросами
  window.showRequests = function() {
    // Перезагружаем из localStorage на случай если были изменения
    capturedRequests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
    console.log('\n═══════════════ ПЕРЕХВАЧЕННЫЕ ЗАПРОСЫ ═══════════════');
    console.log(`📊 Всего запросов: ${capturedRequests.length}`);
    capturedRequests.forEach((req, i) => {
      console.log(`\n[${i + 1}] ${req.method} ${req.url}`);
      console.log('    Body:', req.body);
      console.log('    Status:', req.status);
    });
    return capturedRequests;
  };
  
  window.getRequests = function() {
    return JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
  };
  
  window.copyRequests = function() {
    const requests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
    const text = JSON.stringify(requests, null, 2);
    navigator.clipboard.writeText(text);
    console.log(`✅ ${requests.length} запросов скопировано в буфер обмена!`);
  };
  
  window.clearRequests = function() {
    capturedRequests = [];
    localStorage.removeItem('_interceptedRequests');
    console.log('🗑️ Список запросов очищен');
  };
  
  // Фильтр только API запросов
  window.showAPIRequests = function() {
    const allRequests = JSON.parse(localStorage.getItem('_interceptedRequests') || '[]');
    const apiRequests = allRequests.filter(r => 
      r.url.includes('/api/') || r.url.includes('seller.ozon')
    );
    console.log('\n═══════════════ API ЗАПРОСЫ ═══════════════');
    console.log(`📊 API запросов: ${apiRequests.length} из ${allRequests.length}`);
    apiRequests.forEach((req, i) => {
      console.log(`\n[${i + 1}] ${req.method} ${req.url}`);
      if (req.body) console.log('    Body:', JSON.stringify(req.body, null, 2));
    });
    return apiRequests;
  };
  
  // Показать сколько уже записано
  const savedCount = capturedRequests.length;
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ ПЕРЕХВАТЧИК ЗАПРОСОВ АКТИВИРОВАН!');
  console.log('💾 Данные сохраняются в localStorage (не теряются!)');
  if (savedCount > 0) {
    console.log(`📦 Уже записано запросов: ${savedCount}`);
  }
  console.log('═══════════════════════════════════════════════════════');
  console.log('📋 Команды:');
  console.log('   showRequests()    - показать все запросы');
  console.log('   showAPIRequests() - показать только API запросы');
  console.log('   copyRequests()    - скопировать в буфер');
  console.log('   clearRequests()   - очистить список');
  console.log('   getRequests()     - получить массив запросов');
  console.log('═══════════════════════════════════════════════════════');
  console.log('\n🎯 Теперь создай склад - все запросы будут записаны!\n');
})();
