var device = require("device");
var display = require("display");
var keyboard = require("keyboard");
var storage = require("storage");
var wifi = require("wifi");
var memoryStats = device.getFreeHeapSize();

// Color palette
var colours = {
    black: display.color(0, 0, 0),
    grey: display.color(127, 127, 127),
    white: display.color(255, 255, 255),
    green: display.color(0, 255, 0),
    yellow: display.color(255, 255, 0),
    orange: display.color(255, 165, 0),
    red: display.color(255, 0, 0),
    cyan: display.color(0, 255, 255)
};

// Configuration constants
var BASE_URL = "https://raw.githubusercontent.com/BruceDevices/App-Store-Data/refs/heads/main/";
var CATEGORIES_URL = BASE_URL + "releases/categories.json";
var SCRIPTS_DIR = "/BruceJS/", THEMES_DIR = "/Themes/";
var VERSION_FILE = "/BruceAppStore/installed.json";
var CACHE_DIR = "/BruceAppStore/cache/";
var LAST_UPDATED_FILE = "/BruceAppStore/lastUpdated.json";

// Data storage
var availableCategories = [], availableScripts = [], releasesData = {}, installedVersions = {}, updatesAvailable = [];

// Application state
var currentScript = 0, lastCategoryIndex = 0, selectedMenuOption = 0;
var currentView = "categories", selectedCategory = null;
var exitApp = false, isLoadingScripts = false, isLoadingCategories = false, isDownloading = false, showMenu = false;
var popupMessage = "", popupMessageClearTime = 0;
var descriptionScrollOffset = 0, nameScrollOffset = 0, lastScrollTime = 0;
var menuOptions = [], fileSystem = "littlefs";
var dirtyCategories = false, dirtyScripts = false, dirtyActionMenu = false;


// Display configuration
var displayWidth = display.width(), displayHeight = display.height();
var fontScale = displayWidth > 300 ? 1 : 0;
var maxCharacters = Math.trunc(displayWidth / (6 * (fontScale + 1)));
var fontHeight1 = 8 * (1 + fontScale);
var fontHeight2 = 8 * (2 + fontScale);


function checkURL(url) {
    // console.log("Original URL: " + url);
    // console.log("ram_free: " + memoryStats.ram_free);
    // console.log("ram_size: " + memoryStats.ram_size);
    // console.log("ram_min_free: " + memoryStats.ram_min_free);
    // console.log("ram_largest_free_block: " + memoryStats.ram_largest_free_block);
    // console.log("psram_free: " + memoryStats.psram_free);
    // console.log("psram_size: " + memoryStats.psram_size);

    // TODO: Re-enable PSRAM check when fixed
    if (1 == 1 || memoryStats.psram_size == 0) {
        if (url.indexOf("https://raw.githubusercontent.com/BruceDevices/App-Store-Data/refs/heads/main/") !== -1) {
            url = url.replace(
                "https://raw.githubusercontent.com/BruceDevices/App-Store-Data/refs/heads/main/",
                "http://ghp.iceis.co.uk/service/main/"
            );
        }
        else if (url.indexOf("https://raw.githubusercontent.com/") !== -1) {
            url = url.replace(
                "https://raw.githubusercontent.com/",
                "http://ghp.iceis.co.uk/service/manual/"
            );
        }
    }

    // console.log("Modified URL: " + url);
    return url;
}


/**
 * Detect which file system to use based on bruce.conf existence
 */
function detectFileSystem() {
    try {
        var confData = storage.read({ fs: "sd", path: "/bruce.conf" });
        fileSystem = confData ? "sd" : "littlefs";
    } catch (e) {
        fileSystem = "littlefs";
    }
}

/**
 * Clear all cached category files
 */
function clearCacheFiles() {
    try {
        var cacheFiles = storage.readdir({ fs: fileSystem, path: CACHE_DIR });
        for (var i = 0; i < cacheFiles.length; i++) {
            if (cacheFiles[i].indexOf(".json") !== -1) {
                storage.remove({ fs: fileSystem, path: CACHE_DIR + cacheFiles[i] });
            }
        }
        // Remove cache directory if empty
        var remainingFiles = storage.readdir({ fs: fileSystem, path: CACHE_DIR });
        if (remainingFiles.length === 0) {
            storage.remove({ fs: fileSystem, path: CACHE_DIR });
        }
    } catch (e) {
        // Cache directory doesn't exist or other error - ignore
    }
}

/**
 * Clear popup message after a delay
 */
function clearPopupAfterDelay() {
    popupMessageClearTime = now() + 3000;
}

/**
 * Check and clear status message if time expired
 */
function checkPopupClear() {
    if (popupMessageClearTime > 0 && now() >= popupMessageClearTime && popupMessage != "") {
        popupMessage = "";
        if (currentView === "categories") {
            dirtyCategories = true;
        } else if (currentView === "scripts") {
            dirtyScripts = true;
        }
    }
}

