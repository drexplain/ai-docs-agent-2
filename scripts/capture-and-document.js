// scripts/capture-and-document.js
const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

// Список CSS-селекторов, которые считаем важными элементами интерфейса.
// При необходимости добавьте сюда свои: 'table', 'img', 'nav a' и т.п.
const SIGNIFICANT_SELECTORS = [
  'button', 'input', 'a', 'textarea',
  'select', 'h1', 'h2', 'h3'
].join(',');

(async () => {
  const url = process.argv[2];
  if (!url) {
    console.error('Укажите URL: node capture-and-document.js https://example.com');
    process.exit(1);
  }

  console.log(`Открываю страницу: ${url}`);
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });

  // Делаем скриншот всей страницы
  const screenshotBuffer = await page.screenshot({ fullPage: false });
  const outputDir = path.join(__dirname, '..', 'output', 'screenshots');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, '01-main.png'), screenshotBuffer);

  // Находим все элементы, соответствующие селекторам, и получаем их координаты
  const elements = await page.$$eval(SIGNIFICANT_SELECTORS, els =>
    els.map(el => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 60),
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        visible: rect.width > 0 && rect.height > 0
      };
    }).filter(el => el.visible)
  );

  // Оставляем только первые 15 подходящих элементов
  const items = elements.slice(0, 15);
  console.log(`Найдено ${items.length} значимых элементов`);

  // Готовим SVG-разметку с прямоугольниками и номерами
  if (items.length > 0) {
    const overlaySVG = `
      <svg width="${screenshotBuffer.width}" height="${screenshotBuffer.height}">
        ${items.map((el, i) => `
          <rect x="${el.x}" y="${el.y}" width="${el.width}" height="${el.height}"
                fill="none" stroke="red" stroke-width="2" />
          <text x="${el.x + 2}" y="${el.y + 14}" font-size="14" fill="red">${i + 1}</text>
        `).join('')}
      </svg>`;

    // Накладываем аннотации на скриншот с помощью sharp
    await sharp(screenshotBuffer)
      .composite([{ input: Buffer.from(overlaySVG), top: 0, left: 0 }])
      .toFile(path.join(outputDir, '01-main-annotated.png'));
  }

  await browser.close();

  // Заполняем Handlebars-шаблон для будущей документации
  const templateSource = `
# Документация к странице {{url}}

![Аннотированный интерфейс](screenshots/01-main-annotated.png)

## Элементы интерфейса

{{#each elements}}
- **{{inc @index}}. {{tag}}** — {{text}}
{{/each}}
`;
  const template = Handlebars.compile(templateSource);
  Handlebars.registerHelper('inc', (value) => parseInt(value) + 1);

  const md = template({
    url: url,
    elements: items.map(el => ({ tag: el.tag, text: el.text || 'нет текста' }))
  });

  fs.writeFileSync(path.join(__dirname, '..', 'output', 'README.md'), md);
  console.log('Документация сохранена в output/README.md');
})();
