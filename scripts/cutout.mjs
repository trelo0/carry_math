// Одноразовый скрипт: вырезает белый фон у фото наставника
// (флуд-филл от краёв) и растушёвывает кромку, чтобы не было видно обрезки.
import sharp from 'sharp';

const src = process.argv[2];
const dst = process.argv[3];

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width, height } = info;
const total = width * height;
const visited = new Uint8Array(total);
const stack = [];

const isWhite = (i) => {
  const o = i * 4;
  return data[o] > 235 && data[o + 1] > 235 && data[o + 2] > 235;
};

const lum = (i) => {
  const o = i * 4;
  return 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
};

for (let x = 0; x < width; x++) {
  stack.push(x, (height - 1) * width + x);
}
for (let y = 0; y < height; y++) {
  stack.push(y * width, y * width + width - 1);
}

while (stack.length) {
  const i = stack.pop();
  if (visited[i] || !isWhite(i)) continue;
  visited[i] = 1;
  const x = i % width;
  const y = (i / width) | 0;
  if (x > 0) stack.push(i - 1);
  if (x < width - 1) stack.push(i + 1);
  if (y > 0) stack.push(i - width);
  if (y < height - 1) stack.push(i + width);
}

for (let i = 0; i < total; i++) {
  if (visited[i]) data[i * 4 + 3] = 0;
}

// сглаживание силуэта: две passes box-блюра 3x3 по альфа-каналу + уплотнение кромки
const alpha = Buffer.alloc(total);
for (let i = 0; i < total; i++) alpha[i] = data[i * 4 + 3];

let srcBuf = alpha;
let dstBuf = Buffer.alloc(total);
for (let pass = 0; pass < 2; pass++) {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let sum = 0;
      let cnt = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          sum += srcBuf[ny * width + nx];
          cnt++;
        }
      }
      dstBuf[y * width + x] = Math.round(sum / cnt);
    }
  }
  const tmp = srcBuf;
  srcBuf = dstBuf;
  dstBuf = tmp;
}
const smoothed = srcBuf;

for (let i = 0; i < total; i++) {
  const a = smoothed[i];
  data[i * 4 + 3] = a < 60 ? 0 : Math.min(255, Math.round((a - 60) * 1.5));
}

await sharp(Buffer.from(data), { raw: { width, height, channels: 4 } })
  .png()
  .toFile(dst);

console.log('cutout done:', width, 'x', height, '->', dst);