/**
 * Update description scrolling for long text
 */
function updateDescriptionScroll() {
    if (popupMessage || showMenu || currentView !== "scripts" ||
        availableScripts.apps.length === 0 || isLoadingScripts || isDownloading ||
        now() - lastScrollTime <= 100) {
        return;
    }

    lastScrollTime = now();
    var script = availableScripts.apps[currentScript];

    // Scroll description if needed
    if (script.description.length > maxCharacters) {
        descriptionScrollOffset = ++descriptionScrollOffset > script.description.length + 10 ? 0 : descriptionScrollOffset;
        updateDescriptionArea(script);
    }

    // Scroll name if needed
    if (script.name.length > maxCharacters) {
        nameScrollOffset = ++nameScrollOffset > script.name.length + 10 ? 0 : nameScrollOffset;
        updateNameArea(script);
    }
}

/**
 * Update only the description area to prevent screen flashing
 */
function updateDescriptionArea(script) {
    var descY = displayHeight / 10 * 5 + ((fontScale + 1) * 3) + 3;

    // Clear and setup display
    display.drawFillRect(0, descY - 10, displayWidth, 20, colours.black);
    display.setTextSize(1 + fontScale);
    display.setTextColor(colours.white);
    display.setTextAlign('center', 'middle');

    // Create and display scrolling text
    var paddedText = script.description + "    ";
    var startPos = descriptionScrollOffset % paddedText.length;
    display.drawText((paddedText + paddedText).substring(startPos, startPos + maxCharacters),
        displayWidth / 2, descY);
}

/**
 * Update only the name area to prevent screen flashing
 */
function updateNameArea(script) {
    var nameY = displayHeight / 10 * 4;

    // Clear and setup display
    display.drawFillRect(0, nameY - 15, displayWidth, 30, colours.black);
    display.setTextSize(2 + fontScale);
    display.setTextColor(colours.green);
    display.setTextAlign('center', 'middle');

    // Create and display scrolling text
    var paddedText = script.name + "    ";
    var startPos = nameScrollOffset % paddedText.length;
    display.drawText((paddedText + paddedText).substring(startPos, startPos + maxCharacters),
        displayWidth / 2, nameY);
}

/**
 * Reset description scroll when changing scripts
 */
function resetDescriptionScroll() {
    descriptionScrollOffset = 0;
    nameScrollOffset = 0;
}

// Detect file system at startup
detectFileSystem();

/**
 * Show action menu for current script
 */
function showActionMenu(script) {
    showMenu = true;
    selectedMenuOption = 0;

    var installed = installedVersions[script.slug];
    //TODO: needs separate function
    if (installed && installed.version) {
        var installedVersion = installed.version;
    } else {
        var installedVersion = null;
    }
    var isInstalled = !!installedVersion;
    var hasUpdate = isInstalled && installedVersion !== script.version;

    menuOptions = isInstalled
        ? (hasUpdate ? ["Update", "Reinstall", "Delete"] : ["Reinstall", "Delete"])
        : ["Install"];

    menuOptions.push("Back");
    dirtyActionMenu = true;
}

/**
 * Hide action menu
 */
function hideActionMenu() {
    showMenu = false;
    dirtyScripts = true;
}

/**
 * Execute selected menu action
 */
function executeMenuAction(script) {
    var action = menuOptions[selectedMenuOption];
    hideActionMenu();

    if (["Install", "Reinstall", "Update"].indexOf(action) !== -1) {
        installScript(script);
    } else if (action === "Delete") {
        deleteScript(script);
    }
}

/**
 * Delete a script
 */
function deleteScript(script) {
    displayInterfaceNew(script.name, "Deleting...", true);
    try {
        var fullMetadata = loadFullMetadata(script);
        var files = fullMetadata.files || [];
        var baseLocalDir = (fullMetadata.category === 'Themes') ? THEMES_DIR : SCRIPTS_DIR;
        var deletedAny = false;

        for (var i = 0; i < files.length; i++) {
            displayInterfaceNew(script.name, "Deleting file " + (i + 1) + " of " + files.length);
            if (files[i] && typeof files[i] === 'object' && files[i].source && files[i].destination) {
                var localFilePath = baseLocalDir + fullMetadata.category + '/' + files[i].destination.replace(/^\/+/, '');
            } else {
                var localFilePath = baseLocalDir + fullMetadata.category + '/' + files[i].replace(/^\/+/, '');
            }

            if (storage.remove({ fs: fileSystem, path: localFilePath })) {
                deletedAny = true;
            }

        }
        displayInterfaceNew(script.name, "Finalizing deletion...");

        if (deletedAny) {
            var filesInDir = storage.readdir({ fs: fileSystem, path: baseLocalDir + fullMetadata.category });
            if (filesInDir.length === 0) {
                storage.remove({ fs: fileSystem, path: baseLocalDir + fullMetadata.category });
            }

            delete installedVersions[script.slug];
            saveInstalledVersions();
            dirtyScripts = true;
            displayInterfaceNew("", "");
            drawScriptView();
            displayPopup("Deleted successfully!");
        } else {
            displayPopup("Failed to delete script files");
        }
    } catch (e) {
        displayPopup("Error deleting script: " + e.message);
    }

    clearPopupAfterDelay();
}

