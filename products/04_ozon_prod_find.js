function copyToClipboard(text) {
  navigator.clipboard.writeText(text)
      .then(() => console.log('Список ссылок скопирован в буфер обмена.'))
      .catch(err => console.error('Ошибка копирования:', err));
}

function extractLinks() {
  const allLinks = document.querySelectorAll('a[href*="/product"]');
  const productLinks = [];

  allLinks.forEach(link => {
    const href = link.href;
    const idMatch = href.match(/\/(\d+)(?=\/?(\?|$)|-)/) || href.match(/-(\d+)(?=\/?(\?|$))/);

    if (idMatch) {
      const productId = idMatch[1];
      productLinks.push(`https://www.ozon.ru/product/${productId}`);
    }
  });

  const uniqueProductLinks = [...new Set(productLinks)];

  // Формируем массив в нужном формате
  const arrayContent = uniqueProductLinks
      .map(link => `  "${link}"`)
      .join(',\n');

  const textToCopy = `const searchQueries = [\n${arrayContent}\n];`;

  console.log('Готовый массив:');
  console.log(textToCopy);
  console.log('Всего ссылок:', uniqueProductLinks.length);

  copyToClipboard(textToCopy);
}

console.log('Перейдите на вкладку страницы, скрипт сработает через 5 секунд...');
setTimeout(extractLinks, 5000);