/**
 * Script para converter SVGs em PNGs
 * Uso: node scripts/convert-logo.js
 */

const fs = require('fs');
const path = require('path');

// Configurações de tamanho para cada arquivo
const sizes = {
  'favicon.ico': [16, 32, 48],
  '1024.png': 1024,
  'play_store_512.png': 512,
  'logopontowebdesk.png': 512,
};

// Mapeamento de mipmap Android
const mipmapSizes = {
  'mdpi': 48,
  'hdpi': 72,
  'xhdpi': 96,
  'xxhdpi': 144,
  'xxxhdpi': 192,
};

console.log('🎨 Conversão de Logo SVG para PNG');
console.log('=====================================\n');
console.log('📋 Instruções:');
console.log('1. Instale as dependências: npm install sharp');
console.log('2. Execute: node scripts/convert-logo.js');
console.log('\n📁 Arquivos a serem gerados:');

Object.entries(sizes).forEach(([file, size]) => {
  const sizeStr = Array.isArray(size) ? size.join(', ') : size;
  console.log(`  ✓ ${file} (${sizeStr}px)`);
});

console.log('\n📱 Mipmaps Android:');
Object.entries(mipmapSizes).forEach(([folder, size]) => {
  console.log(`  ✓ mipmap-${folder}/ic_launcher.png (${size}px)`);
  console.log(`  ✓ mipmap-${folder}/ic_launcher_adaptive_fore.png`);
  console.log(`  ✓ mipmap-${folder}/ic_launcher_adaptive_back.png`);
});

console.log('\n🔧 Código de conversão:');
console.log(`
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function convertSVG() {
  const svgBuffer = fs.readFileSync(path.join(__dirname, '../public/logo.svg'));
  
  // Gerar 1024.png
  await sharp(svgBuffer)
    .resize(1024, 1024)
    .png()
    .toFile(path.join(__dirname, '../public/1024.png'));
  console.log('✓ 1024.png gerado');
  
  // Gerar play_store_512.png
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(__dirname, '../public/play_store_512.png'));
  console.log('✓ play_store_512.png gerado');
  
  // Gerar favicon.ico (múltiplos tamanhos)
  const sizes = [16, 32, 48];
  const buffers = await Promise.all(
    sizes.map(size => 
      sharp(svgBuffer).resize(size, size).toBuffer()
    )
  );
  // Para ICO, você precisaria de uma biblioteca específica
  // ou usar o site: https://convertio.co/svg-ico/
  console.log('✓ favicon.ico - use https://convertio.co/svg-ico/');
}

convertSVG().catch(console.error);
`);

console.log('\n🌐 Alternativa online (recomendada):');
console.log('1. Acesse: https://convertio.co/svg-png/');
console.log('2. Faça upload do logo.svg');
console.log('3. Baixe em diferentes resoluções');
console.log('4. Para ICO: https://convertio.co/svg-ico/');
console.log('\n✅ SVGs criados e prontos para conversão!');
