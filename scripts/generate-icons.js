const sharp = require('sharp');
const png2icons = require('png2icons');
const fs = require('fs');
const path = require('path');

const resourcesDir = path.join(__dirname, '../resources');
const svgPath = path.join(resourcesDir, 'icon.svg');
const pngPath = path.join(resourcesDir, 'icon.png');
const icoPath = path.join(resourcesDir, 'icon.ico');
const icnsPath = path.join(resourcesDir, 'icon.icns');

(async () => {
    try {
        console.log('🔄 Loading SVG...');
        if (!fs.existsSync(svgPath)) {
            throw new Error('resources/icon.svg not found!');
        }

        // 1. SVG -> PNG (1024x1024)
        console.log('✨ Converting SVG to High-Res PNG (1024x1024)...');
        await sharp(svgPath)
            .resize(1024, 1024)
            .png()
            .toFile(pngPath);
        
        const pngBuffer = fs.readFileSync(pngPath);

        // 2. PNG -> ICNS (Mac)
        console.log('🍎 Generating ICNS (Mac)...');
        // createICNS(buffer, scalingAlgorithm, 0=auto)
        const icnsBuffer = png2icons.createICNS(pngBuffer, png2icons.BILINEAR, 0);
        if (icnsBuffer) {
            fs.writeFileSync(icnsPath, icnsBuffer);
            console.log('   ✅ icon.icns created');
        } else {
            console.error('   ❌ Failed to create ICNS');
        }

        // 3. PNG -> ICO (Windows)
        console.log('🪟 Generating ICO (Windows)...');
        // createICO(buffer, scalingAlgorithm, 0=auto, false=no compression)
        const icoBuffer = png2icons.createICO(pngBuffer, png2icons.BILINEAR, 0, false);
        if (icoBuffer) {
            fs.writeFileSync(icoPath, icoBuffer);
            console.log('   ✅ icon.ico created');
        } else {
            console.error('   ❌ Failed to create ICO');
        }

        console.log('\n🎉 All icons generated successfully in /resources!');

    } catch (error) {
        console.error('\n❌ Error generating icons:', error);
    }
})();
