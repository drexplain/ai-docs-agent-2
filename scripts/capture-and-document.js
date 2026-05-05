// scripts/capture-and-document.js
const { chromium } = require('playwright');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');

// Список CSS-селекторов для значимых элементов интерфейса
const SIGNIFICANT_SELECTORS = [
  'button',
  'input',
  'a',
  'textarea',
  'select',
  'h1',
  'h2',
  'h3'
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

  // Фиксируем размер viewport, чтобы скриншот и SVG совпадали
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(url, { waitUntil: 'networkidle' });

  const screenshotBuffer = await page.screenshot({ fullPage: false });
  const outputDir = path.join(__dirname, '..', 'output', 'screenshots');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, '01-main.png'), screenshotBuffer);

  // Находим элементы и их координаты
  const elements = await page.$$eval(SIGNIFICANT_SELECTORS, els =>
    els.map(el => {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 60),
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        visible: rect.width > 0 && rect.height > 0
      };
    }).filter(el => el.visible)
  );

  const items = elements.slice(0, 15);
  console.log(`Найдено ${items.length} значимых элементов`);

  // Размеры скриншота (viewport)
  const width = 1280;
  const height = 720;

  // Генерируем SVG с аннотациями
  const overlaySVG = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${items.map((el, i) => {
        const pad = 7;                         // отступ рамки от элемента
        const rectX = el.x - pad;
        const rectY = el.y - pad;
        const rectW = el.width + 2 * pad;
        const rectH = el.height + 2 * pad;
        const circleX = rectX;                  // кружок в левом верхнем углу рамки
        const circleY = rectY;
        const circleRadius = 12;
        return `
          <rect x="${rectX}" y="${rectY}" width="${rectW}" height="${rectH}"
                fill="none" stroke="red" stroke-width="2" />
          <circle cx="${circleX}" cy="${circleY}" r="${circleRadius}" fill="red" />
          <text x="${circleX}" y="${circleY + 4}" font-size="12" fill="white"
                text-anchor="middle" font-family="Arial">${i + 1}</text>
        `;
      }).join('')}
    </svg>`;

  if (items.length > 0) {
    // Конвертируем SVG в PNG и накладываем на скриншот
    const svgBuffer = Buffer.from(overlaySVG);
    const overlayPNG = await sharp(svgBuffer, { density: 300 })
      .resize(width, height)
      .png()
      .toBuffer();

    await sharp(screenshotBuffer)
      .composite([{ input: overlayPNG, top: 0, left: 0 }])
      .toFile(path.join(outputDir, '01-main-annotated.png'));

    console.log('Аннотированный скриншот сохранён');
  } else {
    // Если элементов нет, просто копируем чистый скриншот
    fs.copyFileSync(
      path.join(outputDir, '01-main.png'),
      path.join(outputDir, '01-main-annotated.png')
    );
    console.log('Элементы не найдены, сохранён скриншот без аннотаций');
  }

  await browser.close();

  // Handlebars-шаблон документации
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
