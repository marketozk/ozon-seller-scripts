/**
 * Bridge Server - мост между VS Code и браузерным расширением
 * Запуск: node bridge_server.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 9876;

// Очередь команд для расширения
let commandQueue = [];
let lastResult = null;

const server = http.createServer((req, res) => {
    // CORS для расширения
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);
    
    // === ENDPOINT: Расширение забирает команду ===
    if (url.pathname === '/poll' && req.method === 'GET') {
        if (commandQueue.length > 0) {
            const cmd = commandQueue.shift();
            console.log(`📤 Отправляю команду: ${cmd.action}`);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(cmd));
        } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ action: 'none' }));
        }
        return;
    }
    
    // === ENDPOINT: Расширение отправляет результат ===
    if (url.pathname === '/result' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                lastResult = JSON.parse(body);
                console.log(`📥 Получен результат: ${lastResult.type}`);
                
                // Сохраняем скриншот если есть
                if (lastResult.type === 'screenshot' && lastResult.data) {
                    const base64Data = lastResult.data.replace(/^data:image\/\w+;base64,/, '');
                    const filePath = path.join(__dirname, 'screenshot.png');
                    fs.writeFileSync(filePath, base64Data, 'base64');
                    console.log(`📸 Скриншот сохранён: ${filePath}`);
                }
                
                // Сохраняем результат в файл
                fs.writeFileSync(
                    path.join(__dirname, 'last_result.json'), 
                    JSON.stringify(lastResult, null, 2)
                );
                
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }
    
    // === ENDPOINT: Добавить команду (от терминала) ===
    if (url.pathname === '/command' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            try {
                const cmd = JSON.parse(body);
                commandQueue.push(cmd);
                console.log(`➕ Добавлена команда: ${cmd.action}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ queued: true, position: commandQueue.length }));
            } catch (e) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: e.message }));
            }
        });
        return;
    }
    
    // === ENDPOINT: Получить последний результат ===
    if (url.pathname === '/last-result' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(lastResult || { type: 'none' }));
        return;
    }
    
    // === ENDPOINT: Статус ===
    if (url.pathname === '/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ 
            running: true, 
            queueLength: commandQueue.length,
            hasResult: lastResult !== null 
        }));
        return;
    }
    
    // Неизвестный endpoint
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, () => {
    console.log(`\n🌉 Bridge Server запущен на http://localhost:${PORT}`);
    console.log(`\n📋 Доступные команды:`);
    console.log(`   POST /command - добавить команду`);
    console.log(`   GET  /poll    - расширение забирает команду`);
    console.log(`   POST /result  - расширение отправляет результат`);
    console.log(`   GET  /last-result - получить последний результат`);
    console.log(`   GET  /status  - статус сервера\n`);
    console.log(`📌 Примеры команд:`);
    console.log(`   {"action": "screenshot"}`);
    console.log(`   {"action": "get_dom"}`);
    console.log(`   {"action": "click", "selector": "button.submit"}`);
    console.log(`   {"action": "execute_js", "code": "document.title"}`);
    console.log(`   {"action": "type", "selector": "input", "text": "hello"}\n`);
});
