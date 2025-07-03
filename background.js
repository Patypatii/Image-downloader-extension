import JSZip from 'jszip';

// --- Global variables (if any) or shared utility functions ---
// Not strictly global in the same way as main browser thread, but accessible within the service worker.

chrome.runtime.onMessage.addListener(async (request, sender, sendResponse) => {
    // Determine the tabId if the message originated from a tab.
    // For 'scrapeUrl' from popup, sender.tab will be undefined.
    // We will query for the active tab specifically for this action.
    // const senderTabId = sender.tab ? sender.tab.id : null; // <-- This line is NOT used for scrapeUrl anymore

    if (request.action === 'scrapeUrl') {
        let tabIdToScrape;
        let targetUrl = request.url; // This comes from the popup's URL input

        console.log("Background: Received 'scrapeUrl' request.");
        console.log("Background: Target URL from popup input:", targetUrl);

        // Query for the currently active tab in the current window
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });

        console.log("Background: Result of chrome.tabs.query({ active: true, currentWindow: true }):", tabs);

        if (tabs.length === 0 || !tabs[0].id) {
            console.error("Background: No active tab found by query. Cannot scrape.");
            sendResponse({ success: false, message: "No active tab found in the current window to scrape." });
            return true;
        }
        tabIdToScrape = tabs[0].id;
        console.log("Background: Active tab ID identified:", tabIdToScrape);

        // If a target URL was provided in the popup's input, navigate the active tab to it
        if (targetUrl) {
            // Only navigate if the active tab's current URL is different from the targetUrl
            if (tabs[0].url !== targetUrl) {
                try {
                    chrome.runtime.sendMessage({ action: 'updateLoading', message: `Navigating to ${targetUrl}...` });
                    await chrome.tabs.update(tabIdToScrape, { url: targetUrl });
                    // IMPORTANT: For robustness, replace this setTimeout with a chrome.tabs.onUpdated listener
                    // that waits for status: 'complete' for the given tabId.
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Simple wait for navigation to settle
                    console.log(`Background: Navigated tab ${tabIdToScrape} to ${targetUrl}`);
                } catch (navError) {
                    console.error(`Background: Failed to navigate to ${targetUrl}:`, navError);
                    sendResponse({ success: false, message: `Failed to navigate to ${targetUrl}: ${navError.message}` });
                    return true; // Stop execution if navigation fails
                }
            } else {
                console.log(`Background: Active tab is already at target URL: ${targetUrl}. No navigation needed.`);
            }
        } else {
            console.log("Background: No target URL provided. Scraping current active tab.");
        }

        // Now that we have a valid tabIdToScrape and potentially navigated, proceed with scripting
        if (tabIdToScrape) {
            try {
                // Inform popup that scraping is starting
                chrome.runtime.sendMessage({ action: 'updateLoading', message: 'Executing content script...' });

                // Execute content.js in the determined tab
                await chrome.scripting.executeScript({
                    target: { tabId: tabIdToScrape },
                    files: ['content/content.js'] // Path to your main content script
                });

                // Send message to content script to start scraping.
                // The content script will get the URL directly from window.location.href.
                await chrome.tabs.sendMessage(tabIdToScrape, { action: 'startScraping' });
                sendResponse({ success: true, message: 'Scraping initiated.' });
            } catch (error) {
                console.error("Background: Failed to execute content script or send message to content script:", error);
                sendResponse({ success: false, message: `Failed to start scraping: ${error.message}` });
            }
        } else {
            // This else block should ideally not be reached with the above logic,
            // as we handle 'tabs.length === 0' earlier.
            console.error("Background: Fallback error: tabIdToScrape is undefined.");
            sendResponse({ success: false, message: "Internal error: Could not determine target tab." });
        }
        return true; // Keep the message channel open for async response
    } else if (request.action === 'scrapedData' || request.action === 'error' || request.action === 'updateLoading') {
        // These messages are typically from content.js back to the popup.
        // Forward them directly to the popup (runtime) or a specific tab if needed.
        // For simplicity and to ensure the popup gets it, just send to runtime.
        chrome.runtime.sendMessage(request);
        sendResponse({ success: true }); // Acknowledge receipt
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
            // Send initial progress update to the popup
            chrome.runtime.sendMessage({ action: 'updateLoading', message: 'Preparing to download images for ZIP...' });

            const zip = new JSZip();
            let downloadedCount = 0;

            const fetchPromises = imageUrls.map(async (url, index) => {
                try {
                    // Update progress more granularly
                    chrome.runtime.sendMessage({ action: 'updateLoading', message: `Downloading image ${index + 1}/${imageUrls.length}...` });

                    const response = await fetch(url);
                    if (!response.ok) {
                        console.warn(`Failed to fetch ${url}: ${response.statusText}`);
                        return null; // Don't add to zip if fetch failed
                    }
                    const blob = await response.blob();

                    // --- Improved Filename Derivation ---
                    const urlPath = new URL(url).pathname; // Get path part of URL
                    let filename = urlPath.substring(urlPath.lastIndexOf('/') + 1); // Get last part of path

                    // Remove query parameters and hash
                    filename = filename.split('?')[0].split('#')[0];

                    // If filename is empty or looks like a directory, generate a generic one
                    if (!filename || filename.includes('.') === false) { // Check if it has an extension
                        const ext = blob.type.split('/')[1] || 'bin'; // Fallback extension
                        filename = `image_${Date.now()}_${index + 1}.${ext}`;
                    } else if (filename.length > 100) { // Prevent excessively long filenames
                        const ext = filename.split('.').pop();
                        filename = `image_${Date.now()}_${index + 1}.${ext}`;
                    }

                    zip.file(filename, blob, { binary: true });
                    downloadedCount++;
                    return filename; // Indicate success
                } catch (fetchError) {
                    console.error(`Error fetching ${url}:`, fetchError);
                    // No need to send error for individual image failures, just console.warn
                    return null; // Mark as failed
                }
            });

            // Wait for all images to be fetched (even if some failed)
            await Promise.all(fetchPromises);

            // Notify about success/failure of individual image fetches before generating zip
            chrome.runtime.sendMessage({ action: 'updateLoading', message: `Fetched ${downloadedCount} of ${imageUrls.length} images. Generating ZIP file...` });


            // Generate the ZIP file
            const sanitizedPageTitle = pageTitle.replace(/[^a-z0-9\s]/gi, '').trim().replace(/\s+/g, '_').toLowerCase(); // More robust sanitization
            const zipFilename = `${sanitizedPageTitle || 'scraped_images'}_${Date.now()}.zip`; // Add timestamp for uniqueness

            const zipBlob = await zip.generateAsync({ type: 'blob' });

            // Download the ZIP file
            const downloadUrl = URL.createObjectURL(zipBlob);
            chrome.downloads.download({
                url: downloadUrl,
                filename: zipFilename,
                saveAs: true // Prompt user for save location
            }, (downloadId) => {
                if (chrome.runtime.lastError) {
                    console.error(`ZIP download failed: ${chrome.runtime.lastError.message}`);
                    chrome.runtime.sendMessage({ action: 'error', message: `Failed to download ZIP: ${chrome.runtime.lastError.message}` });
                } else {
                    console.log(`ZIP download started (ID: ${downloadId})`);
                    chrome.runtime.sendMessage({ action: 'updateLoading', message: 'ZIP download initiated successfully!' });
                    chrome.notifications.create({
                        type: 'basic',
                        iconUrl: 'icons/icon48.png',
                        title: 'ZIP Download Started!', // Changed from 'Complete' as it's just initiated
                        message: `Successfully started download of "${zipFilename}".`,
                        priority: 1
                    });
                }
                URL.revokeObjectURL(downloadUrl); // Clean up the URL object for memory management
            });

            sendResponse({ success: true, message: 'ZIP generation and download initiated.' });

        } catch (zipError) {
            console.error('Error generating ZIP:', zipError);
            chrome.runtime.sendMessage({ action: 'error', message: `Error creating ZIP: ${zipError.message}` });
            sendResponse({ success: false, message: `Error creating ZIP: ${zipError.message}` });
        }
        return true; // Keep the message channel open for async operations
    } else if (request.action === 'themeChanged') {
        // This message is typically from options.js to background.js.
        // If other parts of the extension (like a persistent UI in the future) needed theme updates,
        // you'd forward it here. For now, it's just a confirmation.
        sendResponse({ success: true });
        return true;
    }
});