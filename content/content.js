
/**
 * Waits for an element matching the given CSS selector to appear in the DOM.
 * @param {string} selector - The CSS selector of the element to wait for.
 * @param {number} timeout - The maximum time to wait in milliseconds.
 * @returns {Promise<Element|null>} A promise that resolves with the element or null if timeout occurs.
 */
function waitForElement(selector, timeout) {
    return new Promise(resolve => {
        if (document.querySelector(selector)) {
            return resolve(document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.querySelector(selector));
            }
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        setTimeout(() => {
            observer.disconnect();
            resolve(null);
        }, timeout);
    });
}

/**
 * Scrolls the page to the bottom repeatedly to load lazy-loaded content.
 * @param {number} scrollDelay - Delay in milliseconds between scrolls.
 * @param {number} maxScrolls - Maximum number of scrolls to perform.
 */
async function scrollPageToEnd(scrollDelay = 1000, maxScrolls = 5) {
    let currentScrolls = 0;
    while (currentScrolls < maxScrolls) {
        const prevHeight = document.documentElement.scrollHeight;
        window.scrollTo(0, document.documentElement.scrollHeight);
        await new Promise(r => setTimeout(r, scrollDelay)); // Wait for content to load

        const newHeight = document.documentElement.scrollHeight;
        if (newHeight === prevHeight) {
            console.log("No more content loaded after scroll, stopping auto-scroll.");
            break; // No new content, stop scrolling
        }
        currentScrolls++;
        console.log(`Scrolled ${currentScrolls}/${maxScrolls}.`);
    }
}

// --- Scraper Utility (for consistent messaging from scrapers to background/popup) ---
const scraperUtils = {
    waitForElement: waitForElement,
    scrollPageToEnd: scrollPageToEnd,
    updateLoading: (message) => chrome.runtime.sendMessage({ action: 'updateLoading', message: message })
};

// --- Scraper Implementations (embedded for simplicity in Mv3 content script without bundler) ---
// In a production environment, you'd use a build tool (like Webpack) to bundle these into content.js
// and use proper ES module imports (e.g., import { scrapeGeneric } from './scrapers/genericScraper.js';)

async function scrapeGeneric(options) {
    const images = new Set();
    const scrapedData = { genericInfo: {}, lastError: null };

    scraperUtils.updateLoading('Extracting basic info...');
    scrapedData.genericInfo.pageTitle = document.title;
    scrapedData.genericInfo.url = window.location.href;

    scraperUtils.updateLoading('Waiting for dynamic content...');
    await scraperUtils.waitForElement('body', 15000); // Wait for page body to be ready

    scraperUtils.updateLoading(`Scrolling to load more images (max ${options.maxScrolls} scrolls)...`);
    await scraperUtils.scrollPageToEnd(1500, options.maxScrolls); // Use options.maxScrolls

    // 1. From <img> tags
    document.querySelectorAll('img').forEach(img => {
        let src = img.src;
        // Check srcset for potentially higher quality images
        if (img.srcset) {
            const srcsetParts = img.srcset.split(',').map(part => part.trim().split(' ')[0]);
            const validSrcset = srcsetParts.find(s => s && s.startsWith('http'));
            if (validSrcset) {
                src = validSrcset;
            }
        }
        // Fallback for lazy-loaded images using data attributes
        if (!src || src.startsWith('data:') || src === window.location.href) {
            src = img.getAttribute('data-src') || img.getAttribute('data-original') || src;
        }

        // Basic filtering by source and minimum width
        if (src && src.startsWith('http') && src !== 'about:blank' && img.naturalWidth >= options.minImageWidth) {
            images.add(src);
        }
    });

    // 2. From CSS background-image
    if (options.scrapeCssBackgrounds) {
        scraperUtils.updateLoading('Checking CSS backgrounds (this may take time)...');
        const elementsToCheck = document.querySelectorAll('div, span, a, section, article, header, footer, li');
        for (const el of elementsToCheck) {
            const computedStyle = window.getComputedStyle(el);
            const bgImage = computedStyle.backgroundImage;
            if (bgImage && bgImage !== 'none' && !bgImage.includes('gradient')) {
                const urlMatch = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
                if (urlMatch && urlMatch[1]) {
                    let url = urlMatch[1];
                    url = url.replace(/&amp;/g, '&'); // Decode HTML entities
                    if (url.startsWith('http') && !url.includes('data:image')) {
                        images.add(url);
                    }
                }
            }
        }
    }

    scrapedData.images = Array.from(images);
    scrapedData.genericInfo.scrapedCount = scrapedData.images.length;
    return { images: scrapedData.images, data: scrapedData };
}

