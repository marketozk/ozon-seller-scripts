// Скрипт для разблокировки переключателей на странице Ozon

(function() {
  console.log('🔓 Запуск разблокировки переключателей...');
  
  // Находим все заблокированные чекбоксы
  const disabledCheckboxes = document.querySelectorAll('input[type="checkbox"][disabled]');
  
  if (disabledCheckboxes.length === 0) {
    console.log('ℹ️ Заблокированные переключатели не найдены');
    return;
  }
  
  console.log(`📋 Найдено заблокированных переключателей: ${disabledCheckboxes.length}`);
  
  // Разблокируем каждый чекбокс
  disabledCheckboxes.forEach((checkbox, index) => {
    checkbox.removeAttribute('disabled');
    console.log(`✅ Переключатель ${index + 1} разблокирован`);
  });
  
  console.log(`\n🎉 Успешно разблокировано переключателей: ${disabledCheckboxes.length}`);
})();
