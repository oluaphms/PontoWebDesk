const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const PUBLIC_DIR = path.join(__dirname, '../public');

async function generateFavicon() {
  console.log('🎯 Gerando favicon.png\n');
  
  const svgBuffer = fs.readFileSync(path.join(PUBLIC_DIR, 'favicon.svg'));
  
  // Gerar favicon.png (32x32 é o tamanho padrão)
  await sharp(svgBuffer)
    .resize(32, 32)
    .png()
    .toFile(path.join(PUBLIC_DIR, 'favicon.png'));
  console.log('✓ favicon.png gerado (32px)');
  
  console.log('\n🌐 Para gerar favicon.ico (multi-resolução):');
  console.log('   1. Acesse: https://convertio.co/svg-ico/');
  console.log('   2. Faça upload do favicon.svg');
  console.log('   3. Selecione tamanhos: 16, 32, 48px');
  console.log('   4. Baixe e substitua o favicon.ico na pasta public/');
  
  console.log('\n✅ favicon.png criado!');
}

generateFavicon().catch(err => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
