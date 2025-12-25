function randomInRange(min, max) {
    return Math.round(Math.random() * (max - min) / 10) * 10 + min;
}

function generateRandomSku() {
    const length = Math.floor(Math.random() * 4) + 6;
    var sku = '';
    for (var i = 0; i < length; i++) {
        sku += Math.floor(Math.random() * 10); // добавляем случайную цифру
    }

    sku = sku.replace(/\d/g, match => {
        const random = Math.random();
        if (random < 0.6) {
            return Math.floor(Math.random() * 10);
        } else if (random < 0.8) {
            return String.fromCharCode(Math.floor(Math.random() * 26) + 65); // заглавная буква
        } else {
            return String.fromCharCode(Math.floor(Math.random() * 26) + 97); // строчная буква
        }
    });

    if (Math.random() < 0.25 && sku.length > 2) {
        const index = Math.floor(Math.random() * (sku.length - 2)) + 1;
        sku = sku.slice(0, index) + '-' + sku.slice(index);
    }
    return sku.toUpperCase(); // возвращаем сгенерированный SKU
}

function findClass(className, context) {
    var elements = [];
    var context = context || document;
    var allElements = context.getElementsByTagName("div");
    for (var i = 0; i < allElements.length; i++) {
        if (allElements[i].className.indexOf(className) != -1) {
            elements.push(allElements[i]);
        }
    }
    return elements;
}

try {
    let el = findClass("slide_main");
    console.log(el);
    let inputs = el[0].getElementsByTagName("input");

    let inputs2 = [];
    for (let i = 0; i < inputs.length; i++) {
        if (inputs[i].id.indexOf("form-input") != -1) {
            inputs2.push(inputs[i]);
        }
    }

    for (let i = 0; i < inputs2.length; i++) {
        let parent = inputs2[i].parentNode.parentNode.parentNode;
        let label = parent.querySelectorAll("label");

        if (label.length > 0) {
            let text = label[0].textContent;

            if (text.indexOf("Цена") != -1) {
                inputs2[i].click();
                let event = new Event('input', { bubbles: true });
                inputs2[i].value = randomInRange(3000, 3900);
                inputs2[i].dispatchEvent(event);
            }

            if (text.indexOf("Артикул") != -1) {
                inputs2[i].click();
                let event = new Event('input', { bubbles: true });
                inputs2[i].value = generateRandomSku();
                inputs2[i].dispatchEvent(event);
            }
        }
    }
} catch (error) {
    console.log(error);
}
