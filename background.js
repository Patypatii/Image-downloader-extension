// ImageScraperExtension/background.js

import JSZip from 'jszip';

// Helper function to convert ArrayBuffer to Base64 string
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    if (request.action === 'scrapeUrl') {
        let tabIdToScrape;
        let targetUrl = request.url; // This comes from the popup's URL input

        console.log("Background: Received 'scrapeUrl' request.");
        console.log("Background: Target URL from popup input:", targetUrl);

        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

        console.log("Background: Result of chrome.tabs.query({ active: true, currentWindow: true }):", tabs);

        if (tabs.length === 0 || !tabs[0].id) {
            console.error("Background: No active tab found by query. Cannot scrape.");
            sendResponse({ success: false, message: "No active tab found in the current window to scrape." });
            return true;
        }
        tabIdToScrape = tabs[0].id;
        console.log("Background: Active tab ID identified:", tabIdToScrape);

        if (targetUrl) {
            if (tabs[0].url !== targetUrl) {
                try {
                    chrome.runtime.sendMessage({ action: 'updateLoading', message: `Navigating to ${targetUrl}...` });
                    await chrome.tabs.update(tabIdToScrape, { url: targetUrl });
                    // IMPORTANT: For robustness, consider replacing this setTimeout with a
                    // chrome.tabs.onUpdated listener that waits for status: 'complete'.
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Simple wait for navigation to settle
                    console.log(`Background: Navigated tab ${tabIdToScrape} to ${targetUrl}`);
                } catch (navError) {
                    console.error(`Background: Failed to navigate to ${targetUrl}:`, navError);
                    sendResponse({ success: false, message: `Failed to navigate to ${targetUrl}: ${navError.message}` });
                    return true;
                }
            } else {
                console.log(`Background: Active tab is already at target URL: ${targetUrl}. No navigation needed.`);
            }
        } else {
            console.log("Background: No target URL provided. Scraping current active tab.");
        }

        if (tabIdToScrape) {
            try {
                chrome.runtime.sendMessage({ action: 'updateLoading', message: 'Executing content script...' });

                await chrome.scripting.executeScript({
                    target: { tabId: tabIdToScrape },
                    files: ['content.bundle.js']
                });

                await chrome.tabs.sendMessage(tabIdToScrape, { action: 'startScraping' });
                sendResponse({ success: true, message: 'Scraping initiated.' });
            } catch (error) {
                console.error("Background: Failed to execute content script or send message to content script:", error);
                sendResponse({ success: false, message: `Failed to start scraping: ${error.message}` });
            }
        } else {
            console.error("Background: Fallback error: tabIdToScrape is undefined.");
            sendResponse({ success: false, message: "Internal error: Could not determine target tab." });
        }
        return true;
    } else if (request.action === 'scrapedData' || request.action === 'error' || request.action === 'updateLoading') {
        // Forward messages from content script to popup (or other parts of the extension)
        chrome.runtime.sendMessage(request);
        sendResponse({ success: true });
        return true;
    } else if (request.action === 'downloadImagesAsZip') {
        const imageUrls = request.urls;
        const pageTitle = request.pageTitle || 'scraped_images';

        if (!imageUrls || imageUrls.length === 0) {
            chrome.runtime.sendMessage({ action: 'error', message: 'No URLs provided for ZIP download.' });
            sendResponse({ success: false, message: 'No URLs provided for ZIP download.' });
            return true;
        }

        try {
            chrome.runtime.sendMessage({ action: 'updateLoading', message: 'Preparing to download images for ZIP...' });

            const zip = new JSZip();
            let downloadedCount = 0;

            const fetchPromises = imageUrls.map(async (url, index) => {
                try {
                    chrome.runtime.sendMessage({ action: 'updateLoading', message: `Downloading image ${index + 1}/${imageUrls.length}...` });

                    const response = await fetch(url);
                    if (!response.ok) {
                        console.warn(`Failed to fetch ${url}: ${response.statusText}`);
                        return null;
                    }
                    const blob = await response.blob();

                    const urlPath = new URL(url).pathname;
                    let filename = urlPath.substring(urlPath.lastIndexOf('/') + 1);
                    filename = filename.split('?')[0].split('#')[0]; // Remove query params and hash

                    if (!filename || filename.includes('.') === false) {
                        const ext = blob.type.split('/')[1] || 'bin';
                        filename = `image_${Date.now()}_${index + 1}.${ext}`;
                    } else if (filename.length > 100) { // Prevent excessively long filenames
                        const ext = filename.split('.').pop();
                        filename = `image_${Date.now()}_${index + 1}.${ext}`;
                    }

                    zip.file(filename, blob, { binary: true });
                    downloadedCount++;
                    return filename;
                } catch (fetchError) {
                    console.error(`Error fetching ${url}:`, fetchError);
                    return null;
                }
            });

            await Promise.all(fetchPromises);

            chrome.runtime.sendMessage({ action: 'updateLoading', message: `Fetched ${downloadedCount} of ${imageUrls.length} images. Generating ZIP file...` });

            const sanitizedPageTitle = pageTitle.replace(/[^a-z0-9\s]/gi, '').trim().replace(/\s+/g, '_').toLowerCase();
            const zipFilename = `${sanitizedPageTitle || 'scraped_images'}_${Date.now()}.zip`;

            const zipBlob = await zip.generateAsync({ type: 'blob' });

            // --- NEW: Convert ArrayBuffer to Base64 string for reliable transfer ---
            const arrayBuffer = await zipBlob.arrayBuffer();
            const base64ZipData = arrayBufferToBase64(arrayBuffer); // Convert to Base64
            const blobType = zipBlob.type;

            console.log("Background Debug: Sending Base64 data length:", base64ZipData.length);
            console.log("Background Debug: Sending blobType:", blobType);

            chrome.runtime.sendMessage({
                action: 'initiateZipDownloadInPopup',
                base64ZipData: base64ZipData, // Send the Base64 string
                blobType: blobType,
                filename: zipFilename
            });

            sendResponse({ success: true, message: 'ZIP generation initiated in background.' });

        } catch (zipError) {
            console.error('Error generating ZIP in background:', zipError);
            chrome.runtime.sendMessage({ action: 'error', message: `Error creating ZIP: ${zipError.message}` });
            sendResponse({ success: false, message: `Error creating ZIP: ${zipError.message}` });
        }
        return true;
    } else if (request.action === 'themeChanged') {
        sendResponse({ success: true });
        return true;
    }
});