// Load installed versions
loadInstalledVersions();

// Load available categories
loadAvailableCategories();

/**
 * Load available scripts from remote releases.json
 */
function loadAvailableCategories() {
    isLoadingCategories = true;
    displayInterfaceNew("Launching", "Fetching categories...");

    try {
        if (!wifi.connected()) {
            displayPopup("WiFi not connected. Connect via WiFi menu first.");
            isLoadingCategories = false;
            return;
        }
        console.log("Fetching categories from: " + CATEGORIES_URL);
        var url = checkURL(CATEGORIES_URL);
        var response = wifi.httpFetch(url, {
            method: "GET",
            responseType: "json"
        });

        if (response.status === 200) {
            console.log("Successfully fetched categories.json");
            availableCategories = response.body;

            currentView = "categories";

            preloadCategoryFiles();

            createUpdatesCategory();

        } else {
            displayPopup("Failed Loading Scripts (HTTP " + response.status + ")");
        }

    } catch (e3) {
        displayPopup("Network error (C): " + e3.message);
    }
    displayPopup("");
    isLoadingCategories = false;
    dirtyCategories = true;
    displayInterfaceNew();
    clearPopupAfterDelay();
}

/**
 * Preload all category files on startup if not already cached
 */
function preloadCategoryFiles() {
    if (!availableCategories || !availableCategories.categories) return;

    // Load existing category timestamps (as array)
    var storedTimestamps = [];
    try {
        var lastUpdatedData = storage.read({ fs: fileSystem, path: LAST_UPDATED_FILE });
        if (lastUpdatedData) {
            var parsedData = JSON.parse(lastUpdatedData);
            storedTimestamps = parsedData.categories || [];
        }
    } catch (e) {
        // No stored file or invalid, use empty array
    }

    var currentDeviceBoard = device.getBoard();
    var currentResolution = displayWidth + "x" + displayHeight;

    for (var c = 0; c < availableCategories.categories.length; c++) {
        var category = availableCategories.categories[c];
        displayInterfaceNew("Launching", "Processing " + category.name + "...");

        console.log("Processing category: " + category.slug);

        // Skip categories without a slug or updates category
        if (!category.slug || category.slug === "updates") continue;

        var cacheFileName = CACHE_DIR + "category-" + category.slug + ".json";
        var categoryLastUpdated = category.lastUpdated || 0;

        // Find stored timestamp for this category
        var storedLastUpdated = 0;
        var timestampIndex = -1;
        for (var t = 0; t < storedTimestamps.length; t++) {
            if (storedTimestamps[t].slug === category.slug) {
                storedLastUpdated = storedTimestamps[t].lastUpdated || 0;
                timestampIndex = t;
                break;
            }
        }

        // Check if cache file needs to be updated
        var needsDownload = categoryLastUpdated > storedLastUpdated;

        if (!needsDownload) {
            needsDownload = true;
            try {
                var existingCache = storage.read({ fs: fileSystem, path: cacheFileName });
                needsDownload = !existingCache;
            } catch (e_check) {
                needsDownload = true;
            }
        }

        if (needsDownload) {
            try {
                console.log("Downloading category file: category-" + category.slug + ".json (lastUpdated: " + categoryLastUpdated + " > stored: " + storedLastUpdated + ")");
                var url = checkURL(BASE_URL + "releases/category-" + category.slug + ".json");
                var response = wifi.httpFetch(url, {
                    method: "GET",
                    responseType: "json"
                });

                if (response.status === 200) {
                    console.log("Successfully downloaded category-" + category.slug + ".json");
                    var categoryData = response.body;

                    // Apply filtering before caching
                    var filteredApps = [];
                    var isThemesCategory = category.slug === "themes" || (category.name && category.name.toLowerCase().indexOf("theme") !== -1);

                    for (var i = 0; i < categoryData.apps.length; i++) {
                        var app = categoryData.apps[i];
                        var includeApp = true;

                        // Check device compatibility for all apps
                        if (app["supported-devices"] && !isThemesCategory) {
                            var deviceMatches = false;

                            if (typeof app["supported-devices"] === "string") {
                                var regex = new RegExp(app["supported-devices"]);
                                deviceMatches = regex.test(currentDeviceBoard);
                            } else if (app["supported-devices"].length > 0) {
                                for (var d = 0; d < app["supported-devices"].length; d++) {
                                    var pattern = app["supported-devices"][d];
                                    var regex = new RegExp(pattern);
                                    if (regex.test(currentDeviceBoard)) {
                                        deviceMatches = true;
                                        break;
                                    }
                                }
                            }

                            if (!deviceMatches) {
                                includeApp = false;
                            }
                        }

                        // Additional screen size check for themes only
                        if (includeApp && isThemesCategory) {
                            if (app["supported-screen-size"] && app["supported-screen-size"] !== currentResolution) {
                                includeApp = false;
                            }
                        }

                        if (includeApp) {
                            filteredApps.push(app);
                        }
                    }

                    categoryData.apps = filteredApps;
                    categoryData.count = filteredApps.length;

                    // Cache the filtered data
                    try {
                        storage.write({ fs: fileSystem, path: cacheFileName }, JSON.stringify(categoryData, null, 2), "write");

                        // Update stored timestamp for this category immediately after successful save
                        if (timestampIndex >= 0) {
                            storedTimestamps[timestampIndex].lastUpdated = categoryLastUpdated;
                        } else {
                            storedTimestamps.push({
                                slug: category.slug,
                                lastUpdated: categoryLastUpdated
                            });
                        }

                        // Save timestamps immediately after successful cache write
                        try {
                            storage.write({ fs: fileSystem, path: LAST_UPDATED_FILE },
                                JSON.stringify({ categories: storedTimestamps }, null, 2), "write");
                        } catch (e_ts) {
                            // Ignore timestamp save errors
                        }
                    } catch (e2) {
                        // Don't update timestamps if cache write failed
                        console.log("Error saving cache file for category " + category.slug + ": " + e2.message);
                    }
                } else {
                    console.log("Failed to download category-" + category.slug + ".json: HTTP " + response.status);
                }
            } catch (e3) {
                // Log download errors for preloading
                console.log("Error downloading category " + category.slug + ": " + e3.message);
            }
        } else {
            console.log("Category " + category.slug + " is up to date (stored: " + storedLastUpdated + ", remote: " + categoryLastUpdated + ")");
        }
    }
}

