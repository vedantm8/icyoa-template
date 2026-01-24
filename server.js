const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const url = require("url");

const ROOT = __dirname;
const CYOAS_DIR = path.join(ROOT, "CYOAs");
const PORT = Number(process.env.PORT) || 3000;
const MAX_BODY_SIZE = 10 * 1024 * 1024; // Increased to 10MB for larger CYOAs

const MIME_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf"
};

async function ensureTempFileExists() {
    const TEMP_FILE = path.join(CYOAS_DIR, "temp-input.json");
    const INPUT_FILE = path.join(CYOAS_DIR, "input.json");
    try {
        await fsp.access(TEMP_FILE);
    } catch {
        let sourceData = [];
        try {
            const raw = await fsp.readFile(INPUT_FILE, "utf8");
            sourceData = JSON.parse(raw);
            if (!Array.isArray(sourceData)) {
                sourceData = [];
            }
        } catch {
            sourceData = [];
        }
        await fsp.writeFile(TEMP_FILE, JSON.stringify(sourceData, null, 2), "utf8");
    }
}

function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store"
    });
    res.end(payload);
}

function readRequestBody(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.setEncoding("utf8");
        req.on("data", (chunk) => {
            body += chunk;
            if (body.length > MAX_BODY_SIZE) {
                reject(new Error("Payload too large"));
                req.destroy();
            }
        });
        req.on("end", () => resolve(body));
        req.on("error", reject);
    });
}

async function getCyoaTitle(filename) {
    try {
        const filePath = path.join(CYOAS_DIR, filename);
        const content = await fsp.readFile(filePath, "utf8");
        const data = JSON.parse(content);
        const titleEntry = data.find(e => e.type === "title");
        return titleEntry ? titleEntry.text : filename;
    } catch (err) {
        console.error(`Error reading title from ${filename}:`, err);
        return filename;
    }
}

async function handleGetCyoas(res) {
    try {
        const files = await fsp.readdir(CYOAS_DIR);
        const jsonFiles = files.filter(f => f.endsWith(".json") && f !== "manifest.json");
        const cyoas = await Promise.all(jsonFiles.map(async (f) => {
            const title = await getCyoaTitle(f);
            return { filename: f, title };
        }));
        sendJson(res, 200, cyoas);
    } catch (err) {
        sendJson(res, 500, { ok: false, error: err.message });
    }
}

async function validateFileParam(pathname) {
    if (!pathname) return null;
    const normalized = path.normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '');
    if (normalized.includes("..") || !normalized.endsWith(".json")) {
        return null;
    }
    const filePath = path.join(CYOAS_DIR, normalized);
    if (!filePath.startsWith(CYOAS_DIR)) {
        return null;
    }
    return filePath;
}

async function handleGetConfig(req, res) {
    try {
        const parsedUrl = url.parse(req.url, true);
        const fileName = parsedUrl.query.file || "temp-input.json";
        const filePath = await validateFileParam(fileName);

        if (!filePath) {
            sendJson(res, 400, { ok: false, error: "Invalid file parameter." });
            return;
        }

        try {
            await fsp.access(filePath);
        } catch {
            // If file doesn't exist and it's temp-input.json, try to create it from input.json
            if (fileName === "temp-input.json") {
                await ensureTempFileExists();
            } else {
                sendJson(res, 404, { ok: false, error: "File not found." });
                return;
            }
        }

        const data = await fsp.readFile(filePath, "utf8");
        res.writeHead(200, {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
        });
        res.end(data);
    } catch (err) {
        sendJson(res, 500, {
            ok: false,
            error: err.message || String(err)
        });
    }
}

async function handlePutConfig(req, res) {
    try {
        const parsedUrl = url.parse(req.url, true);
        const fileName = parsedUrl.query.file || "temp-input.json";
        const filePath = await validateFileParam(fileName);

        if (!filePath) {
            sendJson(res, 400, { ok: false, error: "Invalid file parameter." });
            return;
        }

        const raw = await readRequestBody(req);
        const parsed = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(parsed)) {
            sendJson(res, 400, {
                ok: false,
                error: "Config must be a JSON array."
            });
            return;
        }
        await fsp.writeFile(filePath, JSON.stringify(parsed, null, 2), "utf8");
        sendJson(res, 200, {
            ok: true
        });
    } catch (err) {
        const status = err instanceof SyntaxError ? 400 : 500;
        sendJson(res, status, {
            ok: false,
            error: err.message || String(err)
        });
    }
}

async function serveStaticAsset(res, pathname) {
    try {
        let resourcePath = pathname;
        if (resourcePath === "" || resourcePath === "/") {
            resourcePath = "index.html";
        } else if (resourcePath.startsWith("/")) {
            resourcePath = resourcePath.slice(1);
        }

        resourcePath = path.normalize(resourcePath);
        if (resourcePath.includes("..")) {
            res.writeHead(403);
            res.end("Forbidden");
            return;
        }

        let filePath = path.join(ROOT, resourcePath);
        const stat = await fsp.stat(filePath).catch(async (err) => {
            if (err.code === "ENOENT" && !path.extname(resourcePath)) {
                const withHtml = `${filePath}.html`;
                const htmlStat = await fsp.stat(withHtml).catch(() => null);
                if (htmlStat) {
                    filePath = withHtml;
                    return htmlStat;
                }
            }
            throw err;
        });

        if (stat && stat.isDirectory()) {
            filePath = path.join(filePath, "index.html");
        }

        const ext = path.extname(filePath).toLowerCase();
        const mime = MIME_TYPES[ext] || "application/octet-stream";
        res.writeHead(200, {
            "Content-Type": mime
        });
        fs.createReadStream(filePath).pipe(res);
    } catch (err) {
        const status = err.code === "ENOENT" ? 404 : 500;
        res.writeHead(status, {
            "Content-Type": "text/plain; charset=utf-8"
        });
        res.end(status === 404 ? "Not found" : `Server error: ${err.message || err}`);
    }
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url || "/");
    const pathname = parsedUrl.pathname || "/";

    if (req.method === "GET" && pathname === "/api/cyoas") {
        await handleGetCyoas(res);
        return;
    }

    if (req.method === "GET" && pathname === "/api/temp-config") {
        await handleGetConfig(req, res);
        return;
    }

    if (req.method === "PUT" && pathname === "/api/temp-config") {
        await handlePutConfig(req, res);
        return;
    }

    if (req.method === "GET") {
        await serveStaticAsset(res, pathname);
        return;
    }

    res.writeHead(405, {
        "Allow": "GET, PUT"
    });
    res.end("Method not allowed");
});

server.listen(PORT, () => {
    ensureTempFileExists().catch((err) => {
        console.warn("Failed to initialize temp config file:", err);
    });
    const baseUrl = `http://localhost:${PORT}`;
    console.log(`View CYOA at ${baseUrl}/`);
    console.log(`Open the visual editor at ${baseUrl}/editor.html`);
});
