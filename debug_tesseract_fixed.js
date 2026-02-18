const { createWorker } = require('tesseract.js');
const path = require('path');
const fs = require('fs');

console.log('Tesseract Version:', require('tesseract.js/package.json').version);
console.log('Lang Path:', __dirname);
console.log('Eng exists?', fs.existsSync(path.join(__dirname, 'eng.traineddata')));

async function run() {
    try {
        console.log('Attempting createWorker("eng", 1, { langPath: __dirname })...');
        
        // Let Tesseract find the Node worker (since we are in Node)
        // Only provide langPath to avoid downloading
        const worker = await createWorker('eng', 1, {
            langPath: __dirname,
            cacheMethod: 'none',
            gzip: false,
            logger: m => console.log(m)
        });

        console.log('Worker created!');
        // No need to load/init if provided in createWorker, but verifying text
        // We need an image. existing logic uses buffer. 
        // For test, we can just terminate. passing creation means success.
        
        console.log('Terminating...');
        await worker.terminate();
        console.log('Success!');
    } catch (e) {
        console.error('Crash:', e);
    }
}

run();
