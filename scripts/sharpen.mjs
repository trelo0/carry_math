// Одноразовая утилита: лёгкий unsharp-mask, возвращает резкость
// апскейлнутому фото наставника. Использование: node scripts/sharpen.mjs <file> [sigma]
import sharp from 'sharp';
import { renameSync } from 'fs';

const file = process.argv[2];
const sigma = Number(process.argv[3] || 1.2);

const tmp = `${file}.tmp.png`;
await sharp(file)
  .sharpen({ sigma, m1: 0.8, m2: 1.6, x1: 2, y2: 8, y3: 16 })
  .png()
  .toFile(tmp);

renameSync(tmp, file);
console.log('sharpened:', file, 'sigma', sigma);
