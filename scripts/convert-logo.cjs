/**
 * Script para converter SVGs em PNGs
 * Uso: node scripts/convert-logo.cjs
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '../public');
const RES_DIR = path.join(PUBLIC_DIR, 'res');

// Configurações de tamanho
const sizes = {
  '1024.png': 1024,
  'play_store_512.png': 512,
  'logopontowebdesk.png': 512,
};

// Mipmap Android
const mipmapSizes = {
  'mdpi': 48,
  'hdpi': 72,
  'xhdpi': 96,
  'xxhdpi': 144,
  'xxxhdpi': 192,
};

async function convertSVG() {
  console.log('🎨 Iniciando conversão de Logo SVG para PNG\n');
  
  const svgBuffer = fs.readFileSync(path.join(PUBLIC_DIR, 'logo.svg'));
  
  // Gerar PNGs principais
  for (const [filename, size] of Object.entries(sizes)) {
    const outputPath = path.join(PUBLIC_DIR, filename);
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(outputPath);
    console.log(`✓ ${filename} gerado (${size}px)`);
  }
  
  // Gerar mipmaps Android
  for (const [folder, size] of Object.entries(mipmapSizes)) {
    const mipmapDir = path.join(RES_DIR, `mipmap-${folder}`);
    
    // Criar diretório se não existir
    if (!fs.existsSync(mipmapDir)) {
      fs.mkdirSync(mipmapDir, { recursive: true });
    }
    
    // ic_launcher.png
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(mipmapDir, 'ic_launcher.png'));
    
    // ic_launcher_adaptive_fore.png (mesmo tamanho)
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(mipmapDir, 'ic_launcher_adaptive_fore.png'));
    
    console.log(`✓ mipmap-${folder}/ (${size}px)`);
  }
  
  console.log('\n🌐 Para gerar favicon.ico:');
  console.log('   Acesse: https://convertio.co/svg-ico/');
  console.log('   Faça upload do favicon.svg');
  console.log('   Baixe o favicon.ico com tamanhos: 16, 32, 48px');
  
  console.log('\n✅ Conversão concluída!');
}

convertSVG().catch(err => {
  console.error('❌ Erro na conversão:', err);
  process.exit(1);
});