/**
 * Load available scripts category
 */
function loadCategory(category) {
    try {
        // WiFi check needed for updates category
        if (category.slug === "updates" && !wifi.connected()) {
            isLoadingScripts = false;
            displayInterfaceNew("WiFi not connected. Connect via WiFi menu first.");
            return;
        }

        if (category.slug === "updates") {
            availableScripts = updatesAvailable;
        } else {
            // Load from cache (should always exist due to preloading)
            var cacheFileName = CACHE_DIR + "category-" + category.slug + ".json";

            try {
                var cachedData = storage.read({ fs: fileSystem, path: cacheFileName });
                if (cachedData) {
                    availableScripts = JSON.parse(cachedData);
                } else {
                    displayPopup("Category data not available. Please restart app.");
                }
            } catch (e1) {
                displayPopup("Error loading category data. Please restart app.");
            }
        }
    } catch (e2) {
        displayPopup("Error loading category: " + e2.message);
    }

    isLoadingScripts = false;
    displayInterfaceNew();
    clearPopupAfterDelay();
}


function loadFullMetadata(script) {
    try {
        var url = checkURL(BASE_URL + 'repositories/' + script.slug.replace(/ /g, '%20') + '/metadata.json');
        var response = wifi.httpFetch(url, {
            method: "GET",
            responseType: "json"
        });
        if (response.status === 200) {
            return response.body;
        }
        displayPopup("Failed Loading Metadata (HTTP " + response.status + ")");
    } catch (e) {
        displayPopup("Network error (B): " + e.message);
    }
}

/**
 * Load installed script versions from file
 */
function loadInstalledVersions() {
    try {
        var versionData = storage.read({ fs: fileSystem, path: VERSION_FILE });
        installedVersions = versionData ? JSON.parse(versionData) : {};
    } catch (e) {
        installedVersions = {};
    }

    if (!installedVersions["BruceDevices/App-Store/App Store"]) {
        installedVersions["BruceDevices/App-Store/App Store"] = {
            version: "0.0.0",
            commit: ""
        };
        saveInstalledVersions();
    }
}

/**
 * Save installed script versions to file and refresh Updates category
 */
function saveInstalledVersions() {
    try {
        storage.write({ fs: fileSystem, path: VERSION_FILE }, JSON.stringify(installedVersions, null, 2), "write");
        if (!isLoadingScripts && releasesData) {
            createUpdatesCategory();
        }
    } catch (e) {
        // Ignore save errors
    }
}

/**
 * Check if script needs update
 */
function needsUpdate(script) {
    var installedVersion = installedVersions[script.slug];
    return installedVersion !== script.version;
}

/**
 * Get status indicator for script
 */
function getScriptStatus(script) {
    var installed = installedVersions[script.slug];
    //TODO: needs separate function
    if (installed && installed.version) {
        var installedVersion = installed.version;
    } else {
        var installedVersion = null;
    }
    if (!installedVersion) return { text: "NOT INSTALLED", color: colours.yellow };
    if (installedVersion !== script.version) return { text: "UPDATE AVAILABLE", color: colours.orange };
    return { text: "UP TO DATE", color: colours.green };
}

