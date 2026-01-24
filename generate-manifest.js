const fs = require('fs');
const path = require('path');

const CYOAS_DIR = path.join(__dirname, 'CYOAs');
const MANIFEST_FILE = path.join(CYOAS_DIR, 'manifest.json');

async function getCyoaTitle(filename) {
    try {
        const filePath = path.join(CYOAS_DIR, filename);
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        const titleEntry = data.find(e => e.type === "title");
        return titleEntry ? titleEntry.text : filename;
    } catch (err) {
        console.error(`Error reading title from ${filename}:`, err);
        return filename;
    }
}

async function generateManifest() {
    try {
        if (!fs.existsSync(CYOAS_DIR)) {
            console.error(`Directory ${CYOAS_DIR} does not exist.`);
            return;
        }

        const files = fs.readdirSync(CYOAS_DIR);
        const jsonFiles = files.filter(f => f.endsWith('.json') && f !== 'manifest.json');

        const cyoas = await Promise.all(jsonFiles.map(async (f) => {
            const title = await getCyoaTitle(f);
            return { filename: f, title };
        }));

        fs.writeFileSync(MANIFEST_FILE, JSON.stringify(cyoas, null, 2), 'utf8');
        console.log(`Successfully generated ${MANIFEST_FILE} with ${cyoas.length} CYOAs.`);
    } catch (err) {
        console.error('Error generating manifest:', err);
    }
}

generateManifest();
