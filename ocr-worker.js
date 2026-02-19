const Tesseract = require('tesseract.js');
const path = require('path');
const Jimp = require('jimp');

let worker;

// Message Handler
process.on('message', async (msg) => {
    try {
        if (msg.type === 'INIT') {
            await initializeWorker(msg.payload);
        } else if (msg.type === 'OCR') {
            await performOCR(msg.payload);
        }
    } catch (err) {
        process.send({ type: 'ERROR', error: err.message || err.toString() });
    }
});

async function initializeWorker({ tessPath }) {
    try {
        console.log(`[OCR-Worker] Initializing with tessdata: ${tessPath}`);
        
        // We use the patched package.json, so require('tesseract.js') gives us the Node build.
        // We rely on standard spawn logic now that we are in a pure Node child process.
        
        // Tesseract v5 API: createWorker(langs, oem, options)
        // We pass 'eng' as first arg.
        console.log(`[OCR-Worker] Creating Worker (v5)...`);
        
        worker = await Tesseract.createWorker('eng', 1, {
            langPath: tessPath,
            cacheMethod: 'readOnly', // Force file read
            logger: m => {
                if (m.status === 'recognizing text') {
                    // process.send({ type: 'PROGRESS', progress: m.progress });
                }
            }
        });
        
        // v5: Worker is ready after createWorker resolves.
        
        // Set parameters
        await worker.setParameters({
            tessedit_pageseg_mode: '6', 
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,!?@#$%&*()-_=+[]{}<>:;"\'/|\\ ',
        });

        console.log('[OCR-Worker] Ready.');
        process.send({ type: 'READY' });
    } catch (error) {
        console.error('[OCR-Worker] Init Failed:', error);
        process.send({ type: 'ERROR', error: 'Init Failed: ' + error.message });
    }
}

async function performOCR({ imageBuffer }) {
    if (!worker) {
        throw new Error('Worker not initialized');
    }

    // IPC might serialize Buffer to { type: 'Buffer', data: [...] }
    const actualBuffer = Buffer.isBuffer(imageBuffer) 
        ? imageBuffer 
        : Buffer.from(imageBuffer.data || imageBuffer);

    try {
        // Preprocess image in worker thread to prevent blocking Main thread
        const image = await Jimp.read(actualBuffer);
        if (image.bitmap.width > 1000) image.resize(1000, Jimp.AUTO);
        image.grayscale().contrast(0.2).normalize();
        const processedBuffer = await image.getBufferAsync(Jimp.MIME_PNG);

        const { data: { text } } = await worker.recognize(processedBuffer);
        process.send({ type: 'OCR_RESULT', text });
    } catch (err) {
        console.error('[OCR-Worker] Processing Error:', err);
        throw err;
    }
}
