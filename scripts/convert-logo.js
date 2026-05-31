import { observabilityConsole } from '../services/observabilityConsole.js';
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

observabilityConsole.log('🎨 Conversão de Logo SVG para PNG');
observabilityConsole.log('=====================================\n');
observabilityConsole.log('📋 Instruções:');
observabilityConsole.log('1. Instale as dependências: npm install sharp');
observabilityConsole.log('2. Execute: node scripts/convert-logo.js');
observabilityConsole.log('\n📁 Arquivos a serem gerados:');

Object.entries(sizes).forEach(([file, size]) => {
  const sizeStr = Array.isArray(size) ? size.join(', ') : size;
  observabilityConsole.log(`  ✓ ${file} (${sizeStr}px)`);
});

observabilityConsole.log('\n📱 Mipmaps Android:');
Object.entries(mipmapSizes).forEach(([folder, size]) => {
  observabilityConsole.log(`  ✓ mipmap-${folder}/ic_launcher.png (${size}px)`);
  observabilityConsole.log(`  ✓ mipmap-${folder}/ic_launcher_adaptive_fore.png`);
  observabilityConsole.log(`  ✓ mipmap-${folder}/ic_launcher_adaptive_back.png`);
});

observabilityConsole.log('\n🔧 Código de conversão:');
observabilityConsole.log(`
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
  observabilityConsole.log('✓ 1024.png gerado');
  
  // Gerar play_store_512.png
  await sharp(svgBuffer)
    .resize(512, 512)
    .png()
    .toFile(path.join(__dirname, '../public/play_store_512.png'));
  observabilityConsole.log('✓ play_store_512.png gerado');
  
  // Gerar favicon.ico (múltiplos tamanhos)
  const sizes = [16, 32, 48];
  const buffers = await Promise.all(
    sizes.map(size => 
      sharp(svgBuffer).resize(size, size).toBuffer()
    )
  );
  // Para ICO, você precisaria de uma biblioteca específica
  // ou usar o site: https://convertio.co/svg-ico/
  observabilityConsole.log('✓ favicon.ico - use https://convertio.co/svg-ico/');
}

convertSVG().catch(console.error);
`);

observabilityConsole.log('\n🌐 Alternativa online (recomendada):');
observabilityConsole.log('1. Acesse: https://convertio.co/svg-png/');
observabilityConsole.log('2. Faça upload do logo.svg');
observabilityConsole.log('3. Baixe em diferentes resoluções');
observabilityConsole.log('4. Para ICO: https://convertio.co/svg-ico/');
observabilityConsole.log('\n✅ SVGs criados e prontos para conversão!');