/**
 * Helper function to split text into lines that fit within maxCharacters
 */
function splitTextIntoLines(text) {
    // First split by \n, then wrap each line to maxCharacters
    var rawLines = text.split('\n');
    var lines = [];
    for (var l = 0; l < rawLines.length; l++) {
        var segment = rawLines[l];
        if (segment.length <= maxCharacters) {
            lines.push(segment);
        } else {
            var words = segment.split(' '), currentLine = '';
            for (var i = 0; i < words.length; i++) {
                var testLine = currentLine + (currentLine.length > 0 ? ' ' : '') + words[i];
                if (testLine.length <= maxCharacters) {
                    currentLine = testLine;
                } else {
                    if (currentLine.length > 0) {
                        lines.push(currentLine);
                        currentLine = words[i];
                    } else {
                        lines.push(words[i]);
                    }
                }
            }
            if (currentLine.length > 0) lines.push(currentLine);
        }
    }
    return lines;
}

/**
 * Draw popup message with background box
 */
function displayPopup(message) {
    console.log("Display Popup Check: |" + popupMessage + "|" + (message !== undefined ? message : "") + "|");
    var redrawNeeded = false;
    if (message == undefined) {
        //popupMessage = "";
    } else if (popupMessage !== message) {
        if (message != "") {
            var redrawNeeded = true;
        }
        popupMessage = message;
    }
    console.log("Display Popup After Set: |" + popupMessage + "|" + redrawNeeded + "|");
    if (!redrawNeeded) return;
    console.log("Displaying popup: " + popupMessage);
    display.setTextSize(1 + fontScale);
    display.setTextColor(colours.orange);
    display.setTextAlign('center', 'middle');

    var lines = splitTextIntoLines(popupMessage);
    var boxHeight = lines.length * (fontScale + 1) * 8 + 20;
    // Calculate boxWidth based on the longest line's pixel width
    // Calculate width - characters 6px wide at base scale
    var maxLineChars = 0;
    for (var i = 0; i < lines.length; i++) {
        if (lines[i].length > maxLineChars) maxLineChars = lines[i].length;
    }
    var charWidth = 6 * (1 + fontScale); // Per character
    var maxLineWidth = maxLineChars * charWidth;
    var boxWidth = Math.min(displayWidth - 20, maxLineWidth + 40); // Add padding
    var boxX = (displayWidth - boxWidth) / 2;
    var boxY = displayHeight / 2 - boxHeight / 2;

    // Draw box background and border
    display.drawFillRect(boxX, boxY, boxWidth, boxHeight, colours.black);
    display.drawRect(boxX, boxY, boxWidth, boxHeight, colours.orange);

    // Draw text lines
    for (var i = 0; i < lines.length; i++) {
        var textY = boxY + 18 + (i * (fontScale + 1) * 8);
        display.drawText(lines[i], displayWidth / 2, textY);
    }
}

/**
 * Draw action menu
 */
function drawActionMenu() {
    if (dirtyActionMenu) {
        dirtyActionMenu = false;
        if (!showMenu || availableScripts.apps.length === 0) return;

        var menuHeight = menuOptions.length * 16 + 24;
        var menuWidth = Math.min(displayWidth - 40, 200);
        var menuX = (displayWidth - menuWidth) / 2;
        var menuY = (displayHeight - menuHeight) / 2;

        // Draw menu background and border
        display.drawFillRect(menuX, menuY, menuWidth, menuHeight, colours.black);
        display.drawRect(menuX, menuY, menuWidth, menuHeight, colours.white);

        // Draw menu options
        display.setTextSize(1 + fontScale);
        for (var k = 0; k < menuOptions.length; k++) {
            var optionY = menuY + 16 + (k * (fontScale + 1) * 10);
            var optionColor = (k === selectedMenuOption) ? colours.green : colours.grey;
            var prefix = (k === selectedMenuOption) ? "> " : "  ";

            display.setTextColor(optionColor);
            display.setTextAlign('left', 'middle');
            display.drawText(prefix + menuOptions[k], menuX + 10, optionY);
        }
    }
}

/**
 * Draw category view
 */
