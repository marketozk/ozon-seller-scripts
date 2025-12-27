---
name: gologin-automation
description: Автоматизация с GoLogin и Playwright - управление профилями, прокси, антидетект браузер, регистрация аккаунтов. Используй для задач с мультиаккаунтами и автоматизацией браузера.
---

# GoLogin + Playwright Automation

## Подключение к GoLogin

```python
import requests
from playwright.async_api import async_playwright

GOLOGIN_API = "https://api.gologin.com"
TOKEN = "your_token"

async def start_profile(profile_id: str) -> dict:
    """Запуск профиля GoLogin"""
    response = requests.get(
        f"{GOLOGIN_API}/browser/{profile_id}/start",
        headers={"Authorization": f"Bearer {TOKEN}"}
    )
    return response.json()  # { "wsUrl": "ws://...", "port": 12345 }
```

## Подключение Playwright к профилю

```python
async def connect_to_profile(profile_id: str):
    profile_data = await start_profile(profile_id)
    
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(
            f"ws://127.0.0.1:{profile_data['port']}/devtools/browser/{profile_data['wsUrl']}"
        )
        
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else await context.new_page()
        
        return browser, page
```

## Управление прокси

```python
async def update_proxy(profile_id: str, proxy: dict):
    """Обновление прокси в профиле"""
    response = requests.patch(
        f"{GOLOGIN_API}/browser/{profile_id}",
        headers={
            "Authorization": f"Bearer {TOKEN}",
            "Content-Type": "application/json"
        },
        json={
            "proxy": {
                "mode": "http",
                "host": proxy["host"],
                "port": proxy["port"],
                "username": proxy.get("username"),
                "password": proxy.get("password")
            }
        }
    )
    return response.json()
```

## Работа с Mango (SMS сервис)

```python
import aiohttp

MANGO_API = "https://api.mango-office.ru"

async def get_phone_number(country: str = "ru") -> dict:
    """Получение номера для SMS"""
    async with aiohttp.ClientSession() as session:
        async with session.get(
            f"{MANGO_API}/number/get",
            params={"country": country, "service": "ozon"}
        ) as resp:
            return await resp.json()

async def get_sms_code(number_id: str, timeout: int = 120) -> str:
    """Ожидание SMS кода"""
    import asyncio
    
    for _ in range(timeout // 5):
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{MANGO_API}/sms/get/{number_id}") as resp:
                data = await resp.json()
                if data.get("code"):
                    return data["code"]
        await asyncio.sleep(5)
    
    raise TimeoutError("SMS не получен")
```

## Паттерны автоматизации

### Ожидание элементов
```python
async def safe_click(page, selector: str, timeout: int = 10000):
    """Безопасный клик с ожиданием"""
    try:
        await page.wait_for_selector(selector, timeout=timeout)
        await page.click(selector)
        return True
    except Exception as e:
        print(f"Ошибка клика {selector}: {e}")
        return False
```

### Заполнение форм
```python
async def fill_form(page, fields: dict):
    """Заполнение формы по селекторам"""
    for selector, value in fields.items():
        await page.fill(selector, value)
        await page.wait_for_timeout(100)  # Имитация человека
```

### Скриншоты при ошибках
```python
import os
from datetime import datetime

async def screenshot_on_error(page, error_name: str):
    """Сохранение скриншота при ошибке"""
    os.makedirs("screenshots", exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = f"screenshots/{error_name}_{timestamp}.png"
    await page.screenshot(path=path)
    return path
```

## Структура проекта

```
ozon-mass-register-gologin-py/
├── src/
│   └── ozon_mass_register_gologin/
│       ├── infra/
│       │   ├── browser/
│       │   │   └── gologin_provider.py
│       │   └── sms/
│       │       └── mango_provider.py
│       ├── usecases/
│       │   └── register_buyer.py
│       └── domain/
│           └── models.py
├── logs/
├── screenshots/
└── requirements.txt
```

## Логирование

```python
import logging
import json
from datetime import datetime

def setup_logger(profile_id: str):
    logger = logging.getLogger(profile_id)
    
    # JSON логи для анализа
    handler = logging.FileHandler(f"logs/run-{profile_id}.jsonl")
    handler.setFormatter(logging.Formatter('%(message)s'))
    
    logger.addHandler(handler)
    return logger

def log_step(logger, step: str, data: dict = None):
    logger.info(json.dumps({
        "timestamp": datetime.now().isoformat(),
        "step": step,
        "data": data or {}
    }))
```