async function scrapeJumia(options) {
    const images = new Set();
    const scrapedData = { productInfo: { platform: 'Jumia' }, lastError: null };

    scraperUtils.updateLoading('Scraping Jumia product page...');

    try {
        // Wait for a key Jumia element to ensure page is loaded
        const mainProductImgElement = await scraperUtils.waitForElement('.product-image-gallery__image img', 15000);
        if (!mainProductImgElement) {
            throw new Error("Jumia main product image not found after timeout.");
        }

        // Main product image
        if (mainProductImgElement.src && mainProductImgElement.naturalWidth >= options.minImageWidth) {
            images.add(mainProductImgElement.src);
        }

        // Thumbnail images
        document.querySelectorAll('.gallery-thumb-list img').forEach(img => {
            const src = img.src || img.dataset.src; // Check data-src for lazy loaded
            if (src && src.startsWith('http') && img.naturalWidth >= options.minImageWidth) {
                images.add(src);
            }
        });

        // Extract other product info
        const productNameElem = document.querySelector('.product-name'); // Example selector
        if (productNameElem) scrapedData.productInfo.name = productNameElem.textContent.trim();

        const productPriceElem = document.querySelector('.product-price'); // Example selector
        if (productPriceElem) scrapedData.productInfo.price = productPriceElem.textContent.trim();

    } catch (error) {
        console.error('Jumia scraping error:', error);
        scrapedData.lastError = `Jumia specific scraping failed: ${error.message}`;
        throw error; // Re-throw to be caught by the main content.js listener
    }
    return { images: Array.from(images), data: scrapedData };
}

async function scrapeFacebook(options) {
    const images = new Set();
    const scrapedData = { posts: [], platform: 'Facebook', lastError: null };

    scraperUtils.updateLoading('Scraping Facebook page...');

    try {
        // WARNING: Facebook is extremely difficult to scrape reliably due to dynamic content,
        // anti-bot measures, and terms of service. This is a very basic example and
        // is unlikely to work consistently on all Facebook pages or with logged-in sessions.
        // Full Facebook scraping often requires being logged in and is against their TOS.

        // Attempt to scroll to load more content
        await scraperUtils.scrollPageToEnd(2000, options.maxScrolls); // Use maxScrolls from options

        // Generic image grab for example
        document.querySelectorAll('img').forEach(img => {
            // Facebook uses very complex image URLs and often lazy loads.
            // This is a simplified grab. You'd need much more specific selectors
            // and potentially a MutationObserver to catch newly loaded images.
            if (img.src && img.src.startsWith('http') && img.naturalWidth >= options.minImageWidth) {
                // Filter out common Facebook non-content images (profile pics, emojis etc.)
                if (!img.src.includes('emoji') && !img.src.includes('profile_picture')) {
                    images.add(img.src);
                }
            }
        });

        scrapedData.images = Array.from(images);
        // You could add logic here to find post text, video links, etc.
        // This is where a MutationObserver watching specific feed containers would be implemented for new posts.

    } catch (error) {
        console.error('Facebook scraping error:', error);
        scrapedData.lastError = `Facebook specific scraping failed: ${error.message}`;
        throw error; // Re-throw to be caught by the main content.js listener
    }
    return { images: Array.from(images), data: scrapedData };
}


// --- Main Message Listener for Content Script ---
chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'startScraping') {
        console.log('Content script: Received startScraping request.');
        let images = [];
        let scrapedData = {
            pageTitle: document.title,
            url: window.location.href,
            scrapedImages: [],
            scrapedCount: 0,
            lastError: null
        };

        try {
            // Retrieve options from storage.
            // This ensures content script has up-to-date settings.
            const options = await new Promise(resolve => {
                chrome.storage.sync.get({
                    scrapeCssBackgrounds: false,
                    minImageWidth: 50,
                    maxScrolls: 5 // Ensure maxScrolls is retrieved
                }, resolve);
            });

            const hostname = window.location.hostname;
            let scrapeResult;

            // --- Dispatch to appropriate scraper based on hostname ---
            if (hostname.includes('jumia.co.ke') || hostname.includes('jumia.com')) {
                await scraperUtils.updateLoading('Applying Jumia specific scraping...');
                scrapeResult = await scrapeJumia(options);
            } else if (hostname.includes('facebook.com')) {
                await scraperUtils.updateLoading('Applying Facebook specific scraping...');
                scrapeResult = await scrapeFacebook(options);
            } else {
                await scraperUtils.updateLoading('Applying generic scraping...');
                scrapeResult = await scrapeGeneric(options);
            }

            images = scrapeResult.images;
            // Merge generic page info with specific scraper's data
            scrapedData = {
                pageTitle: document.title, // Always get current title
                url: window.location.href, // Always get current URL
                ...scrapeResult.data, // Overlay data from specific scraper
                scrapedImages: images, // Ensure images are explicitly under scrapedImages
                scrapedCount: images.length
            };

            await scraperUtils.updateLoading(`Found ${images.length} images. Sending data to popup...`);
            chrome.runtime.sendMessage({ action: 'scrapedData', images: images, data: scrapedData });
            sendResponse({ success: true, message: 'Scraping complete. Data sent.' });

        } catch (error) {
            console.error('Content script main scraping error:', error);
            const errorMessage = `Scraping failed: ${error.message}`;
            scrapedData.lastError = error.message; // Capture error in scrapedData
            chrome.runtime.sendMessage({ action: 'error', message: errorMessage });
            sendResponse({ success: false, message: errorMessage });
        }
        return true; // Keep the message channel open for async response
    }
});