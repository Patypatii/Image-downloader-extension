// ImageScraperExtension/options.js

document.addEventListener('DOMContentLoaded', () => {
    const scrapeCssBackgroundsCheckbox = document.getElementById('scrapeCssBackgrounds');
    const minImageWidthInput = document.getElementById('minImageWidth');
    const maxScrollsInput = document.getElementById('maxScrolls'); // New
    const themeSelect = document.getElementById('themeSelect');
    const saveButton = document.getElementById('saveOptions');
    const statusDiv = document.getElementById('status');

    // Load saved options
    chrome.storage.sync.get({
        scrapeCssBackgrounds: false,
        minImageWidth: 50,
        maxScrolls: 5, // Default for new option
        theme: 'light' // Default theme
    }, (items) => {
        scrapeCssBackgroundsCheckbox.checked = items.scrapeCssBackgrounds;
        minImageWidthInput.value = items.minImageWidth;
        maxScrollsInput.value = items.maxScrolls; // Set saved value
        themeSelect.value = items.theme;
        applyTheme(items.theme); // Apply theme immediately on options page
    });

    // Save options
    saveButton.addEventListener('click', () => {
        const selectedTheme = themeSelect.value;
        chrome.storage.sync.set({
            scrapeCssBackgrounds: scrapeCssBackgroundsCheckbox.checked,
            minImageWidth: parseInt(minImageWidthInput.value) || 0,
            maxScrolls: parseInt(maxScrollsInput.value) || 0, // Save maxScrolls
            theme: selectedTheme
        }, () => {
            statusDiv.textContent = 'Options saved!';
            applyTheme(selectedTheme); // Apply theme immediately after saving
            // Send message to popup (and potentially background for content script reload) to update its theme
            chrome.runtime.sendMessage({ action: 'themeChanged', theme: selectedTheme });
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 1500);
        });
    });

    // Listen for theme changes in the select dropdown for live preview
    themeSelect.addEventListener('change', () => {
        applyTheme(themeSelect.value);
    });

    function applyTheme(theme) {
        document.body.classList.remove('light-theme', 'dark-theme');
        document.body.classList.add(theme + '-theme');
    }
});