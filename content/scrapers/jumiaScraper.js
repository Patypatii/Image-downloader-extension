// ImageScraperExtension/content/scrapers/jumiaScraper.js
// export { scrapeJumia }; // If using modules

async function scrapeJumia(options, utils) {
    const { waitForElement, updateLoading } = utils || {};
    updateLoading('Scraping Jumia product page...');
    console.log('Running Jumia scraper...');
    const scrapedData = { images: [], data: { productInfo: { platform: 'Jumia' }, lastError: null } };
    const images = new Set();

    try {
        // *** ACTUAL JUMIA SELECTORS GO HERE ***
        // These are highly volatile and will break with site changes
        const mainProductImg = await waitForElement('.product-image-gallery__image img', 10000);
        if (mainProductImg && mainProductImg.src && mainProductImg.naturalWidth >= options.minImageWidth) {
            images.add(mainProductImg.src);
        }

        document.querySelectorAll('.gallery-thumb-list img').forEach(img => {
            const src = img.src || img.dataset.src;
            if (src && src.startsWith('http') && img.naturalWidth >= options.minImageWidth) {
                images.add(src);
            }
        });

        const productNameElem = document.querySelector('.product-name');
        if (productNameElem) scrapedData.data.productInfo.name = productNameElem.textContent.trim();

        const productPriceElem = document.querySelector('.product-price');
        if (productPriceElem) scrapedData.data.productInfo.price = productPriceElem.textContent.trim();

    } catch (error) {
        console.error('Jumia scraping error:', error);
        scrapedData.data.lastError = `Jumia specific scraping failed: ${error.message}`;
        throw error;
    }
    return { images: Array.from(images), data: scrapedData.data };
}