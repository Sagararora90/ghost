const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

const inputFile = path.join(__dirname, '../tessdata/eng.traineddata');
const outputFile = path.join(__dirname, '../tessdata/eng.traineddata.gz');

if (!fs.existsSync(inputFile)) {
    console.error('Input file not found:', inputFile);
    process.exit(1);
}

const readStream = fs.createReadStream(inputFile);
const writeStream = fs.createWriteStream(outputFile);
const gzip = zlib.createGzip();

readStream.pipe(gzip).pipe(writeStream);

writeStream.on('finish', () => {
    console.log('Successfully created eng.traineddata.gz');
});

writeStream.on('error', (err) => {
    console.error('Error gzipping file:', err);
    process.exit(1);
});
