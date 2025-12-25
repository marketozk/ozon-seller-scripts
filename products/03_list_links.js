// Функция копирования ссылок в буфер обмена
function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
        .then(() => console.log('Список ссылок скопирован в буфер обмена.'))
        .catch(err => console.error('Ошибка копирования:', err));
}

// Основной скрипт
function extractLinks() {
    const allLinks = document.querySelectorAll('a[href*="/product"]');
    const productLinks = [];

    allLinks.forEach(link => {
        const href = link.href;
        if (href.includes('/product') && /\d+$/.test(href)) {
            productLinks.push(href);
        }
    });

    const uniqueProductLinks = [...new Set(productLinks)];

    uniqueProductLinks.forEach(link => console.log(link));
    console.log('Всего ссылок:', uniqueProductLinks.length);

    const textToCopy = uniqueProductLinks.join('\n');
    copyToClipboard(textToCopy);
}

// Запускаем с небольшой задержкой (5 секунд), чтобы вы могли вернуться на вкладку
console.log('Перейдите на вкладку страницы, скрипт сработает через 5 секунд...');
setTimeout(extractLinks, 5000);
