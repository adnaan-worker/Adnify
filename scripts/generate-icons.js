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
        const iconNames = ['icon', 'dawn_icon'];

        for (const name of iconNames) {
            console.log(`\n============================`);
            console.log(`🚀 Processing ${name}...`);
            const currentSvgPath = path.join(resourcesDir, `${name}.svg`);
            const currentPngPath = path.join(resourcesDir, `${name}.png`);
            const currentIcoPath = path.join(resourcesDir, `${name}.ico`);
            const currentIcnsPath = path.join(resourcesDir, `${name}.icns`);

            console.log(`🔄 Loading ${name}.svg...`);
            if (!fs.existsSync(currentSvgPath)) {
                console.error(`❌ ${name}.svg not found! Skipping.`);
                continue;
            }

            // 1. SVG -> PNG (1024x1024)
            console.log(`✨ Converting ${name}.svg to High-Res PNG (1024x1024)...`);
            await sharp(currentSvgPath)
                .resize(1024, 1024)
                .png()
                .toFile(currentPngPath);

            const pngBuffer = fs.readFileSync(currentPngPath);

            // 2. PNG -> ICNS (Mac)
            console.log(`🍎 Generating ${name}.icns (Mac)...`);
            const icnsBuffer = png2icons.createICNS(pngBuffer, png2icons.BILINEAR, 0);
            if (icnsBuffer) {
                fs.writeFileSync(currentIcnsPath, icnsBuffer);
                console.log(`   ✅ ${name}.icns created`);
            } else {
                console.error(`   ❌ Failed to create ${name}.icns`);
            }

            // 3. PNG -> ICO (Windows)
            console.log(`🪟 Generating ${name}.ico (Windows)...`);
            const icoBuffer = png2icons.createICO(pngBuffer, png2icons.BILINEAR, 0, false);
            if (icoBuffer) {
                fs.writeFileSync(currentIcoPath, icoBuffer);
                console.log(`   ✅ ${name}.ico created`);
            } else {
                console.error(`   ❌ Failed to create ${name}.ico`);
            }
        }

        console.log('\n🎉 All icons generated successfully in /resources!');

    } catch (error) {
        console.error('\n❌ Error generating icons:', error);
    }
})();
