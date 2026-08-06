import sharp from 'sharp';

const src = 'public/icon.png';
const dst = 'public/icon-alpha.png';

const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

for (let i = 0; i < data.length; i += 4) {
  // source PNG already carries alpha; keep it and normalize RGB to black
  // so the mask shape is pure alpha-driven
  const a = data[i + 3];
  data[i] = 0;
  data[i + 1] = 0;
  data[i + 2] = 0;
  data[i + 3] = a;
}

await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
  .png()
  .toFile(dst);

console.log('icon-alpha.png written:', info.width, 'x', info.height);
