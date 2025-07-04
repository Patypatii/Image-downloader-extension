// ImageScraperExtension/popup.js

// Global variables to store scraped data
let currentScrapedImages = [];
let currentScrapedData = null;

// Helper function to convert Base64 string to ArrayBuffer
function base64ToArrayBuffer(base64) {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
}


document.addEventListener('DOMContentLoaded', () => {
    // --- UI Element References ---
    const urlInput = document.getElementById('urlInput');
    const scrapeButton = document.getElementById('scrapeButton');
    const loadingIndicator = document.getElementById('loadingIndicator');
    const loadingMessage = document.getElementById('loadingMessage');
    const errorMessageDiv = document.getElementById('errorMessage');
    const mainContentDiv = document.getElementById('mainContent');
    const imagePreviews = document.getElementById('imagePreviews');
    const jsonDataElement = document.getElementById('jsonData');
    const downloadJsonButton = document.getElementById('downloadJsonButton');
    const reportBugButton = document.getElementById('reportBugButton');
    const sortImagesSelect = document.getElementById('sortImages');
    const selectAllButton = document.getElementById('selectAllButton');
    const downloadSelectedButton = document.getElementById('downloadSelectedButton');

    // --- Utility Functions ---

    function showLoading(message) {
        mainContentDiv.style.display = 'none'; // Hide main content
        loadingIndicator.style.display = 'block'; // Show loading spinner
        loadingMessage.textContent = message;
        hideError(); // Clear any previous error
    }

    function hideLoading() {
        loadingIndicator.style.display = 'none'; // Hide loading spinner
        loadingMessage.textContent = '';
        mainContentDiv.style.display = 'block'; // Show main content
    }

    function showError(message) {
        errorMessageDiv.textContent = message;
        errorMessageDiv.style.display = 'block';
        hideLoading(); // Hide loading if an error occurs
    }

    function hideError() {
        errorMessageDiv.style.display = 'none';
        errorMessageDiv.textContent = '';
    }

    // Function to apply theme (also used in options.js)
    function applyTheme(theme) {
        document.body.classList.remove('light-theme', 'dark-theme');
        document.body.classList.add(theme + '-theme');
    }

    // Load theme on startup
    chrome.storage.sync.get('theme', (data) => {
        applyTheme(data.theme || 'light'); // Default to light
    });

    // --- Message Listeners from Background Script ---
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateLoading') {
            showLoading(request.message);
            sendResponse({ success: true });
        } else if (request.action === 'scrapedData') {
            currentScrapedImages = request.images;
            currentScrapedData = request.data;
            displayResults(currentScrapedImages, currentScrapedData);
            hideLoading();
            sendResponse({ success: true });
        } else if (request.action === 'error') {
            showError(request.message);
            sendResponse({ success: true });
        } else if (request.action === 'themeChanged') {
            applyTheme(request.theme);
            sendResponse({ success: true });
        }
        // --- Handle ZIP download initiation from background script ---
        else if (request.action === 'initiateZipDownloadInPopup') {
            console.log("Popup: Received request to initiate ZIP download.");
            showLoading(`Starting download for ${request.filename}...`);

            // --- NEW: Receive Base64 string and decode it ---
            const base64ZipData = request.base64ZipData;
            const blobType = request.blobType;
            const zipFilename = request.filename;

            // --- DEBUGGING LOGS (keep these for now to confirm fix) ---
            console.log("Popup Debug: Received base64ZipData (length):", base64ZipData ? base64ZipData.length : 'N/A');
            console.log("Popup Debug: Received blobType:", blobType);
            // --- END DEBUGGING LOGS ---

            // Check if we received valid data to reconstruct the Blob
            if (typeof base64ZipData === 'string' && base64ZipData.length > 0 && blobType) {
                // Decode Base64 string back to ArrayBuffer
                const arrayBuffer = base64ToArrayBuffer(base64ZipData);

                // Reconstruct the Blob using the decoded ArrayBuffer and type
                const zipBlob = new Blob([arrayBuffer], { type: blobType });

                // --- DEBUGGING LOG ADDED HERE (check reconstructed Blob) ---
                console.log("Popup Debug: Reconstructed zipBlob:", zipBlob);
                console.log("Popup Debug: Is reconstructed zipBlob an instance of Blob?", zipBlob instanceof Blob);
                // --- END DEBUGGING LOG ---

                const downloadUrl = URL.createObjectURL(zipBlob);

                // --- DEBUGGING LOG ADDED HERE ---
                console.log("Popup Debug: Generated downloadUrl:", downloadUrl);
                // --- END DEBUGGING LOG ---

                chrome.downloads.download({
                    url: downloadUrl,
                    filename: zipFilename,
                    saveAs: true
                }, (downloadId) => {
                    if (chrome.runtime.lastError) {
                        console.error(`Download failed: ${chrome.runtime.lastError.message}`);
                        showError(`Failed to download ZIP: ${chrome.runtime.lastError.message}`);
                    } else {
                        console.log(`Download started (ID: ${downloadId})`);
                        showLoading(`Download of "${zipFilename}" started successfully!`);
                        // For more precise feedback, you could listen to chrome.downloads.onChanged
                        setTimeout(hideLoading, 3000); // Hide loading after 3 seconds for now
                    }
                    URL.revokeObjectURL(downloadUrl); // Clean up the URL object
                    sendResponse({ success: true }); // Acknowledge receipt of this message
                });
            } else {
                showError("Error: Missing or invalid Base64 data or Blob type for download.");
                // Provide more detail in the console for debugging this specific error
                console.error("Popup Error: Blob reconstruction failed. Received:", { base64ZipData: base64ZipData, blobType: blobType });
                sendResponse({ success: false, message: "Missing or invalid data for Blob reconstruction." });
            }
            return true; // Keep port open for async download callback
        }
        return true; // Keep the message channel open for other async responses
    });

    // --- UI Event Listeners ---

    scrapeButton.addEventListener('click', () => {
        const url = urlInput.value.trim();
        showLoading(url ? `Scraping ${url}...` : 'Scraping current tab...');

        chrome.runtime.sendMessage({ action: 'scrapeUrl', url: url }, (response) => {
            if (!response || !response.success) {
                showError(`Failed to initiate scraping: ${response ? response.message : 'Unknown error.'}`);
            }
        });
    });

    // Sort images when select changes
    sortImagesSelect.addEventListener('change', () => {
        sortAndDisplayImages(currentScrapedImages);
    });

    // Select All / Deselect All
    selectAllButton.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.image-checkbox');
        const allSelected = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allSelected);
        updateDownloadSelectedButtonVisibility();
    });

    // Download Selected Images (ZIP)
    downloadSelectedButton.addEventListener('click', () => {
        const selectedImages = Array.from(document.querySelectorAll('.image-checkbox:checked'))
            .map(cb => cb.value);

        if (selectedImages.length === 0) {
            showError('No images selected for download.');
            return;
        }

        showLoading(`Initiating ZIP download for ${selectedImages.length} images...`);

        chrome.runtime.sendMessage({
            action: 'downloadImagesAsZip',
            urls: selectedImages,
            pageTitle: currentScrapedData ? currentScrapedData.pageTitle : 'scraped_images'
        }, (response) => {
            if (!response || !response.success) {
                showError(`Failed to initiate ZIP download: ${response ? response.message : 'Unknown error.'}`);
            }
            // Further loading updates and download initiation will come from background.js
        });
    });

    // Download JSON
    downloadJsonButton.addEventListener('click', () => {
        if (currentScrapedData) {
            const jsonString = JSON.stringify(currentScrapedData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const filename = `${currentScrapedData.pageTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'scraped_data'}.json`;
            chrome.downloads.download({
                url: url,
                filename: filename
            }, () => {
                URL.revokeObjectURL(url);
            });
        } else {
            showError('No JSON data to download.');
        }
    });

    // Report Bug button
    reportBugButton.addEventListener('click', () => {
        const subject = encodeURIComponent("Bug Report: Image Scraper Extension");
        const body = encodeURIComponent(`
        Please describe the bug you encountered:
        [Describe bug here]

        Steps to reproduce:
        1.
        2.
        3.

        Expected behavior:
        Actual behavior:

        Browser: Chrome
        Extension Version: ${chrome.runtime.getManifest().version}
        URL (if applicable): ${currentScrapedData ? currentScrapedData.url : 'N/A'}
        `);
        window.open(`mailto:your.email@example.com?subject=${subject}&body=${body}`); // Replace with your email
    });

    // --- Display & Data Handling Functions ---

    function displayResults(imageUrls, scrapedData) {
        imagePreviews.innerHTML = ''; // Clear existing previews
        if (imageUrls && imageUrls.length > 0) {
            imageUrls.forEach((src) => {
                const itemDiv = document.createElement('div');
                itemDiv.classList.add('image-preview-item');

                const img = document.createElement('img');
                img.src = src;
                img.alt = 'Image preview';
                img.title = src;
                img.onerror = () => { img.src = 'icons/placeholder.png'; img.title = 'Image failed to load: ' + src; };

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.classList.add('image-checkbox');
                checkbox.value = src;
                checkbox.checked = true; // Default to selected
                checkbox.addEventListener('change', updateDownloadSelectedButtonVisibility);

                itemDiv.appendChild(img);
                itemDiv.appendChild(checkbox);
                imagePreviews.appendChild(itemDiv);
            });
            updateDownloadSelectedButtonVisibility();
        } else {
            imagePreviews.innerHTML = '<p>No images found on this page, or they could not be scraped. Try a different URL or check options.</p>';
            downloadSelectedButton.style.display = 'none';
        }

        if (scrapedData) {
            jsonDataElement.textContent = JSON.stringify(scrapedData, null, 2);
            downloadJsonButton.style.display = 'block';
        } else {
            jsonDataElement.textContent = 'No structured data available.';
            downloadJsonButton.style.display = 'none';
        }
    }

    function sortAndDisplayImages(imageUrls) {
        if (!imageUrls || imageUrls.length === 0) return;

        const sortOrder = sortImagesSelect.value;
        let sortedImages = [...imageUrls];

        if (sortOrder === 'url-asc') {
            sortedImages.sort((a, b) => a.localeCompare(b));
        } else if (sortOrder === 'url-desc') {
            sortedImages.sort((a, b) => b.localeCompare(a));
        }

        displayImagePreviews(sortedImages);
    }

    function displayImagePreviews(imageUrls) {
        imagePreviews.innerHTML = '';
        if (imageUrls && imageUrls.length > 0) {
            imageUrls.forEach(src => {
                const itemDiv = document.createElement('div');
                itemDiv.classList.add('image-preview-item');

                const img = document.createElement('img');
                img.src = src;
                img.alt = 'Image preview';
                img.title = src;
                img.onerror = () => { img.src = 'icons/placeholder.png'; img.title = 'Image failed to load: ' + src; };

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.classList.add('image-checkbox');
                checkbox.value = src;

                // Preserve checked state if images are re-rendered after sorting
                checkbox.checked = currentScrapedImages.includes(src);
                if (!checkbox.checked) {
                    checkbox.checked = true;
                }

                checkbox.addEventListener('change', updateDownloadSelectedButtonVisibility);

                itemDiv.appendChild(img);
                itemDiv.appendChild(checkbox);
                imagePreviews.appendChild(itemDiv);
            });
            updateDownloadSelectedButtonVisibility();
        } else {
            imagePreviews.innerHTML = '<p>No images found on this page, or they could not be scraped.</p><p>Try a different URL or check options.</p>';
            downloadSelectedButton.style.display = 'none';
        }
    }

    // New function to control Download Selected button visibility and text
    function updateDownloadSelectedButtonVisibility() {
        const checkedCount = document.querySelectorAll('.image-checkbox:checked').length;
        if (checkedCount > 0) {
            downloadSelectedButton.style.display = 'block';
            downloadSelectedButton.textContent = `Download Selected (${checkedCount})`;
        } else {
            downloadSelectedButton.style.display = 'none';
        }
    }

    // Initial display state when popup opens
    hideLoading();
    hideError();
    // Load initial images if any were scraped from previous session (unlikely for a popup)
    // displayResults(currentScrapedImages, currentScrapedData); // You might want this if you persist state

}); // End of document.addEventListener('DOMContentLoaded'