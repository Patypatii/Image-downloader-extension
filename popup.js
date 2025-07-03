// ImageScraperExtension/popup.js

// Global variables to store scraped data
let currentScrapedImages = [];
let currentScrapedData = null;

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
        loadingMessage.textContent = message; // Corrected: Use loadingMessage
        hideError(); // Clear any previous error
    }

    function hideLoading() {
        loadingIndicator.style.display = 'none'; // Hide loading spinner
        loadingMessage.textContent = ''; // Corrected: Use loadingMessage to clear its text
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
            showLoading(request.message); // Use the centralized showLoading
            sendResponse({ success: true });
        } else if (request.action === 'scrapedData') {
            currentScrapedImages = request.images;
            currentScrapedData = request.data;
            displayResults(currentScrapedImages, currentScrapedData);
            hideLoading(); // Hide loading once data is displayed
            sendResponse({ success: true });
        } else if (request.action === 'error') {
            showError(request.message); // Use the centralized showError
            sendResponse({ success: true });
        } else if (request.action === 'themeChanged') {
            applyTheme(request.theme);
            sendResponse({ success: true });
        }
        // Return true for async sendResponse if needed, but for simple messaging, not always strictly necessary.
        return true;
    });

    // --- UI Event Listeners ---

    scrapeButton.addEventListener('click', () => {
        const url = urlInput.value.trim();
        showLoading(url ? `Scraping ${url}...` : 'Scraping current tab...'); // Show loading immediately

        chrome.runtime.sendMessage({ action: 'scrapeUrl', url: url }, (response) => {
            if (!response || !response.success) {
                showError(`Failed to initiate scraping: ${response ? response.message : 'Unknown error.'}`);
            }
            // Further loading updates will come from background.js via 'updateLoading' message
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
        updateDownloadSelectedButtonVisibility(); // Update button visibility after selection change
    });

    // Download Selected Images (ZIP)
    downloadSelectedButton.addEventListener('click', () => {
        const selectedImages = Array.from(document.querySelectorAll('.image-checkbox:checked'))
            .map(cb => cb.value);

        if (selectedImages.length === 0) {
            showError('No images selected for download.');
            return;
        }

        showLoading(`Initiating ZIP download for ${selectedImages.length} images...`); // Show loading immediately

        chrome.runtime.sendMessage({
            action: 'downloadImagesAsZip', // Action for ZIP download
            urls: selectedImages,
            pageTitle: currentScrapedData ? currentScrapedData.pageTitle : 'scraped_images' // Pass page title
        }, (response) => {
            if (!response || !response.success) {
                showError(`Failed to initiate ZIP download: ${response ? response.message : 'Unknown error.'}`);
            }
            // Further loading updates will come from background.js via 'updateLoading' message
        });
    });

    // Download JSON
    downloadJsonButton.addEventListener('click', () => {
        if (currentScrapedData) {
            const jsonString = JSON.stringify(currentScrapedData, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const filename = `${currentScrapedData.pageTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'scraped_data'}.json`; // Sanitize filename
            chrome.downloads.download({
                url: url,
                filename: filename
            }, () => {
                URL.revokeObjectURL(url); // Clean up the URL object
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
                img.title = src; // Show full URL on hover
                img.onerror = () => { img.src = 'icons/placeholder.png'; img.title = 'Image failed to load: ' + src; }; // Fallback

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.classList.add('image-checkbox');
                checkbox.value = src;
                checkbox.checked = true; // Default to selected
                checkbox.addEventListener('change', updateDownloadSelectedButtonVisibility); // Update button when checkbox changes

                itemDiv.appendChild(img);
                itemDiv.appendChild(checkbox);
                imagePreviews.appendChild(itemDiv);
            });
            updateDownloadSelectedButtonVisibility(); // Ensure button is visible if images are present
        } else {
            imagePreviews.innerHTML = '<p>No images found on this page, or they could not be scraped. Try a different URL or check options.</p>';
            downloadSelectedButton.style.display = 'none'; // Hide if no images
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
        let sortedImages = [...imageUrls]; // Create a copy to sort

        if (sortOrder === 'url-asc') {
            sortedImages.sort((a, b) => a.localeCompare(b));
        } else if (sortOrder === 'url-desc') {
            sortedImages.sort((a, b) => b.localeCompare(a));
        }
        // 'none' means default order, no sort needed

        displayImagePreviews(sortedImages); // Re-render previews based on sorted order
    }

    function displayImagePreviews(imageUrls) {
        imagePreviews.innerHTML = ''; // Clear previous previews
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
                const currentCheckboxes = Array.from(document.querySelectorAll('.image-checkbox'));
                const prevChecked = currentCheckboxes.find(cb => cb.value === src && cb.checked);
                checkbox.checked = prevChecked ? true : true; // Default to checked

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
});