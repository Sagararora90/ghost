const fs = require('fs');
const path = require('path');

const tesseractPackagePath = path.join(__dirname, '..', 'node_modules', 'tesseract.js', 'package.json');

if (fs.existsSync(tesseractPackagePath)) {
    console.log('Patching tesseract.js package.json...');
    const pkg = JSON.parse(fs.readFileSync(tesseractPackagePath, 'utf8'));
    
    if (pkg.browser) {
        console.log('Found browser field, removing it to force Node.js build in Electron.');
        delete pkg.browser;
        fs.writeFileSync(tesseractPackagePath, JSON.stringify(pkg, null, 2));
        console.log('Successfully patched tesseract.js package.json');
    } else {
        console.log('tesseract.js package.json already patched or has no browser field.');
    }
} else {
    console.error('tesseract.js package.json not found at:', tesseractPackagePath);
    process.exit(1);
}
