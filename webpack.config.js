const path = require('path');
const CopyPlugin = require('copy-webpack-plugin'); // To copy manifest, html, css, icons

module.exports = {
    mode: 'production', // or 'development' for easier debugging
    entry: {
        background: './background.js', // Your main background script
        popup: './popup.js',           // Your popup script
        content: './content/content.js' // Your content script
    },
    output: {
        filename: '[name].bundle.js', // Output files like background.bundle.js, popup.bundle.js
        path: path.resolve(__dirname, 'dist'), // Output to a 'dist' folder
    },
    resolve: {
        extensions: ['.js']
    },
    plugins: [
        new CopyPlugin({
            patterns: [
                { from: 'manifest.json', to: 'manifest.json' },
                { from: 'popup.html', to: 'popup.html' },
                { from: 'options.html', to: 'options.html' },
                { from: 'style.css', to: 'style.css' },
                { from: 'icons', to: 'icons' }
                // If you have other assets or HTML files, copy them here
            ],
        }),
    ]
    // Add rules for CSS, TypeScript, etc., if needed
};