function drawCategoryView() {
    if (dirtyCategories) {
        dirtyCategories = false;
        console.log("Drawing category view");
        if (availableCategories.totalCategories === 0) {
            drawText("No categories available", 1, "center", "G6", colours.red);
            drawText("Check network connection", 1, "center", "G7", colours.white);
            return;
        }

        if (showMenu) return;

        var categoryName = availableCategories.categories[currentScript].name;
        var totalCategories = availableCategories.totalCategories;
        var totalApps = availableCategories.categories[currentScript].count; // Default from categories.json

        // Try to get actual filtered count from cached category file
        if (categoryName !== "Updates") {
            var categorySlug = availableCategories.categories[currentScript].slug;
            var cacheFileName = CACHE_DIR + "category-" + categorySlug + ".json";
            try {
                var cachedData = storage.read({ fs: fileSystem, path: cacheFileName });
                if (cachedData) {
                    var parsedCache = JSON.parse(cachedData);
                    if (parsedCache.count !== undefined) {
                        totalApps = parsedCache.count; // Use filtered count from cache
                    }
                }
            } catch (e) {
                // Use default count from categories.json if cache read fails
            }
        }

        // Display current category info
        drawText((currentScript + 1) + " of " + totalCategories, 1, "center", "G3", colours.white);

        // Category name with special styling for Updates
        var nameText = categoryName === "Updates" ? "* " + categoryName + " *" : categoryName;
        drawText(nameText, 2, "center", "G5", categoryName === "Updates" ? colours.orange : colours.green);

        // Category description
        var descText = categoryName === "Updates"
            ? totalApps + " Update" + (totalApps === 1 ? "" : "s") + " Available"
            : totalApps + (categoryName === "Theme" ? " theme" : " App") + (totalApps === 1 ? "" : "s");
        drawText(descText, 1, "center", "G7", colours.white);
    }
}

/**
 * Draw script view
 */
function drawScriptView() {
    if (dirtyScripts) {
        dirtyScripts = false;
        display.drawFillRect(0, fontHeight2 + 1, displayWidth, displayHeight, colours.black);
        if (availableScripts.apps.length === 0) {
            drawText("No apps in category", 1, "center", "G4", colours.red);
            drawText("Press ESC to go back", 1, "center", "G6", colours.white);
            return;
        }

        if (showMenu) return;

        var script = availableScripts.apps[currentScript];
        var status = getScriptStatus(script);

        // Show category name and position
        if (selectedCategory) {
            drawText(selectedCategory.name + "      " + (currentScript + 1) + " of " + availableScripts.apps.length, 1, "center", "G2", colours.white);
        }


        // Script name (with scrolling support)
        display.setTextSize(2 + fontScale);
        display.setTextColor(colours.green);
        var nameY = displayHeight / 10 * 4;

        if (script.name.length > maxCharacters) {
            var displayText = script.name + "    ";
            var startPos = nameScrollOffset % displayText.length;
            var scrolledText = displayText.substring(startPos) + displayText.substring(0, startPos);
            var visibleText = scrolledText.substring(0, maxCharacters);
            display.setTextAlign('left', 'middle');
            display.drawText(visibleText, 0, nameY);
        } else {
            display.setTextAlign('center', 'middle');
            display.drawText(script.name, displayWidth / 2, nameY);
        }

        // Script description (with scrolling support)
        display.setTextSize(1 + fontScale);
        display.setTextColor(colours.white);
        var descY = displayHeight / 10 * 5 + ((fontScale + 1) * 3) + 3;

        if (script.description.length > maxCharacters) {
            var displayText = script.description + "    ";
            var startPos = descriptionScrollOffset % displayText.length;
            var scrolledText = displayText.substring(startPos) + displayText.substring(0, startPos);
            var visibleText = scrolledText.substring(0, maxCharacters);
            display.setTextAlign('left', 'middle');
            display.drawText(visibleText, 0, descY);
        } else {
            display.setTextAlign('center', 'middle');
            display.drawText(script.description, displayWidth / 2, descY);
        }

        // Status and version info
        drawText(status.text, 1, "center", "G7", status.color);

        if (script.version !== 'UNKNOWN') {
            var installedVer = "None";
            if (installedVersions[script.slug] && installedVersions[script.slug].version) {
                installedVer = installedVersions[script.slug].version;
            }
            drawText("Available: " + script.version, 1, "center", "G8", colours.grey);

            if (installedVer !== 'None') {
                drawText("Installed: " + installedVer, 1, "center", "G9", colours.grey);
            }
        }

    }
}

/**
 * Display the App Store interface
 */
var appNameShown = false;
var currentStatusLine1 = "";
var currentStatusLine2 = "";

function displayInterfaceNew(statusLine1, statusLine2, forceUpdate) {
    console.log("Display Interface Update: |" + statusLine1 + "|" + statusLine2 + "|");

    if (statusLine1 === undefined) statusLine1 = "";
    if (statusLine2 === undefined) statusLine2 = "";

    if (forceUpdate === undefined) forceUpdate = false;

    if (forceUpdate) {
        display.drawFillRect(0, fontHeight2, displayWidth, displayHeight, colours.black);
    }

    console.log("Display Interface Update: |" + statusLine1 + "|" + statusLine2 + "|");
    if (!showMenu) {
        if (!appNameShown) {
            drawText("Bruce App Store", 2, "center", "G1", BRUCE_PRICOLOR);
            appNameShown = true;
        }
    }

    if (statusLine1 != currentStatusLine1) {
        drawText(statusLine1, 1, "center", "G4", colours.cyan);
        currentStatusLine1 = statusLine1;
    }
    if (statusLine2 != currentStatusLine2) {
        drawText(statusLine2, 1, "center", "G6", colours.white);
        currentStatusLine2 = statusLine2;
    }
}

