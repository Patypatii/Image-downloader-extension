// ImageScraperExtension/content/scrapers/genericScraper.js

// Make sure waitForElement and scrollPageToEnd are available, perhaps pass them or put them in a shared utility.
// For simplicity, let's assume they are imported or globally available (less ideal, but functional for demonstration)
// In a real project, you'd use ES Modules and import these.
// export { scrapeGeneric }; // If using modules

async function scrapeGeneric(options, utils) { // Pass utils if functions are not global
    const { waitForElement, scrollPageToEnd, updateLoading } = utils || {}; // Destructure utility functions
    console.log('Running generic scraper...');

    const scrapedData = {
        images: [],
        data: { genericInfo: {}, lastError: null }
    };
    const potentialImageSources = new Set();

    updateLoading('Extracting basic info...');
    // Basic page info
    scrapedData.data.genericInfo.pageTitle = document.title;
    scrapedData.data.genericInfo.url = window.location.href;

    updateLoading('Waiting for dynamic content...');
    await waitForElement('body', 15000);

    updateLoading('Scrolling to load more images...');
    await scrollPageToEnd(1500); // Or use options.maxScrolls

    // 1. From <img> tags
    document.querySelectorAll('img').forEach(img => {
        let src = img.src;
        if (img.srcset) {
            const srcsetParts = img.srcset.split(',').map(part => part.trim().split(' ')[0]);
            const validSrcset = srcsetParts.find(s => s && s.startsWith('http'));
            if (validSrcset) {
                src = validSrcset;
            }
        }
        if (!src || src.startsWith('data:') || src === window.location.href) {
            src = img.getAttribute('data-src') || img.getAttribute('data-original') || src;
        }

        // Apply minImageWidth filtering (needs async Image load for accurate check)
        if (src && src.startsWith('http') && src !== 'about:blank' && img.naturalWidth >= options.minImageWidth) {
            potentialImageSources.add(src);
        }
    });

    // 2. From CSS background-image
    if (options.scrapeCssBackgrounds) {
        updateLoading('Checking CSS backgrounds (this may take time)...');
        const elementsToCheck = document.querySelectorAll('div, span, a, section, article, header, footer, li');
        for (const el of elementsToCheck) {
            const computedStyle = window.getComputedStyle(el);
            const bgImage = computedStyle.backgroundImage;
            if (bgImage && bgImage !== 'none' && !bgImage.includes('gradient')) {
                const urlMatch = bgImage.match(/url\(['"]?(.*?)['"]?\)/);
                if (urlMatch && urlMatch[1]) {
                    let url = urlMatch[1];
                    url = url.replace(/&amp;/g, '&');
                    // No easy way to filter by width for background images without async loading
                    if (url.startsWith('http') && !url.includes('data:image')) {
                        potentialImageSources.add(url);
                    }
                }
            }
        }
    }

    scrapedData.images = Array.from(potentialImageSources);
    scrapedData.data.genericInfo.scrapedCount = scrapedData.images.length;
    return { images: scrapedData.images, data: scrapedData.data };
}