import { Command } from "commander";
import http from "node:http";
import path from "node:path";
import { once } from "node:events";
import { buffer } from "node:stream/consumers";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import superagent from "superagent";

// Сайт, звідки беремо картинки (до адреси додається код, наприклад /404)
const SOURCE_URL = "https://http.cat/";

// Параметри командного рядка
const program = new Command();

program
  .helpOption("--help", "показати довідку") // -h потрібен для --host
  .requiredOption("-h, --host <address>", "адреса сервера")
  .requiredOption("-p, --port <number>", "порт сервера")
  .requiredOption("-c, --cache <path>", "тека для кешованих картинок");

program.parse();
const options = program.opts();

// Порт приходить рядком, тому перетворюємо його в число і перевіряємо
const port = Number(options.port);
if (options.port.trim() === "" || !Number.isInteger(port) || port < 0 || port > 65535) {
  console.error("Помилка: порт має бути цілим числом від 0 до 65535");
  process.exit(1);
}

// Тека кешу: якщо її немає, створюємо 
try {
  await mkdir(options.cache, { recursive: true });
} catch (error) {
  console.error("Помилка: не вдалося створити теку кешу: " + error.message);
  process.exit(1);
}

// Обробник запиту - єдина функція зі словом async, яка передається в createServer
const server = http.createServer(async (req, res) => {
  console.log(req.method + " " + req.url);
  try {
    await handleRequest(req, res);
  } catch (error) {
    // Будь-яка несподівана помилка не повинна зупиняти сервер
    if (!res.headersSent) {
      sendText(res, 500, "Внутрішня помилка сервера");
    }
  }
});

server.listen(port, options.host);
try {
  await once(server, "listening"); // чекаємо, поки сервер запуститься
} catch (error) {
  console.error("Помилка: не вдалося запустити сервер: " + error.message);
  process.exit(1);
}
console.log("Сервер запущено: http://" + options.host + ":" + port + "/");
console.log("Кеш зберігається в теці: " + path.resolve(options.cache));

// Обробка запиту
async function handleRequest(req, res) {
  // Дозволені лише три методи
  if (req.method !== "GET" && req.method !== "PUT" && req.method !== "DELETE") {
    res.writeHead(405, {
      "Content-Type": "text/plain; charset=utf-8",
      "Allow": "GET, PUT, DELETE",
    });
    res.end("Метод не дозволений. Дозволені методи: GET, PUT, DELETE");
    return;
  }

  // Код стану беремо зі шляху, наприклад /404 дає "404"
  const code = getCode(req.url);
  if (code === null) {
    sendText(res, 404, "Некоректний шлях. Очікується /<код з трьох цифр>, наприклад /404");
    return;
  }
  const filePath = path.join(options.cache, code + ".jpg");

  if (req.method === "GET") {
    await handleGet(res, code, filePath);
  } else if (req.method === "PUT") {
    await handlePut(req, res, filePath);
  } else {
    await handleDelete(res, filePath);
  }
}

// GET 
async function handleGet(res, code, filePath) {
  // Спершу шукаємо в кеші
  try {
    const image = await readFile(filePath);
    sendImage(res, image, "cache");
    return;
  } catch (error) {
    if (error.code !== "ENOENT") {
      sendText(res, 500, "Не вдалося прочитати файл з кешу");
      return;
    }
    // ENOENT означає, що файлу немає: йдемо на http.cat
  }

  // У кеші немає: запитуємо http.cat
  let image;
  try {
    const response = await superagent.get(SOURCE_URL + code);
    image = response.body;
  } catch (error) {
    if (error.status) {
      sendText(res, 404, "Картинку для цього коду не знайдено на http.cat");
    } else {
      sendText(res, 404, "Не вдалося отримати картинку з http.cat");
    }
    return;
  }

  // Спочатку зберігаємо в кеш, потім відповідаємо
  try {
    await writeFile(filePath, image);
  } catch (error) {
    sendText(res, 500, "Не вдалося записати картинку в кеш");
    return;
  }
  sendImage(res, image, "http.cat");
}

// PUT
async function handlePut(req, res, filePath) {
  sendText(res, 501, "PUT ще не реалізовано");
}

// DELETE
async function handleDelete(res, filePath) {
  sendText(res, 501, "DELETE ще не реалізовано");
}

// Бере код зі шляху: "/404" дає "404", а "/abc" або "/../x" дає null
function getCode(url) {
  const pathname = url.split("?")[0];
  const match = /^\/(\d{3})$/.exec(pathname);
  if (match === null) {
    return null;
  }
  return match[1];
}

// Відповідь з текстом
function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

// Відповідь з картинкою; заголовок X-Image-Source показує, звідки вона
function sendImage(res, image, source) {
  res.writeHead(200, {
    "Content-Type": "image/jpeg",
    "Content-Length": image.length,
    "X-Image-Source": source,
  });
  res.end(image);
}