function drawText(text, size, x, y, textColour) {
    var titleHeight = 8 * (2 + fontScale);
    var titlePaddingBottom = 4;
    var totalRows = 9;
    if (x == "center") {
        x = displayWidth / 2;
    }
    if (y.substring(0, 1) === 'G') {
        var lineNum = parseInt(y.substring(1));
        if (lineNum == 1) {
            y = titleHeight;
        } else {
            y = ((displayHeight - titleHeight - titlePaddingBottom) / (totalRows - 1) * (lineNum - 1)) + titleHeight + titlePaddingBottom;
        }
    }

    display.drawFillRect(0, y - 8 * (size + fontScale), displayWidth, 8 * (size + fontScale), colours.black);
    display.setTextAlign('center', 'bottom');
    display.setTextColor(textColour);
    display.setTextSize(size + fontScale);
    display.drawText(text, x, y);
}

/**
 * Download and install a script
 */
function installScript(script) {
    isDownloading = true;
    console.log("Starting installation of script: " + script.name);
    displayInterfaceNew(script.name, "Connecting...", true);

    try {
        // Check WiFi connection
        if (!wifi.connected()) {
            isDownloading = false;
            displayInterfaceNew("Error", "WiFi not connected");
            return;
        }

        displayInterfaceNew(script.name, "Installing...");
        var success = 0;
        var errors = 0;

        // Download full metadata
        var fullMetadata = loadFullMetadata(script);
        var files = fullMetadata.files || [];
        var baseLocalDir = (fullMetadata.category === 'Themes') ? THEMES_DIR : SCRIPTS_DIR;

        // Loop through the files
        for (var i = 0; i < files.length; i++) {
            if (files[i] && typeof files[i] === 'object' && files[i].source && files[i].destination) {
                var localFilePath = baseLocalDir + fullMetadata.category + '/' + files[i].destination.replace(/^\/+/, '');
                var repoFilePath = (fullMetadata.path + files[i].source).replace(/^\/+/, '');
            } else {
                var localFilePath = baseLocalDir + fullMetadata.category + '/' + files[i].replace(/^\/+/, '');
                var repoFilePath = (fullMetadata.path + files[i]).replace(/^\/+/, '');
            }

            console.log("Downloading file " + (i + 1) + " of " + files.length + ": " + repoFilePath);

            var url = ('https://raw.githubusercontent.com/' + fullMetadata.owner + '/' + fullMetadata.repo + '/' + fullMetadata.commit + '/' + repoFilePath).replace(/ /g, '%20');
            url = checkURL(url);
            var response = wifi.httpFetch(url, {
                save: { fs: fileSystem, path: localFilePath, mode: "write" },
            });
            if (response.status === 200) {
                console.log("Size: " + response.length + " bytes");
                console.log("Saved to: " + localFilePath);
                console.log("Successfully downloaded: " + repoFilePath);
                displayInterfaceNew(script.name, "Downloading " + (i + 1) + " of " + files.length + "...");

                success++;
            } else {
                console.log("Failed to download " + repoFilePath + ": HTTP " + response.status);
                errors++;
                displayInterfaceNew("Error", "Download failed: HTTP " + response.status + " for " + files[i].source);
            }
        }

        // Check if all files were downloaded successfully
        if (success === files.length && errors === 0) {
            installedVersions[script.slug] = {
                version: fullMetadata.version,
                commit: fullMetadata.commit
            };

            saveInstalledVersions();
            dirtyScripts = true;
            displayInterfaceNew("", "");
            drawScriptView();
            displayPopup("Installed successfully!");
        }

    } catch (e) {
        displayInterfaceNew("Error", "Error (A): " + e.message);
    }
    isDownloading = false;
    clearPopupAfterDelay();
}

/**
 * Create an "Updates" category containing apps with available updates
 */
