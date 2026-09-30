// Генерує іконки PWA (public/icons) з одного SVG-малюнка: дві карти на зеленому сукні.
// Запуск: node scripts/icons.mjs (потрібен Chromium з Playwright: pnpm e2e:install).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const out = join(import.meta.dirname, '../public/icons');

const SPADE =
  'M50 4C50 4 8 38 8 62c0 17 18 26 34 15-2 10-6 16-13 19h42c-7-3-11-9-13-19 16 11 34 2 34-15C92 38 50 4 50 4z';
const HEART =
  'M50 92C20 66 4 50 4 31 4 16 16 6 29 6c10 0 17 6 21 14 4-8 11-14 21-14 13 0 25 10 25 25 0 19-16 35-46 61z';

/** Малюнок у квадраті 512×512; `inset` — поле від краю (для маскувальної іконки). */
function drawing(inset) {
  const scale = (512 - 2 * inset) / 512;
  return `<g transform="translate(${inset} ${inset}) scale(${scale})">
    <g transform="rotate(-12 256 280)">
      <rect x="96" y="104" width="220" height="308" rx="24" fill="#ffffff" stroke="#0b3d26" stroke-width="6"/>
      <path d="${HEART}" transform="translate(146 196) scale(1.2)" fill="#c62828"/>
    </g>
    <g transform="rotate(10 256 280)">
      <rect x="196" y="112" width="220" height="308" rx="24" fill="#ffffff" stroke="#0b3d26" stroke-width="6"/>
      <path d="${SPADE}" transform="translate(246 206) scale(1.2)" fill="#1b1b1b"/>
    </g>
  </g>`;
}

function svg({ rounded, inset }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="#0f5132"/>
  ${drawing(inset)}
</svg>
`;
}

const icon = svg({ rounded: true, inset: 0 });
const maskable = svg({ rounded: false, inset: 64 });
const apple = svg({ rounded: false, inset: 24 });
writeFileSync(join(out, 'icon.svg'), icon);

const browser = await chromium.launch();
const page = await browser.newPage();
async function png(source, size, name) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${source}`,
  );
  await page.screenshot({ path: join(out, name), omitBackground: true });
}
await png(icon, 192, 'icon-192.png');
await png(icon, 512, 'icon-512.png');
await png(maskable, 512, 'maskable-512.png');
await png(apple, 180, 'apple-touch-icon.png');
await browser.close();
