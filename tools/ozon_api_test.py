"""
Тест API Ozon Seller через Playwright (headless браузер).
Обходит антибот, так как использует реальный браузер.

Установка:
    pip install playwright
    playwright install chromium
"""

import asyncio
import json
from playwright.async_api import async_playwright


async def test_ozon_api():
    """Тестируем API через реальный браузер"""
    
    async with async_playwright() as p:
        # Запускаем браузер (headless=False для отладки)
        browser = await p.chromium.launch(headless=False)
        
        # Создаём контекст с сохранением состояния
        context = await browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
        )
        
        page = await context.new_page()
        
        print("1. Открываем seller.ozon.ru...")
        await page.goto("https://seller.ozon.ru/")
        
        # Ждём загрузки страницы
        await page.wait_for_load_state("networkidle")
        
        print("2. Проверяем авторизацию...")
        
        # Проверяем, есть ли форма логина или уже авторизованы
        is_logged_in = await page.evaluate("""
            () => {
                return document.cookie.includes('sc_company_id');
            }
        """)
        
        if not is_logged_in:
            print("❌ Не авторизован! Нужно войти в аккаунт вручную.")
            print("   Авторизуйся в браузере и запусти скрипт снова.")
            
            # Ждём 60 секунд для ручной авторизации
            print("   Ожидание 60 секунд для авторизации...")
            await asyncio.sleep(60)
        
        print("3. Делаем API запрос через браузер...")
        
        # Выполняем запрос через fetch в контексте страницы
        result = await page.evaluate("""
            async () => {
                const companyId = document.cookie
                    .split('; ')
                    .find(c => c.startsWith('sc_company_id='))
                    ?.split('=')[1];
                
                if (!companyId) {
                    return { error: 'Company ID not found' };
                }
                
                try {
                    const response = await fetch('/api/v2/company/finance-info', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'x-o3-app-name': 'seller-ui',
                            'x-o3-language': 'ru',
                            'x-o3-company-id': companyId
                        },
                        body: JSON.stringify({ company_id: companyId })
                    });
                    
                    const data = await response.json();
                    return {
                        status: response.status,
                        data: data
                    };
                } catch (e) {
                    return { error: e.message };
                }
            }
        """)
        
        print("\n=== РЕЗУЛЬТАТ ===")
        print(json.dumps(result, indent=2, ensure_ascii=False))
        
        # Сохраняем cookies для повторного использования
        cookies = await context.cookies()
        with open("ozon_cookies.json", "w", encoding="utf-8") as f:
            json.dump(cookies, f, indent=2, ensure_ascii=False)
        print("\n✓ Cookies сохранены в ozon_cookies.json")
        
        # Получаем rfuid для анализа
        rfuid = await page.evaluate("""
            () => {
                const cookie = document.cookie
                    .split('; ')
                    .find(c => c.startsWith('rfuid='));
                return cookie ? cookie.split('=')[1] : null;
            }
        """)
        
        if rfuid:
            print(f"\n✓ rfuid токен: {rfuid[:100]}...")
        
        await browser.close()


if __name__ == "__main__":
    asyncio.run(test_ozon_api())