function createUpdatesCategory() {
    try {
        updatesAvailable = { "category": "Updates", "slug": "updates", "count": 0, "apps": [] };

        if (!availableCategories || !availableCategories.categories) return;

        // Go through all cached category files to find apps with updates
        for (var c = 0; c < availableCategories.categories.length; c++) {
            var category = availableCategories.categories[c];
            if (category.slug === "updates") continue; // Skip updates category itself

            var cacheFileName = CACHE_DIR + "category-" + category.slug + ".json";

            try {
                var cachedData = storage.read({ fs: fileSystem, path: cacheFileName });
                if (cachedData) {
                    var categoryData = JSON.parse(cachedData);

                    // Check each app in this category for updates
                    for (var i = 0; i < categoryData.apps.length; i++) {
                        var app = categoryData.apps[i];
                        var installed = installedVersions[app.slug];

                        var installedVersion = null;
                        if (installed && installed.version) {
                            installedVersion = installed.version;
                        }

                        // Check if app is installed and has an update available
                        if (installedVersion && installedVersion !== app.version) {
                            // Check if this app is already in the updates list (avoid duplicates)
                            var alreadyAdded = false;
                            for (var u = 0; u < updatesAvailable.apps.length; u++) {
                                if (updatesAvailable.apps[u].slug === app.slug) {
                                    alreadyAdded = true;
                                    break;
                                }
                            }

                            if (!alreadyAdded) {
                                updatesAvailable.apps.push(app);
                            }
                        }
                    }
                }
            } catch (e1) {
                // Ignore cache read errors for individual categories
            }
        }

        updatesAvailable.count = updatesAvailable.apps.length;

        // Remove existing Updates category if present (pre-ES5 compatible)
        var filteredCategories = [];
        for (var k = 0; k < availableCategories.categories.length; k++) {
            if (availableCategories.categories[k].slug !== "updates") {
                filteredCategories.push(availableCategories.categories[k]);
            }
        }
        availableCategories.categories = filteredCategories;
        availableCategories.totalCategories = availableCategories.categories.length;

        // Add Updates category if there are updates available
        if (updatesAvailable.apps.length > 0) {
            var updateCategory = {
                name: "Updates",
                slug: "updates",
                count: updatesAvailable.count
            };

            // Create new array with Updates category first, then existing categories
            var newCategories = [updateCategory];
            for (var j = 0; j < availableCategories.categories.length; j++) {
                newCategories.push(availableCategories.categories[j]);
            }

            availableCategories.categories = newCategories;
            availableCategories.totalCategories = availableCategories.categories.length;
        }
    } catch (e2) {
        displayPopup("Error creating Updates category: " + e2.message);
    }
}

/**
 * Select a category and load its scripts
 */
function selectCategory(category) {
    lastCategoryIndex = currentScript;
    selectedCategory = category;
    currentView = "scripts";
    currentScript = 0;
    resetDescriptionScroll();

    loadCategory(category);

    dirtyScripts = true;
}

/**
 * Go back to category selection
 */
function goBackToCategories() {
    display.drawFillRect(0, fontHeight2 + 1, displayWidth, displayHeight, colours.black);
    currentView = "categories";
    currentScript = lastCategoryIndex;
    availableScripts = [];
    selectedCategory = null;
    resetDescriptionScroll();
    dirtyCategories = true;
}

// Helper function to handle navigation (next/prev) with wrapping
function handleNavigation(isNext, maxLength, onUpdate) {
    if (maxLength === 0) return;

    currentScript = isNext
        ? (currentScript + 1) % maxLength
        : (currentScript - 1 + maxLength) % maxLength;

    if (onUpdate) onUpdate();
    if (currentView === "categories") {
        dirtyCategories = true;
    } else {
        dirtyScripts = true;
    }
}

// Main application loop
while (!exitApp) {
    // Handle ESC button
    if (keyboard.getEscPress()) {
        if (showMenu) {
            hideActionMenu();
        } else if (currentView === "scripts") {
            goBackToCategories();
        } else {
            exitApp = true;
            break;
        }
    }

    if (!isDownloading) {
        // Clear popupMessage if any button is pressed
        if (popupMessage != "" && (keyboard.getNextPress() || keyboard.getPrevPress() || keyboard.getSelPress() || keyboard.getEscPress())) {
            popupMessage = "";
            popupMessageClearTime = 0;
            if (currentView === "categories") {
                dirtyCategories = true;
            } else {
                dirtyScripts = true;
            }
        } else if (showMenu) {
            // Handle menu navigation
            if (keyboard.getNextPress()) {
                selectedMenuOption = (selectedMenuOption + 1) % menuOptions.length;
                dirtyActionMenu = true;
            } else if (keyboard.getPrevPress()) {
                selectedMenuOption = (selectedMenuOption - 1 + menuOptions.length) % menuOptions.length;
                dirtyActionMenu = true;
            }

            if (keyboard.getSelPress()) {
                executeMenuAction(availableScripts.apps[currentScript]);
            }
        } else if (currentView === "categories") {
            // Handle category navigation
            if (keyboard.getNextPress()) {
                handleNavigation(true, availableCategories.totalCategories);
            } else if (keyboard.getPrevPress()) {
                handleNavigation(false, availableCategories.totalCategories);
            } else if (keyboard.getSelPress() && availableCategories.totalCategories > 0) {
                selectCategory(availableCategories.categories[currentScript]);
            }
        } else {
            // Handle script navigation
            if (keyboard.getNextPress()) {
                handleNavigation(true, availableScripts.apps.length, resetDescriptionScroll);
            } else if (keyboard.getPrevPress()) {
                handleNavigation(false, availableScripts.apps.length, resetDescriptionScroll);
            } else if (keyboard.getSelPress() && availableScripts.apps.length > 0) {
                showActionMenu(availableScripts.apps[currentScript]);
            }
        }
        drawCategoryView();
        drawScriptView();
        drawActionMenu();
    }

    checkPopupClear();
    updateDescriptionScroll();
    delay(50);
}
