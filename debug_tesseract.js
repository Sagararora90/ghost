const { createWorker } = require('tesseract.js');
const path = require('path');

console.log('Tesseract Version:', require('tesseract.js/package.json').version);

async function run() {
    try {
        console.log('Attempting createWorker("eng", 1, { ...options })...');
        
        const worker = await createWorker('eng', 1, {
            workerPath: path.join(__dirname, 'node_modules/tesseract.js/dist/worker.min.js'),
            corePath: path.join(__dirname, 'node_modules/tesseract.js-core/tesseract-core.wasm.js'),
            langPath: __dirname,
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
