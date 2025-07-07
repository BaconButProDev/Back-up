const express = require('express');
const { chromium } = require('playwright-chromium');

const app = express();
const PORT = process.env.PORT || 3000;

let browserPromise = createBrowser();
let contextPromise;

function createBrowser() {
    console.log('🚀 Launching minimal browser for API checking...');
    return chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-background-networking',
            '--disable-backgrounding-occluded-windows',
            '--disable-breakpad',
            '--disable-component-extensions-with-background-pages',
            '--disable-default-apps',
            '--disable-extensions',
            '--disable-features=site-per-process,TranslateUI,BlinkGenPropertyTrees',
            '--disable-hang-monitor',
            '--disable-infobars',
            '--disable-popup-blocking',
            '--disable-prompt-on-repost',
            '--disable-renderer-backgrounding',
            '--disable-sync',
            '--disable-translate',
            '--disable-web-security',
            '--disable-blink-features=AutomationControlled',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-first-run',
            '--no-zygote',
            '--safebrowsing-disable-auto-update',
            '--no-default-browser-check',
            '--disable-client-side-phishing-detection',
            '--disable-notifications',
            '--disable-images',
            '--blink-settings=imagesEnabled=false',
            '--disable-remote-fonts',
            '--disable-print-preview',
            '--disable-threaded-animation',
            '--disable-threaded-scrolling',
            '--disable-checker-imaging',
            '--hide-scrollbars',
            '--window-size=1280,720',
            '--single-process',
            '--renderer-process-limit=1',
            '--aggressive-cache-discard',
            '--disable-ipc-flooding-protection',
            '--disable-component-update',
            '--disable-domain-reliability',
            '--no-service-autorun',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-sync-types=*,*',
            '--disable-crash-reporter',
            '--disable-logging',
            '--disable-permissions-api',
            '--noerrdialogs',
            '--disable-bundled-ppapi-flash',
            '--disable-speech-api',
            '--disable-media-session-api',
            '--disable-translate-new-ux'
        ]
    });
}

async function getBrowser() {
    try {
        const browser = await browserPromise;
        await browser.version();
        return browser;
    } catch {
        console.warn('⚠ Browser died, relaunching...');
        browserPromise = createBrowser();
        contextPromise = undefined;
        const browser = await browserPromise;
        return browser;
    }
}

async function getContext() {
    const browser = await getBrowser();
    if (!contextPromise) {
        contextPromise = browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 }, // Kích thước màn hình phổ biến hơn
    deviceScaleFactor: 1,                  // Tỉ lệ màn hình (thường 1 hoặc 1.25 trên PC)
    isMobile: false,                       // Không phải thiết bị di động
    hasTouch: false,                       // PC không có touch
    locale: 'en-US',                       // Ngôn ngữ
    timezoneId: 'Asia/Ho_Chi_Minh',        // Múi giờ phù hợp
    permissions: ['geolocation'],          // Nếu cần quyền
    geolocation: { latitude: 10.762622, longitude: 106.660172 }, // Ví dụ Sài Gòn
    colorScheme: 'light',                  // Chế độ sáng
    extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
    }
});

        console.log('🟢 Created shared context');
    }
    return contextPromise;
}

app.get('/get', async (req, res) => {
    const targetUrl = req.query.tc;
    if (!targetUrl) {
        return res.status(400).json({ error: 'Missing "tc" query parameter' });
    }

    let page;
    let found = false;
    let timeoutId;

    try {
        const context = await getContext();
        page = await context.newPage();
        console.log(`🆕 Opened new tab for: ${targetUrl}`);

        await page.route('**/*', (route) => {
            const type = route.request().resourceType();
            if (['image', 'font', 'media', 'stylesheet', 'other'].includes(type)) {
                route.abort();
            } else {
                route.continue();
            }
        });

        const trackedRequests = new Map();

        page.on('request', request => {
            if (request.url().includes('/tc')) {
                console.log(`📤 Request URL: ${request.url()}`);
                trackedRequests.set(request.url(), request.method());
            }
        });

        page.on('response', async response => {
            if (response.url().includes('/tc')) {
                const method = trackedRequests.get(response.url());
                if (method !== 'POST') return;
                if (found) return;
                found = true;

                clearTimeout(timeoutId);
                const result = await safeParseResponse(response);

                if (!res.headersSent) {
                    res.json({
                        url: response.url(),
                        status: response.status(),
                        data: result.ok ? result.data : null
                    });
                }

                if (page) {
                    await page.close();
                    await context.clearCookies();
                    await context.clearPermissions();
                    console.log('✅ Closed tab after success');
                }
            }
        });

        await page.goto(targetUrl, { waitUntil: 'networkidle' });
        await page.waitForTimeout(4000); 

        timeoutId = setTimeout(async () => {
            if (!found && !res.headersSent) {
                res.status(408).json({ error: 'No matching POST response found within timeout' });
            }
            if (page) {
                await page.close();
                console.log('⏰ Closed tab after timeout');
            }
        }, 60000);

    } catch (err) {
        console.error('❌ Error:', err);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal server error' });
        }
        if (page) {
            await page.close();
            console.log('❌ Closed tab after error');
        }
    }
});

async function safeParseResponse(response) {
    try {
        const text = await response.text();
        try {
            return { ok: true, data: JSON.parse(text) };
        } catch {
            return { ok: true, data: text };
        }
    } catch (e) {
        console.error('❌ Error reading response body:', e.message);
        return { ok: false, data: null };
    }
}

app.listen(PORT, () => {
    console.log(`🌐 Server is running on port ${PORT}`);
    setInterval(() => {
        const used = process.memoryUsage();
        console.log('📊 RAM usage:');
        console.log(`  🧠 RSS        : ${(used.rss / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  📦 Heap Total : ${(used.heapTotal / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  🔍 Heap Used  : ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  🗑 External   : ${(used.external / 1024 / 1024).toFixed(2)} MB`);
        console.log(`  🧱 Array Buff : ${(used.arrayBuffers / 1024 / 1024).toFixed(2)} MB`);
        console.log('-------------------------');
    }, 15000);
});