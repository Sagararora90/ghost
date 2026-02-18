const { createWorker } = require('tesseract.js');
const path = require('path');

console.log('Tesseract Version:', require('tesseract.js/package.json').version);

async function run() {
    try {
        console.log('Attempting createWorker("eng", 1, {}) (DEFAULTS)...');
        
        // No explicit paths - let it find Node worker
        const worker = await createWorker('eng', 1, {
            cacheMethod: 'none',
            gzip: false,
            logger: m => console.log(m)
        });

        console.log('Worker created!');
        await worker.loadLanguage('eng');
        await worker.initialize('eng');
        console.log('Worker initialized!');
        await worker.terminate();
    } catch (e) {
        console.error('Crash:', e);
    }
}

run();
