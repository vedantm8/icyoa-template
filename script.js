let categories = [];
let points = {};
const selectedOptions = {};
const discountedSelections = {};
const openCategories = new Set();
const storyInputs = {};
let currentTab = null; // Track current active tab
let backpackEnabled = false; // Track if backpack is enabled

const openSubcategories = new Set();
let animateMainTab = false;
const subcategoriesToAnimate = new Set();
const attributeSliderValues = {};
let originalPoints = {};
let allowNegativeTypes = new Set();
const dynamicSelections = {};
let attributeRanges = {}; // Will be updated by dynamic effects
let originalAttributeRanges = {}; // Stores the initial, base ranges from input.json
const subcategoryDiscountSelections = {};
const categoryDiscountSelections = {};
const optionGrantDiscountSelections = {};
const selectionHistory = [];
const optionGridLayouts = new Set();
const OPTION_CARD_MIN_WIDTH = 280;
const MOBILE_SINGLE_COLUMN_BREAKPOINT = 768;
const IMAGE_PRELOAD_TIMEOUT_MS = 10000;
const preloadedImageCache = new Map();
let optionGridResizeListenerBound = false;
let optionGridResizeQueued = false;

// Theme State
let isDarkMode = localStorage.getItem('cyoa-dark-mode') === 'true';
const DARK_THEME_VARS = {
    "bg-color": "#0f172a",
    "container-bg": "#1e293b",
    "text-color": "#f1f5f9",
    "text-muted": "#94a3b8",
    "accent-color": "#38bdf8",
    "accent-text": "#ffffff",
    "border-color": "#334155",
    "item-bg": "#334155",
    "item-header-bg": "#475569",
    "points-bg": "#38bdf8",
    "points-border": "#0ea5e9",
    "shadow-color": "rgba(0, 0, 0, 0.4)"
};

function clearObject(obj) {
    if (!obj) return;
    Object.keys(obj).forEach(key => delete obj[key]);
}

function normalizeAssetUrl(url) {
    if (!url || typeof url !== "string") return null;
    const trimmed = url.trim();
    if (!trimmed) return null;
    try {
        return new URL(trimmed, window.location.href).href;
    } catch (_) {
        return null;
    }
}

function walkSubcategoryTree(subcategories, callback, path = []) {
    if (!Array.isArray(subcategories)) return;
    subcategories.forEach((subcat, index) => {
        const nextPath = path.concat([{ index, name: subcat?.name || "" }]);
        callback(subcat, nextPath);
        if (Array.isArray(subcat?.subcategories) && subcat.subcategories.length) {
            walkSubcategoryTree(subcat.subcategories, callback, nextPath);
        }
    });
}

function forEachCategoryOption(category, callback) {
    (category?.options || []).forEach(opt => callback(opt, null));
    walkSubcategoryTree(category?.subcategories || [], subcat => {
        (subcat?.options || []).forEach(opt => callback(opt, subcat));
    });
}

function collectImageAssetUrls(rawData) {
    if (!Array.isArray(rawData)) return [];
    const urls = new Set();

    rawData.forEach(entry => {
        if (entry?.type === "headerImage") {
            const headerUrl = normalizeAssetUrl(entry.url);
            if (headerUrl) urls.add(headerUrl);
        }

        forEachCategoryOption(entry, opt => {
            const imageUrl = normalizeAssetUrl(opt?.image || opt?.img);
            if (imageUrl) urls.add(imageUrl);
        });
    });

    return Array.from(urls);
}

function preloadImage(url, timeoutMs = IMAGE_PRELOAD_TIMEOUT_MS) {
    return new Promise(resolve => {
        const img = new Image();
        let settled = false;

        const settle = () => {
            if (settled) return;
            settled = true;
            img.onload = null;
            img.onerror = null;
            resolve(img);
        };

        const timer = setTimeout(settle, timeoutMs);
        img.onload = () => {
            clearTimeout(timer);
            if (typeof img.decode === "function") {
                img.decode().catch(() => { }).finally(settle);
            } else {
                settle();
            }
        };
        img.onerror = () => {
            clearTimeout(timer);
            settle();
        };
        img.loading = "eager";
        img.decoding = "sync";
        img.src = url;
    });
}

async function preloadCyoaAssets(rawData, {
    onProgress
} = {}) {
    const urls = collectImageAssetUrls(rawData);
    preloadedImageCache.clear();
    if (!urls.length) {
        if (onProgress) onProgress(100, "No image assets to cache.");
        return;
    }

    if (onProgress) onProgress(0, `Caching image assets (0/${urls.length})...`);
    let loadedCount = 0;

    await Promise.allSettled(urls.map(url =>
        preloadImage(url)
            .then(img => {
                if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
                    preloadedImageCache.set(url, img);
                }
            })
            .finally(() => {
                loadedCount += 1;
                const pct = (loadedCount / urls.length) * 100;
                if (onProgress) onProgress(pct, `Caching image assets (${loadedCount}/${urls.length})...`);
            })
    ));

    if (onProgress) onProgress(100, "Image cache primed. Finalizing...");
}

function calculateResponsiveColumnCount(containerWidth, requestedColumns, minCardWidth, columnGap, minColumns = 1) {
    const requested = Math.max(1, requestedColumns);
    const floor = Math.max(1, Math.min(minColumns, requested));
    for (let cols = requested; cols >= floor; cols--) {
        const perColumnWidth = (containerWidth - (columnGap * (cols - 1))) / cols;
        if (perColumnWidth >= minCardWidth) return cols;
    }
    return floor;
}

function updateOptionGridColumns(grid) {
    if (!grid || !grid.isConnected) return;
    const requested = Number.parseInt(grid.dataset.maxColumns || "2", 10);
    const requestedColumns = Number.isFinite(requested) && requested > 0 ? requested : 2;
    const width = grid.clientWidth;
    if (width <= 0) return;

    const styles = window.getComputedStyle(grid);
    const gap = Number.parseFloat(styles.columnGap || styles.gap || "0") || 0;
    const isMobile = window.matchMedia(`(max-width: ${MOBILE_SINGLE_COLUMN_BREAKPOINT}px)`).matches;
    if (isMobile) {
        grid.style.setProperty("--columns-per-row-effective", "1");
        return;
    }
    const minColumns = 1;
    const effectiveColumns = calculateResponsiveColumnCount(width, requestedColumns, OPTION_CARD_MIN_WIDTH, gap, minColumns);
    grid.style.setProperty("--columns-per-row-effective", String(effectiveColumns));
}

function updateAllOptionGridColumns() {
    optionGridLayouts.forEach(grid => {
        if (!grid.isConnected) {
            optionGridLayouts.delete(grid);
            return;
        }
        updateOptionGridColumns(grid);
    });
}

function queueOptionGridResize() {
    if (optionGridResizeQueued) return;
    optionGridResizeQueued = true;
    window.requestAnimationFrame(() => {
        optionGridResizeQueued = false;
        updateAllOptionGridColumns();
    });
}

function registerOptionGrid(grid, maxColumns) {
    const normalizedMax = Number.isFinite(maxColumns) && maxColumns > 0 ? Math.floor(maxColumns) : 2;
    grid.dataset.maxColumns = String(normalizedMax);
    grid.style.setProperty("--columns-per-row", String(normalizedMax));
    optionGridLayouts.add(grid);
    updateOptionGridColumns(grid);

    if (!optionGridResizeListenerBound) {
        window.addEventListener("resize", queueOptionGridResize);
        optionGridResizeListenerBound = true;
    }
}

function resetGlobalState() {
    clearObject(selectedOptions);
    clearObject(discountedSelections);
    clearObject(storyInputs);
    clearObject(attributeSliderValues);
    clearObject(dynamicSelections);
    clearObject(subcategoryDiscountSelections);
    clearObject(categoryDiscountSelections);
    clearObject(optionGrantDiscountSelections);
    openCategories.clear();
    openSubcategories.clear();
    animateMainTab = false;
    subcategoriesToAnimate.clear();
    points = {};
    categories = [];
    selectionHistory.length = 0;

    originalPoints = {};
    attributeRanges = {};
    originalAttributeRanges = {};
    allowNegativeTypes = new Set();
}

function meetsCountRequirement(rawId) {
    if (typeof rawId !== 'string') return false;
    let id = rawId;
    let required = 1;
    if (rawId.includes('__')) {
        const [base, suffix] = rawId.split('__');
        id = base;
        required = Number(suffix) || 1;
    }
    return (selectedOptions[id] || 0) >= required;
}

// Returns the merged base cost for an option, preferring subcategory defaults when present.
function getOptionBaseCost(option) {
    if (!option) return {};
    const info = findSubcategoryInfo(option.id);
    const subDefault = info.subcat?.defaultCost || {};
    const optionCost = option.cost || {};
    if (Object.keys(optionCost).length === 0) {
        return { ...subDefault };
    }
    return { ...optionCost };
}

function getOptionEffectiveCost(option, {
    includeFirstNPreview = true
} = {}) {
    const baseCost = getOptionBaseCost(option);
    let bestCost = baseCost;
    let bestTotal = Object.entries(baseCost).reduce((sum, [_, val]) => val > 0 ? sum + val : sum, 0);

    (option.discounts || []).forEach(d => {
        let qualifies = false;

        // Existing behavior: require ALL of id/ids
        if (d.id || d.ids) {
            const target = d.ids || d.id;
            const requiredIds = Array.isArray(target) ? target : [target];
            if (requiredIds.every(req => meetsCountRequirement(req))) {
                qualifies = true;
            }
        }

        // NEW behavior: require at least N of idsAny
        if (!qualifies && d.idsAny && Number.isInteger(d.minSelected)) {
            const chosenCount = d.idsAny.reduce((n, depId) => n + ((selectedOptions[depId] || 0) > 0 ? 1 : 0), 0);
            if (chosenCount >= d.minSelected) {
                qualifies = true;
            }
        }

        if (!qualifies) return;

        const mergedCost = { ...baseCost, ...(d.cost || {}) };
        const total = Object.entries(mergedCost).reduce((sum, [_, val]) => val > 0 ? sum + val : sum, 0);
        if (total < bestTotal) {
            bestTotal = total;
            bestCost = mergedCost;
        }
    });

    const grantContexts = getActiveOptionGrantContexts(option.id);
    const alreadySelectedThis = selectedOptions[option.id] || 0;
    grantContexts.forEach(ctx => {
        const assignedForThis = ctx.map[option.id] || 0;
        const totalAssigned = getDiscountTotalCount(ctx.map);
        const totalOthers = totalAssigned - assignedForThis;
        const allowedForThis = Math.max(0, Math.min(assignedForThis, ctx.limit - totalOthers));
        if (allowedForThis <= alreadySelectedThis) return;

        const candidate = applyDiscountCost(bestCost, ctx.mode);
        const candidateTotal = Object.entries(candidate).reduce((sum, [_, val]) => val > 0 ? sum + val : sum, 0);
        if (candidateTotal < bestTotal) {
            bestTotal = candidateTotal;
            bestCost = candidate;
        }
    });

    const info = findSubcategoryInfo(option.id);
    let discountApplied = false;
    const allowSubcatDiscount = option.disableSubcategoryDiscount !== true;
    const allowCatDiscount = option.disableCategoryDiscount !== true;
    const subcatHasDiscountAmount = hasDiscountAmount(info.subcat);
    const catHasDiscountAmount = hasDiscountAmount(info.cat);
    const subcatModeTypes = getModeDiscountTypes(info.subcat);
    const catModeTypes = getModeDiscountTypes(info.cat);

    if (!allowSubcatDiscount && info.key) {
        const subMap = getSubcategoryDiscountMap(info.key);
        if (subMap[option.id]) delete subMap[option.id];
    }
    if (!allowCatDiscount && info.catKey) {
        const catMap = getCategoryDiscountMap(info.catKey);
        if (catMap[option.id]) delete catMap[option.id];
    }

    if (includeFirstNPreview) {
        // Support "first N" discount display even when discount config flags aren't present.
        // This mirrors selection behavior where subcat.discountFirstN directly affects the next selections.
        if (!discountApplied && info.subcat && typeof info.subcat.discountFirstN === 'number' && info.subcat.discountFirstN > 0) {
            const subcatSelectionsCount = (info.subcat.options || []).reduce((sum, o) => sum + (selectedOptions[o.id] || 0), 0);
            const remaining = Math.max(0, info.subcat.discountFirstN - subcatSelectionsCount);
            if (remaining > 0) {
                const alreadySelectedThis = selectedOptions[option.id] || 0;
                if (alreadySelectedThis === 0) {
                    if (info.subcat.discountAmount && typeof info.subcat.discountAmount === 'object') {
                        const result = applyDiscountAmount(bestCost, info.subcat.discountAmount);
                        if (result.applied) {
                            bestCost = result.cost;
                            discountApplied = true;
                        }
                    } else {
                        bestCost = applyDiscountCost(bestCost, info.subcat.discountMode || 'half', subcatModeTypes);
                        discountApplied = true;
                    }
                }
            }
        }
    }

    const subcatDiscountActive = allowSubcatDiscount && info.subcat && info.key && canUseDiscount(info.subcat);
    const subcatAutoApplyAll = subcatDiscountActive && shouldAutoApplyDiscount(info.subcat);
    if (subcatDiscountActive) {
        // Determine primary currency and cost for eligibility checks
        const {
            value: primaryCost
        } = getDiscountEligibleCost(baseCost, info.subcat);
        const eligibleUnder = info.subcat.discountEligibleUnder ?? Infinity;

        if (primaryCost !== null && primaryCost > 0 && primaryCost <= eligibleUnder) {
            if (subcatAutoApplyAll) {
                if (subcatHasDiscountAmount) {
                    const result = applyDiscountAmount(bestCost, info.subcat.discountAmount);
                    if (result.applied) {
                        bestCost = result.cost;
                        discountApplied = true;
                    }
                } else {
                    bestCost = applyDiscountCost(bestCost, info.subcat.discountMode, subcatModeTypes);
                    discountApplied = true;
                }
            } else {
                const map = getSubcategoryDiscountMap(info.key);
                const assigned = map[option.id] || 0;
                const alreadySelected = selectedOptions[option.id] || 0;
                if (assigned > alreadySelected) {
                    if (subcatHasDiscountAmount) {
                        const result = applyDiscountAmount(bestCost, info.subcat.discountAmount);
                        if (result.applied) {
                            bestCost = result.cost;
                            discountApplied = true;
                        }
                    } else {
                        bestCost = applyDiscountCost(bestCost, info.subcat.discountMode, subcatModeTypes);
                        discountApplied = true;
                    }
                }
            }
        }

        if (includeFirstNPreview) {
            // If no explicit assignment/auto-apply, consider "first N" display behavior so users see which items would be discounted
            if (!discountApplied && typeof info.subcat.discountFirstN === 'number' && info.subcat.discountFirstN > 0) {
                const subcatSelectionsCount = (info.subcat.options || []).reduce((sum, o) => sum + (selectedOptions[o.id] || 0), 0);
                const remaining = Math.max(0, info.subcat.discountFirstN - subcatSelectionsCount);
                if (remaining > 0) {
                    // If there are remaining discount slots, unselected items should display as discounted
                    const alreadySelectedThis = selectedOptions[option.id] || 0;
                    // Only show the discounted price for an option that hasn't yet been selected (next-instance price)
                    if (alreadySelectedThis === 0) {
                        // Apply discountAmount if present, otherwise fall back to discountMode
                        if (info.subcat.discountAmount && typeof info.subcat.discountAmount === 'object') {
                            const result = applyDiscountAmount(bestCost, info.subcat.discountAmount);
                            if (result.applied) {
                                bestCost = result.cost;
                                discountApplied = true;
                            }
                        } else {
                            bestCost = applyDiscountCost(bestCost, info.subcat.discountMode, subcatModeTypes);
                            discountApplied = true;
                        }
                    }
                }
            }
        }
    }

    const getCategoryOptionSelectionCount = (category) => {
        if (!category) return 0;
        let total = 0;
        forEachCategoryOption(category, opt => {
            total += selectedOptions[opt.id] || 0;
        });
        return total;
    };

    if (includeFirstNPreview) {
        // Support category-level "first N" display even when discount config flags aren't present
        if (!discountApplied && info.cat && typeof info.cat.discountFirstN === 'number' && info.cat.discountFirstN > 0) {
            const catSelectionsCount = getCategoryOptionSelectionCount(info.cat);
            const remaining = Math.max(0, info.cat.discountFirstN - catSelectionsCount);
            if (remaining > 0) {
                const alreadySelectedThis = selectedOptions[option.id] || 0;
                if (alreadySelectedThis === 0) {
                    if (info.cat.discountAmount && typeof info.cat.discountAmount === 'object') {
                        const result = applyDiscountAmount(bestCost, info.cat.discountAmount);
                        if (result.applied) {
                            bestCost = result.cost;
                            discountApplied = true;
                        }
                    } else {
                        bestCost = applyDiscountCost(bestCost, info.cat.discountMode || 'half', catModeTypes);
                        discountApplied = true;
                    }
                }
            }
        }
    }

    const catDiscountActive = !discountApplied && allowCatDiscount && info.cat && info.catKey && canUseDiscount(info.cat);
    const catAutoApplyAll = catDiscountActive && shouldAutoApplyDiscount(info.cat);
    if (catDiscountActive) {
        const {
            value: primaryCost
        } = getDiscountEligibleCost(baseCost, info.cat);
        const eligibleUnder = info.cat.discountEligibleUnder ?? Infinity;

        if (primaryCost !== null && primaryCost > 0 && primaryCost <= eligibleUnder) {
            if (catAutoApplyAll) {
                if (catHasDiscountAmount) {
                    const result = applyDiscountAmount(bestCost, info.cat.discountAmount);
                    if (result.applied) {
                        bestCost = result.cost;
                        discountApplied = true;
                    }
                } else {
                    bestCost = applyDiscountCost(bestCost, info.cat.discountMode, catModeTypes);
                    discountApplied = true;
                }
            } else {
                const map = getCategoryDiscountMap(info.catKey);
                const assigned = map[option.id] || 0;
                const alreadySelected = selectedOptions[option.id] || 0;
                if (assigned > alreadySelected) {
                    if (catHasDiscountAmount) {
                        const result = applyDiscountAmount(bestCost, info.cat.discountAmount);
                        if (result.applied) {
                            bestCost = result.cost;
                            discountApplied = true;
                        }
                    } else {
                        bestCost = applyDiscountCost(bestCost, info.cat.discountMode, catModeTypes);
                        discountApplied = true;
                    }
                }
            }
        }

        // Category-level first-N display behavior (if not already applied)
        if (!discountApplied && typeof info.cat.discountFirstN === 'number' && info.cat.discountFirstN > 0) {
            const catSelectionsCount = getCategoryOptionSelectionCount(info.cat);
            const remaining = Math.max(0, info.cat.discountFirstN - catSelectionsCount);
            if (remaining > 0) {
                const alreadySelectedThis = selectedOptions[option.id] || 0;
                if (alreadySelectedThis === 0) {
                    if (info.cat.discountAmount && typeof info.cat.discountAmount === 'object') {
                        const result = applyDiscountAmount(bestCost, info.cat.discountAmount);
                        if (result.applied) {
                            bestCost = result.cost;
                            discountApplied = true;
                        }
                    } else {
                        bestCost = applyDiscountCost(bestCost, info.cat.discountMode, catModeTypes);
                        discountApplied = true;
                    }
                }
            }
        }
    }

    return bestCost;
}

function getSliderTypes(costPerPoint = {}) {
    let currencyType = null;
    let attributeType = null;

    Object.entries(costPerPoint).forEach(([type, val]) => {
        if (val > 0 && !currencyType) currencyType = type;
        if (val < 0 && !attributeType) attributeType = type;
    });

    if (!currencyType) currencyType = Object.keys(costPerPoint).find(key => key === "Attribute Points") || Object.keys(costPerPoint)[0] || "Attribute Points";
    if (!attributeType) attributeType = Object.keys(costPerPoint).find(key => key !== currencyType) || null;

    return {
        currencyType,
        attributeType
    };
}

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalTextarea = document.getElementById("modalTextarea");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");
const modalClose = document.getElementById("modalClose");
let modalMode = null;
const assetLoadingOverlay = document.getElementById("assetLoadingOverlay");
const assetLoadingMessage = document.getElementById("assetLoadingMessage");
const assetLoadingBar = document.getElementById("assetLoadingBar");
const assetLoadingPercent = document.getElementById("assetLoadingPercent");
const initialTitleText = document.getElementById("cyoaTitle")?.textContent || "";
const initialDescriptionHTML = document.getElementById("cyoaDescription")?.innerHTML || "";
const initialHeaderImageHTML = document.getElementById("headerImageContainer")?.innerHTML || "";

function escapeHtml(text = "") {
    return String(text).replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[ch]);
}

function setMultilineText(element, text = "") {
    if (!element) return;
    element.innerHTML = escapeHtml(text).replace(/\n/g, "<br>");
}

// Event Listeners
document.getElementById("exportBtn").onclick = () => openModal("export");
document.getElementById("importBtn").onclick = () => openModal("import");
document.getElementById("modalClose").onclick = () => closeModal();

document.getElementById("backpackBtn").onclick = () => openBackpackModal();
document.getElementById("backpackModalClose").onclick = () => closeBackpackModal();

document.getElementById("resetBtn").onclick = () => {
    if (!confirm("Are you sure you want to reset all selections?")) return;

    // Refund slider costs
    for (let id in attributeSliderValues) {
        const value = attributeSliderValues[id];
        const option = findOptionById(id);
        if (option && option.costPerPoint) {
            const attrName = Object.keys(option.costPerPoint).find(t => t !== "Attribute Points");
            const costPerPoint = option.costPerPoint["Attribute Points"] || 0;

            let freeBoostAmount = 0;
            // Check if this specific attribute is boosted by a dynamic selection (e.g., Nephilim)
            for (const dynOptId in dynamicSelections) {
                const dynOpt = findOptionById(dynOptId);
                if (dynOpt && dynOpt.dynamicCost) {
                    dynOpt.dynamicCost.choices.forEach((choice, i) => {
                        if (dynamicSelections[dynOptId][i] === attrName && dynOpt.dynamicCost.types[i] === "Boost Attribute") {
                            freeBoostAmount = parseInt(dynOpt.dynamicCost.values[i]);
                        }
                    });
                }
            }

            // Calculate the "paid" portion of the current value
            // Only refund if the value is above the free boost amount
            const paidValue = Math.max(0, value - freeBoostAmount);

            if (costPerPoint > 0 && paidValue > 0) {
                points["Attribute Points"] += costPerPoint * paidValue;
            }
        }
    }

    // Refund selected option costs
    for (let id in selectedOptions) {
        const option = findOptionById(id);
        if (option) {
            const count = selectedOptions[id];
            for (let i = 0; i < count; i++) {
                const refundCost = discountedSelections[id]?.shift() || getOptionBaseCost(option); // Use shift to get the correct instance cost
                Object.entries(refundCost).forEach(([type, cost]) => {
                    points[type] += cost;
                });
            }
        }
    }

    // Clear all tracking objects
    for (let key in selectedOptions) delete selectedOptions[key];
    for (let key in attributeSliderValues) delete attributeSliderValues[key];
    for (let key in discountedSelections) delete discountedSelections[key];
    for (let key in storyInputs) delete storyInputs[key];
    for (let key in dynamicSelections) delete dynamicSelections[key];
    for (let key in subcategoryDiscountSelections) delete subcategoryDiscountSelections[key];
    for (let key in categoryDiscountSelections) delete categoryDiscountSelections[key];
    for (let key in optionGrantDiscountSelections) delete optionGrantDiscountSelections[key];


    // Reset points and attribute ranges to their original states from input.json
    points = {
        ...originalPoints
    };
    attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges)); // Reset ranges to original

    // Re-evaluate formulas to ensure all derived points are correctly reset
    applyDynamicCosts();
    updatePointsDisplay();
    renderAccordion(); // Re-render to show reset state
};


window.onclick = (e) => {
    if (e.target === modal) closeModal();
};

modalConfirmBtn.onclick = () => {
    try {
        const importedData = JSON.parse(modalTextarea.value);

        if (typeof importedData !== 'object' || !importedData.points || !importedData.selectedOptions) {
            throw new Error("Invalid format");
        }

        // Clear current states
        for (let key in selectedOptions) delete selectedOptions[key];
        for (let key in attributeSliderValues) delete attributeSliderValues[key];
        for (let key in discountedSelections) delete discountedSelections[key];
        for (let key in storyInputs) delete storyInputs[key];
        for (let key in dynamicSelections) delete dynamicSelections[key];
        for (let key in subcategoryDiscountSelections) delete subcategoryDiscountSelections[key];
        for (let key in categoryDiscountSelections) delete categoryDiscountSelections[key];
        for (let key in optionGrantDiscountSelections) delete optionGrantDiscountSelections[key];

        // Apply imported states
        points = {
            ...importedData.points
        };
        Object.entries(importedData.selectedOptions).forEach(([key, val]) => {
            selectedOptions[key] = val
        });
        Object.entries(importedData.discountedSelections || {}).forEach(([key, val]) => {
            discountedSelections[key] = val
        });
        Object.entries(importedData.storyInputs || {}).forEach(([key, val]) => {
            storyInputs[key] = val
        });
        Object.entries(importedData.attributeSliderValues || {}).forEach(([key, val]) => {
            attributeSliderValues[key] = val
        });
        Object.entries(importedData.dynamicSelections || {}).forEach(([key, val]) => {
            dynamicSelections[key] = val
        });
        Object.entries(importedData.subcategoryDiscountSelections || {}).forEach(([key, val]) => {
            if (Array.isArray(val)) {
                const map = {};
                val.forEach(id => {
                    map[id] = (map[id] || 0) + 1;
                });
                subcategoryDiscountSelections[key] = map;
            } else if (val && typeof val === 'object') {
                const map = {};
                Object.entries(val).forEach(([id, count]) => {
                    const num = Number(count) || 0;
                    if (num > 0) map[id] = num;
                });
                subcategoryDiscountSelections[key] = map;
            }
        });
        Object.entries(importedData.categoryDiscountSelections || {}).forEach(([key, val]) => {
            if (Array.isArray(val)) {
                const map = {};
                val.forEach(id => {
                    map[id] = (map[id] || 0) + 1;
                });
                categoryDiscountSelections[key] = map;
            } else if (val && typeof val === 'object') {
                const map = {};
                Object.entries(val).forEach(([id, count]) => {
                    const num = Number(count) || 0;
                    if (num > 0) map[id] = num;
                });
                categoryDiscountSelections[key] = map;
            }
        });
        Object.entries(importedData.optionGrantDiscountSelections || {}).forEach(([key, val]) => {
            if (val && typeof val === 'object') {
                const map = {};
                Object.entries(val).forEach(([id, count]) => {
                    const num = Number(count) || 0;
                    if (num > 0) map[id] = num;
                });
                optionGrantDiscountSelections[key] = map;
            }
        });

        // Reset attribute ranges to original before re-applying dynamic effects
        attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges));

        applyDynamicCosts(); // Evaluate formulas after initial points are set and ranges reset
        updatePointsDisplay();
        renderAccordion();
        closeModal();
        alert("Choices imported successfully.");

    } catch (err) {
        alert("Import failed: " + err.message);
    }
};

function openModal(mode) {
    modalMode = mode;
    modal.style.display = "block";
    if (mode === "export") {
        modalTitle.textContent = "Export Your Choices";
        modalTextarea.value = JSON.stringify({
            selectedOptions,
            points,
            discountedSelections,
            storyInputs,
            attributeSliderValues,
            dynamicSelections,
            subcategoryDiscountSelections,
            categoryDiscountSelections,
            optionGrantDiscountSelections,

        }, null, 2);
        modalConfirmBtn.style.display = "none";
    } else {
        modalTitle.textContent = "Import Your Choices";
        modalTextarea.value = "";
        modalConfirmBtn.style.display = "inline-block";
    }
}

function closeModal() {
    modal.style.display = "none";
    modalTextarea.value = "";
    modalMode = null;
}

function setLoadingOverlayVisible(visible) {
    if (!assetLoadingOverlay) return;
    assetLoadingOverlay.classList.toggle("is-visible", !!visible);
}

function updateLoadingOverlay(percent, message) {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    if (assetLoadingBar) {
        assetLoadingBar.style.width = `${clamped}%`;
    }
    if (assetLoadingPercent) {
        assetLoadingPercent.textContent = `${clamped}%`;
    }
    if (assetLoadingMessage && message) {
        assetLoadingMessage.textContent = message;
    }
}


/**
 * Validates the structure and dependencies within the input JSON data.
 * @param {Array<Object>} data - The parsed JSON data from input.json.
 * @param {Object} pointsEntry - The points configuration from input.json.
 * @throws {Error} If any validation error is found.
 */
function validateInputJson(data, pointsEntry) {
    const optionMap = new Map(); // Stores all options by ID for quick lookup
    const dependencyGraph = new Map(); // Stores prerequisites and conflicts for each option
    const errors = [];
    const collectSubcategoryTreeOptions = (subcat) => {
        const list = [];
        walkSubcategoryTree([subcat], node => {
            (node.options || []).forEach(opt => list.push(opt));
        });
        return list;
    };

    // Populate optionMap and dependencyGraph
    data.forEach(entry => {
        forEachCategoryOption(entry, (opt) => {
                if (optionMap.has(opt.id)) {
                    errors.push(`Duplicate option ID found: "${opt.id}"`);
                }
                optionMap.set(opt.id, opt);
                // Fix: Only use Set for array/object prerequisites, not for strings
                let prereqSet;
                if (typeof opt.prerequisites === 'string') {
                    prereqSet = new Set(); // Handled separately in validation
                } else if (Array.isArray(opt.prerequisites)) {
                    prereqSet = new Set(opt.prerequisites);
                } else if (typeof opt.prerequisites === 'object' && opt.prerequisites !== null) {
                    // For AND/OR object style, flatten all values into a set
                    prereqSet = new Set([
                        ...(opt.prerequisites.and || []),
                        ...(opt.prerequisites.or || [])
                    ]);
                } else {
                    prereqSet = new Set();
                }
                dependencyGraph.set(opt.id, {
                    prerequisites: prereqSet,
                    conflicts: new Set(opt.conflictsWith || [])
                });

                (opt.discountGrants || []).forEach((rule, idx) => {
                    const targets = Array.isArray(rule?.targetIds)
                        ? rule.targetIds
                        : (Array.isArray(rule?.targets) ? rule.targets : (rule?.targetId ? [rule.targetId] : []));
                    if (!Array.isArray(targets) || targets.length === 0) {
                        errors.push(`Option "${opt.id}" has discountGrants[${idx}] with no target option IDs.`);
                    }
                    const slots = Number(rule?.slots) || 0;
                    if (slots <= 0) {
                        errors.push(`Option "${opt.id}" has discountGrants[${idx}] with invalid slots value.`);
                    }
                });
            });

        walkSubcategoryTree(entry.subcategories || [], (subcat) => {
            // Handle subcategory-level requiresOption applying to all options in this subcategory tree
            if (subcat?.requiresOption) {
                const requiredItems = Array.isArray(subcat.requiresOption) ? subcat.requiresOption : [subcat.requiresOption];
                collectSubcategoryTreeOptions(subcat).forEach(opt => {
                    const node = dependencyGraph.get(opt.id);
                    if (!node) return;
                    requiredItems.forEach(req => {
                        const looksLikeExpr = (typeof req === 'string') && /[()!&|\s]/.test(req);
                        if (looksLikeExpr) {
                            const existing = node.prerequisites;
                            if (typeof existing === 'string') {
                                node.prerequisites = `(${existing}) && (${req})`;
                            } else {
                                const arr = Array.from(existing || []);
                                if (arr.length === 0) {
                                    node.prerequisites = req;
                                } else {
                                    node.prerequisites = `(${arr.join(' && ')}) && (${req})`;
                                }
                            }
                        } else {
                            if (typeof node.prerequisites === 'string') {
                                node.prerequisites = `(${node.prerequisites}) && (${req})`;
                            } else {
                                node.prerequisites.add(req);
                            }
                        }
                    });
                });
            }
        });

        // Handle category-level requiresOption applying to all its options
        if (entry.requiresOption) {
            const requiredItems = Array.isArray(entry.requiresOption) ? entry.requiresOption : [entry.requiresOption];
            forEachCategoryOption(entry, opt => {
                    const node = dependencyGraph.get(opt.id);
                    if (!node) return;
                    requiredItems.forEach(req => {
                        // If the requiresOption looks like a logical expression (contains operators or parentheses),
                        // treat it as a string prerequisite expression for the node so validation can parse it.
                        const looksLikeExpr = (typeof req === 'string') && /[()!&|\s]/.test(req);
                        if (looksLikeExpr) {
                            const existing = node.prerequisites;
                            if (typeof existing === 'string') {
                                node.prerequisites = `(${existing}) && (${req})`;
                            } else {
                                const arr = Array.from(existing || []);
                                if (arr.length === 0) {
                                    node.prerequisites = req;
                                } else {
                                    node.prerequisites = `(${arr.join(' && ')}) && (${req})`;
                                }
                            }
                        } else {
                            // simple id; add to set (or combine with existing string)
                            if (typeof node.prerequisites === 'string') {
                                node.prerequisites = `(${node.prerequisites}) && (${req})`;
                            } else {
                                node.prerequisites.add(req);
                            }
                        }
                    });
            });
        }
    });

    // Ensure conflicts are reciprocal
    for (let [id, node] of dependencyGraph.entries()) {
        for (let conflictId of node.conflicts) {
            if (!dependencyGraph.has(conflictId)) {
                // If a conflicting option doesn't exist, this is an error
                errors.push(`Option "${id}" conflicts with non-existent option "${conflictId}"`);
                continue;
            }
            // Ensure the conflict is reciprocal
            dependencyGraph.get(conflictId).conflicts.add(id);
        }
    }

    // Validate prerequisites and detect circular dependencies
    function validateOption(id, path = new Set()) {
        if (path.has(id)) {
            errors.push(`Circular prerequisite detected involving "${id}"`);
            return;
        }

        path.add(id);
        const current = dependencyGraph.get(id);

        if (!current) {
            return; // Already reported as missing prerequisite
        }

        // Check for conflicts with its own prerequisites in the current path
        for (let otherId of path) {
            if (otherId === id) continue; // Don't check against itself
            const other = dependencyGraph.get(otherId);
            if (other?.conflicts.has(id) || current.conflicts.has(otherId)) {
                errors.push(`Option "${id}" cannot be selected due to conflict with its prerequisite "${otherId}"`);
            }
        }

        // Handle string-based JS-style prerequisites
        if (typeof current.prerequisites === 'string') {
            // Extract all variable names (option IDs) from the expression
            const ids = current.prerequisites.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
            // Remove JS reserved words and boolean literals
            const reserved = new Set(['true', 'false', 'null', 'undefined', 'if', 'else', 'return', 'let', 'var', 'const', 'function', 'while', 'for', 'do', 'switch', 'case', 'break', 'continue', 'default', 'new', 'this', 'typeof', 'instanceof', 'void', 'delete', 'in', 'of', 'with', 'try', 'catch', 'finally', 'throw', 'class', 'extends', 'super', 'import', 'export', 'from', 'as', 'await', 'async', 'yield']);
            for (let idRef of ids) {
                if (!reserved.has(idRef) && !optionMap.has(idRef)) {
                    errors.push(`Missing prerequisite option ID "${idRef}" for option "${id}"`);
                }
            }
            return; // Do not iterate as array
        }
        // If prerequisites is an array, validate as before
        if (Array.isArray(current.prerequisites)) {
            for (let pre of current.prerequisites) {
                if (!optionMap.has(pre)) {
                    errors.push(`Missing prerequisite "${pre}" for option "${id}"`);
                    continue;
                }
                validateOption(pre, new Set(path)); // Pass a new set for each recursive call
            }
            return;
        }

        for (let pre of current.prerequisites) {
            if (!optionMap.has(pre)) {
                errors.push(`Missing prerequisite "${pre}" for option "${id}"`);
                continue;
            }
            validateOption(pre, new Set(path)); // Pass a new set for each recursive call
        }
    }

    for (let id of optionMap.keys()) {
        validateOption(id);
    }

    for (let [id, opt] of optionMap.entries()) {
        (opt.discountGrants || []).forEach((rule, idx) => {
            const targets = Array.isArray(rule?.targetIds)
                ? rule.targetIds
                : (Array.isArray(rule?.targets) ? rule.targets : (rule?.targetId ? [rule.targetId] : []));
            targets.forEach(targetId => {
                if (!optionMap.has(targetId)) {
                    errors.push(`Option "${id}" has discountGrants[${idx}] target "${targetId}" that does not exist.`);
                }
            });
        });
    }

    if (errors.length > 0) {
        throw new Error("Validation Errors:\n\n" + errors.map(err => `• ${err}`).join("\n\n"));
    }

    // Validate slider attributes against defined points
    const knownAttributes = Object.keys(pointsEntry?.values || {});
    for (const cat of data.filter(e => e.name)) { // Filter for actual categories
        forEachCategoryOption(cat, opt => {
                if (opt.inputType === "slider") {
                    // Find the attribute name that is not "Attribute Points" (if it exists)
                    const attr = Object.keys(opt.costPerPoint || {}).find(t => t !== "Attribute Points");
                    if (attr && !knownAttributes.includes(attr)) {
                        errors.push(`Slider option "${opt.id}" references unknown attribute "${attr}" in its costPerPoint.`);
                    }
                }
        });
    }

    if (errors.length > 0) {
        throw new Error("Validation Errors:\n\n" + errors.map(err => `• ${err}`).join("\n\n"));
    }
}

function applyCyoaData(rawData, {
    silent = false,
    notifyParent = false
} = {}) {
    try {
        if (!Array.isArray(rawData)) {
            throw new Error("CYOA data must be an array.");
        }

        const data = JSON.parse(JSON.stringify(rawData));
        window._lastCyoaData = rawData; // Cache for theme toggle
        const pointsEntry = data.find(entry => entry.type === "points");
        validateInputJson(data, pointsEntry);

        // Apply theme if present
        const themeEntry = data.find(entry => entry.type === "theme");
        const root = document.documentElement;

        function updateRootProperty(key, value) {
            root.style.setProperty(`--${key}`, value);
        }

        const TYPOGRAPHY_KEYS = new Set([
            "font-base",
            "font-title",
            "font-description",
            "font-tab",
            "font-accordion",
            "font-subcategory",
            "font-option-title",
            "font-option-req",
            "font-option-desc",
            "font-story",
            "font-story-input",
            "font-points",
            "font-points-value",
            "font-prereq-help",
            "font-label"
        ]);

        // Default theme variables
        const defaults = {
            "bg-color": "#f9f9f9",
            "container-bg": "#ffffff",
            "text-color": "#333333",
            "text-muted": "#555555",
            "accent-color": "#007acc",
            "accent-text": "#ffffff",
            "border-color": "#dddddd",
            "item-bg": "#f4f4f4",
            "item-header-bg": "#e0e0e0",
            "points-bg": "#f0f0f0",
            "points-border": "#cccccc",
            "shadow-color": "rgba(0, 0, 0, 0.1)",
            "font-base": "16px",
            "font-title": "28px",
            "font-description": "16px",
            "font-tab": "15px",
            "font-accordion": "16px",
            "font-subcategory": "16px",
            "font-option-title": "15px",
            "font-option-req": "13px",
            "font-option-desc": "13px",
            "font-story": "15px",
            "font-story-input": "14px",
            "font-points": "14px",
            "font-points-value": "14px",
            "font-prereq-help": "12px",
            "font-label": "14px"
        };

        if (isDarkMode) {
            Object.entries(DARK_THEME_VARS).forEach(([key, value]) => updateRootProperty(key, value));
        } else {
            // Apply all defaults first as a base
            Object.entries(defaults).forEach(([key, value]) => updateRootProperty(key, value));
        }

        if (themeEntry) {
            Object.entries(themeEntry).forEach(([key, value]) => {
                if (key === "type") return;
                // If in dark mode, only override typography settings from themeEntry
                if (isDarkMode && !TYPOGRAPHY_KEYS.has(key)) return;
                updateRootProperty(key, value);
            });
        }

        updateThemeToggleButton();

        const preservedCategoryOpen = new Set(openCategories);
        const preservedSubcategoryOpen = new Set(openSubcategories);

        resetGlobalState();

        preservedCategoryOpen.forEach(name => openCategories.add(name));
        preservedSubcategoryOpen.forEach(key => openSubcategories.add(key));

        const titleEntry = data.find(entry => entry.type === "title");
        const titleEl = document.getElementById("cyoaTitle");
        if (titleEl) {
            titleEl.textContent = titleEntry?.text || initialTitleText;
        }

        const descriptionEntry = data.find(entry => entry.type === "description");
        const descEl = document.getElementById("cyoaDescription");
        if (descEl) {
            if (descriptionEntry?.text) {
                setMultilineText(descEl, descriptionEntry.text);
            } else {
                descEl.innerHTML = initialDescriptionHTML;
            }
        }

        const headerImageEntry = data.find(entry => entry.type === "headerImage");
        const headerContainer = document.getElementById("headerImageContainer");
        if (headerContainer) {
            if (headerImageEntry?.url) {
                const noUpscaleClass = headerImageEntry.preventUpscale ? ' no-upscale' : '';
                headerContainer.innerHTML = `<img src="${headerImageEntry.url}" alt="Header Image" class="header-image${noUpscaleClass}" />`;
                const imgEl = headerContainer.querySelector('img');
                if (imgEl && imgEl.complete) {
                    imgEl.decode?.().catch(() => { });
                }
            } else {
                headerContainer.innerHTML = initialHeaderImageHTML;
            }
        }

        originalAttributeRanges = pointsEntry?.attributeRanges ? JSON.parse(JSON.stringify(pointsEntry.attributeRanges)) : {};
        attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges));

        allowNegativeTypes = new Set(pointsEntry?.allowNegative || []);
        originalPoints = pointsEntry?.values ? {
            ...pointsEntry.values
        } : {};
        points = {
            ...originalPoints
        };

        categories = data.filter(entry => !entry.type || entry.name);

        // Handle backpack feature
        const backpackEntry = data.find(entry => entry.type === "backpack");
        backpackEnabled = backpackEntry?.enabled || false;
        const backpackBtn = document.getElementById("backpackBtn");
        if (backpackBtn) {
            backpackBtn.style.display = backpackEnabled ? "inline-block" : "none";
        }

        renderAccordion();
        applyDynamicCosts();
        updatePointsDisplay();

        if (notifyParent && window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: "cyoa-data-update-result",
                success: true
            }, "*");
        }

        return true;
    } catch (error) {
        console.error("Failed to apply CYOA data:", error);
        if (!silent) {
            alert("Failed to load CYOA data: " + error.message);
        }
        if (notifyParent && window.parent && window.parent !== window) {
            window.parent.postMessage({
                type: "cyoa-data-update-result",
                success: false,
                error: error?.message || String(error)
            }, "*");
        }
        return false;
    }
}


// Load and parse the input configuration
async function loadConfiguration() {
    const urlParams = new URLSearchParams(window.location.search);
    const selectedCyoa = urlParams.get('cyoa');

    if (selectedCyoa) {
        setLoadingOverlayVisible(true);
        updateLoadingOverlay(5, "Loading CYOA configuration...");
        let loadedSuccessfully = false;
        try {
            const res = await fetch(`CYOAs/${selectedCyoa}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            updateLoadingOverlay(20, "Configuration loaded. Preparing assets...");
            await preloadCyoaAssets(data, {
                onProgress: (pct, message) => {
                    const mapped = 20 + Math.round((pct / 100) * 70);
                    updateLoadingOverlay(mapped, message);
                }
            });
            updateLoadingOverlay(95, "Rendering CYOA interface...");
            if (applyCyoaData(data)) {
                loadedSuccessfully = true;
                updateLoadingOverlay(100, "Ready.");
                setTimeout(() => setLoadingOverlayVisible(false), 150);
                return;
            }
        } catch (err) {
            console.error(`Failed to load CYOA ${selectedCyoa}:`, err);
        } finally {
            if (!loadedSuccessfully) {
                setLoadingOverlayVisible(false);
            }
        }
    }

    // If no CYOA selected or failed to load, show selection modal
    showCyoaSelectionModal();
}

async function fetchCyoaList() {
    try {
        // 1. Try local API first
        const res = await fetch("/api/cyoas");
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        // Ignore API errors
    }

    try {
        // 2. Fallback to manifest.json for static sites
        const res = await fetch("CYOAs/manifest.json");
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {
        console.error("Failed to fetch CYOA list:", e);
    }
    return [];
}

async function showCyoaSelectionModal() {
    const modal = document.getElementById("cyoaSelectionModal");
    const listContainer = document.getElementById("cyoaList");
    modal.style.display = "block";

    const cyoas = await fetchCyoaList();
    listContainer.innerHTML = "";

    if (cyoas.length === 0) {
        listContainer.innerHTML = "<p>No CYOAs found in CYOAs/ directory.</p>";
        return;
    }

    cyoas.forEach(cyoa => {
        const item = document.createElement("div");
        item.className = "cyoa-item";
        item.textContent = cyoa.title || cyoa.filename;
        item.onclick = () => {
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.set('cyoa', cyoa.filename);
            window.location.href = newUrl.toString();
        };
        listContainer.appendChild(item);
    });
}

loadConfiguration().catch(err => {
    console.error("Initialization error:", err);
});

window.addEventListener("message", (event) => {
    if (!event || !event.data || event.data.type !== "cyoa-data-update") return;

    let payload = event.data.payload;
    if (typeof payload === "string") {
        try {
            payload = JSON.parse(payload);
        } catch (parseError) {
            console.error("Failed to parse CYOA payload from message:", parseError);
            if (event.source && typeof event.source.postMessage === "function") {
                event.source.postMessage({
                    type: "cyoa-data-update-result",
                    success: false,
                    error: "Invalid JSON payload"
                }, "*");
            }
            return;
        }
    }

    applyCyoaData(payload, {
        silent: true,
        notifyParent: true
    });
});

window.loadCyoaData = (data, options = {}) => applyCyoaData(data, options);


/**
 * Recursively removes dependent options when a prerequisite is deselected.
 * @param {string} deselectedId - The ID of the option that was deselected.
 */
function removeDependentOptions(deselectedId) {
    for (const cat of categories) {
        forEachCategoryOption(cat, opt => {
            if (prereqReferencesId(opt.prerequisites, deselectedId) && selectedOptions[opt.id]) {
                removeSelection(opt);
                removeDependentOptions(opt.id); // Recursively remove dependents
            }
        });
    }
}

/**
 * Removes all selected options from categories that no longer meet their requirements.
 * This handles the case where a conditional category becomes inactive.
 */
function removeOptionsFromInactiveCategoriesAndSubcategories() {
    const isRequirementMet = (requirement) => {
        if (typeof requirement === 'string' && /[()!&|\s]/.test(requirement)) {
            try {
                return !!window.evaluatePrereqExpr(requirement, id => selectedOptions[id] || 0);
            } catch (e) {
                return false;
            }
        }
        return !!selectedOptions[requirement];
    };

    const removeSelectionsInSubtree = (subcat) => {
        walkSubcategoryTree([subcat], node => {
            (node.options || []).forEach(opt => {
                if (selectedOptions[opt.id]) {
                    removeSelection(opt);
                }
            });
        });
    };

    const enforceSubcategoryRequirements = (subcat) => {
        const subcatRequires = subcat.requiresOption;
        const subcatRequiredItems = Array.isArray(subcatRequires) ? subcatRequires : subcatRequires ? [subcatRequires] : [];
        const subcategoryUnlocked = subcatRequiredItems.every(isRequirementMet);
        if (!subcategoryUnlocked) {
            removeSelectionsInSubtree(subcat);
            return;
        }
        (subcat.subcategories || []).forEach(child => enforceSubcategoryRequirements(child));
    };

    for (const cat of categories) {
        // Check if category-level requirements are met
        const requires = cat.requiresOption;
        const requiredItems = Array.isArray(requires) ? requires : requires ? [requires] : [];
        const categoryUnlocked = requiredItems.every(isRequirementMet);

        // If category is locked, remove all selected options from it
        if (!categoryUnlocked) {
            forEachCategoryOption(cat, opt => {
                if (selectedOptions[opt.id]) {
                    removeSelection(opt);
                }
            });
        } else {
            (cat.subcategories || []).forEach(subcat => enforceSubcategoryRequirements(subcat));
        }
    }
}


/**
 * Removes an option from selectedOptions and refunds its cost.
 * @param {Object} option - The option object to remove.
 */
function removeSelection(option) {
    const scrollY = window.scrollY; // Preserve scroll position

    const count = typeof selectedOptions[option.id] === 'number' ? selectedOptions[option.id] : 1;
    if (!selectedOptions[option.id]) return; // Option not selected

    // Update selection history
    const historyIndex = selectionHistory.indexOf(option.id);
    if (historyIndex !== -1) {
        selectionHistory.splice(historyIndex, 1);
    }

    // Generalized dynamic cost refund for any option with dynamicCost (e.g., attribute cap/boost)
    if (option.dynamicCost && option.dynamicCost.types && option.dynamicCost.values && dynamicSelections[option.id]) {
        // Create a copy to iterate, as dynamicSelections[option.id] might be modified
        const currentDynamicSelections = [...dynamicSelections[option.id]];
        currentDynamicSelections.forEach((choice, i) => {
            if (!choice) return; // Skip if no choice was made for this slot

            const value = option.dynamicCost.values[i];
            const type = option.dynamicCost.types[i];

            if (type === "Cap Attribute") {
                // Revert the cap for the chosen attribute back to its original default max
                const originalDefaultMax = originalAttributeRanges[choice]?.max ?? 40; // Use originalAttributeRanges
                if (attributeRanges[choice]) {
                    attributeRanges[choice].max = originalDefaultMax;
                }
            } else if (type === "Boost Attribute") {
                // When a boost is removed, we need to subtract the boost amount.
                // However, we must ensure the attribute doesn't go below its natural minimum.
                const boostAmount = parseInt(value);
                if (attributeSliderValues.hasOwnProperty(choice)) {
                    attributeSliderValues[choice] -= boostAmount;
                    const min = originalAttributeRanges[choice]?.min ?? 0; // Use original min for natural floor
                    if (attributeSliderValues[choice] < min) {
                        attributeSliderValues[choice] = min;
                    }
                }
            }
        });
        // Clear all dynamic selections for this option
        delete dynamicSelections[option.id];
        // Remove any dynamic point types added by Formula Cost if not in originalPoints
        option.dynamicCost.types.forEach((type, i) => {
            if (type === "Formula Cost") {
                const pointType = option.dynamicCost.choices[i];
                if (!originalPoints.hasOwnProperty(pointType)) {
                    delete points[pointType];
                }
            }
        });
    }


    // Get the last recorded discounted cost for this selection instance
    const refundCost = (discountedSelections[option.id]?.pop()) ?? getOptionBaseCost(option);
    Object.entries(refundCost).forEach(([type, cost]) => {
        points[type] += cost;
    });

    if (option.maxSelections && count > 1) {
        selectedOptions[option.id] = count - 1;
    } else {
        delete selectedOptions[option.id];
        delete discountedSelections[option.id]; // Clear all recorded discounts for this option
        removeDependentOptions(option.id); // Remove any options that depended on this one
    }

    removeOptionsFromInactiveCategoriesAndSubcategories(); // Clear options from categories that no longer meet requirements
    applyDynamicCosts(); // Re-evaluate formulas to reflect changes
    updatePointsDisplay();
    renderAccordion(); // Re-render to update UI elements (sliders, etc.)
    window.scrollTo(0, scrollY); // Restore scroll position
}

/**
 * Evaluates dynamic cost effects like attribute capping and boosting.
 */
function applyDynamicCosts() {
    // IMPORTANT: Reset attribute ranges to their original defaults first
    // This ensures that previous dynamic caps are removed before new ones are applied.
    attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges));

    // --- Reset all dynamic resistance/weakness points to their original values before applying new effects ---
    // Find all point types affected by dynamicCost (e.g., Fire, Frost, etc.)
    const dynamicPointTypes = new Set();
    Object.entries(dynamicSelections).forEach(([optionId, selectedChoices]) => {
        const opt = findOptionById(optionId);
        const config = opt?.dynamicCost;
        if (!config || config.target !== "points") return;
        config.choices.forEach(choice => {
            if (originalPoints.hasOwnProperty(choice)) {
                dynamicPointTypes.add(choice);
            }
        });
    });
    // Reset these points to their original values
    dynamicPointTypes.forEach(type => {
        points[type] = originalPoints[type];
    });

    // Then, apply dynamic selections (like Nephilim's boosts/caps)
    // These modifications should happen *after* base formula evaluation but before final display.
    Object.entries(dynamicSelections).forEach(([optionId, selectedChoices]) => {
        const opt = findOptionById(optionId);
        const config = opt?.dynamicCost;
        if (!config) return;

        const isAttributeTarget = config.target === "attributes";
        const isPointTarget = config.target === "points";

        selectedChoices.forEach((choiceName, i) => {
            if (!choiceName) return; // Skip if no choice is made for this slot

            const value = config.values[i];
            const type = config.types[i];

            // Handle Cap Attribute
            if (type === "Cap Attribute") {
                // Support both static and relative caps
                let cap;
                if (typeof value === "string" && value.startsWith("cap:")) {
                    const capVal = value.slice(4);
                    if (capVal.startsWith("-")) {
                        // Relative reduction: lower the current cap by this amount
                        const reduction = parseInt(capVal);
                        const currentMax = attributeRanges[choiceName]?.max ?? originalAttributeRanges[choiceName]?.max ?? 40;
                        cap = currentMax + reduction;
                    } else {
                        // Static cap
                        cap = parseInt(capVal);
                    }
                } else if (typeof value === "number" && value < 0) {
                    // Relative reduction: lower the current cap by this amount
                    const currentMax = attributeRanges[choiceName]?.max ?? originalAttributeRanges[choiceName]?.max ?? 40;
                    cap = currentMax + value;
                } else {
                    // Static cap
                    cap = parseInt(value);
                }
                if (!attributeRanges[choiceName]) attributeRanges[choiceName] = {};
                attributeRanges[choiceName].max = cap;
                if ((attributeSliderValues[choiceName] ?? 0) > cap) {
                    attributeSliderValues[choiceName] = cap;
                }
            }
            // Handle Boost Attribute
            else if (type === "Boost Attribute" && isAttributeTarget) {
                const boostAmount = parseInt(value);
                if (isNaN(boostAmount)) return;
                if (!attributeSliderValues.hasOwnProperty(choiceName)) {
                    attributeSliderValues[choiceName] = 0;
                }
                if (attributeSliderValues[choiceName] < boostAmount) {
                    attributeSliderValues[choiceName] = boostAmount;
                }
            }
            // Handle Resistance/Weakness for points
            else if (isPointTarget && (type === "Resistance" || type === "Weakness")) {
                if (!points.hasOwnProperty(choiceName)) {
                    points[choiceName] = 0;
                }
                points[choiceName] += parseInt(value);
            }
            // Handle Multiply Attribute
            else if (type === "Multiply Attribute" && isAttributeTarget) {
                const multiplier = parseFloat(value);
                if (isNaN(multiplier)) return;
                // Find the slider value for the attribute (if present)
                // The attributeSliderValues key is usually the lowercased attribute name + 'Attribute'
                // We'll try both the slider and points object
                let baseValue = 0;
                // Try to find the slider key for this attribute
                const sliderKey = Object.keys(attributeSliderValues).find(k => k.toLowerCase().includes(choiceName.toLowerCase()));
                if (sliderKey && attributeSliderValues.hasOwnProperty(sliderKey)) {
                    baseValue = attributeSliderValues[sliderKey];
                } else if (points.hasOwnProperty(choiceName)) {
                    baseValue = points[choiceName];
                }
                // Set the points value to the multiplied value
                points[choiceName] = baseValue * multiplier;
            }
            // Handle Formula Cost for dynamic points (e.g., COIDL)
            else if (isPointTarget && type === "Formula Cost") {
                try {
                    // If the point type doesn't exist, add it
                    if (!points.hasOwnProperty(choiceName)) {
                        points[choiceName] = 0;
                    }
                    // Evaluate the formula in the context of points
                    const evalFunc = new Function("points", `return ${value}`);
                    const result = evalFunc(points);
                    // Add to the current value instead of setting
                    points[choiceName] += result;
                } catch (err) {
                    console.warn(`Failed to evaluate dynamic formula for ${choiceName}:`, err);
                }
            }
        });
    });
}


/**
 * Adds an option to selectedOptions and deducts its cost.
 * Handles maxSelections, subcategory limits, and discounts.
 * @param {Object} option - The option object to add.
 */
function addSelection(option) {
    const scrollY = window.scrollY; // Preserve scroll position
    const current = selectedOptions[option.id] || 0;

    const subcat = findSubcategoryOfOption(option.id);
    const subcatOptions = subcat?.options || [];
    const subcatCount = subcatOptions.reduce((sum, o) => sum + (selectedOptions[o.id] || 0), 0);

    // Determine if this selection is discounted
    let discounted = false;
    if (subcat) {
        if (typeof subcat.discountStartsAfter === 'number') {
            discounted = subcatCount >= subcat.discountStartsAfter;
        } else if (typeof subcat.discountFirstN === 'number') {
            discounted = subcatCount < subcat.discountFirstN;
        } else if (subcat.discountFirstN) { // Fallback for truthy non-number values
            discounted = subcatCount < subcat.discountFirstN;
        }
    }

    const effectiveCost = getOptionEffectiveCost(option, { includeFirstNPreview: false });
    const actualCost = {};
    Object.entries(effectiveCost).forEach(([type, cost]) => {
        let finalCost;
        if (cost < 0) { // If cost is negative (a gain), it's never discounted
            finalCost = cost;
            points[type] -= cost; // Direct addition for gains
        } else {
            const discount = discounted ? (subcat?.discountAmount?.[type] || 0) : 0;
            finalCost = Math.max(0, cost - discount);
            points[type] -= finalCost;
        }
        actualCost[type] = finalCost;
    });

    if (!discountedSelections[option.id]) {
        discountedSelections[option.id] = [];
    }
    discountedSelections[option.id].push(actualCost); // Store the actual cost paid for this instance

    selectedOptions[option.id] = current + 1;
    selectionHistory.push(option.id);

    removeOptionsFromInactiveCategoriesAndSubcategories(); // Clear options from categories that no longer meet requirements
    applyDynamicCosts();
    updatePointsDisplay();
    renderAccordion();
    window.scrollTo(0, scrollY); // Restore scroll position
}

/**
 * Updates the displayed point values in the points tracker.
 */
function updatePointsDisplay() {
    const display = document.getElementById("pointsDisplay");
    display.innerHTML = Object.entries(points)
        .map(([type, val]) => `<span><strong>${type}:</strong> ${val}</span>`)
        .join("");
}

/**
 * Checks if an option can be selected based on its prerequisites, costs, and conflicts.
 * @param {Object} option - The option object to check.
 * @returns {boolean} True if the option can be selected, false otherwise.
 */
function canSelect(option) {
    // String-based logical prerequisites
    let meetsPrereq = true;
    if (typeof option.prerequisites === 'string') {
        try {
            meetsPrereq = window.evaluatePrereqExpr(option.prerequisites, id => selectedOptions[id] || 0);
        } catch (e) {
            console.error('Invalid prerequisite expression:', option.prerequisites, e);
            meetsPrereq = false;
        }
    } else if (Array.isArray(option.prerequisites)) {
        meetsPrereq = option.prerequisites.every(id => selectedOptions[id]);
    } else if (typeof option.prerequisites === 'object') {
        const andList = option.prerequisites.and || [];
        const orList = option.prerequisites.or || [];
        const andMet = andList.every(id => selectedOptions[id]);
        const orMet = orList.length === 0 || orList.some(id => selectedOptions[id]);
        meetsPrereq = andMet && orMet;
    }

    // Check outgoing conflicts (option conflicts with an already selected option)
    const hasNoOutgoingConflicts = !option.conflictsWith || option.conflictsWith.every(id => !selectedOptions[id]);

    // Check incoming conflicts (an already selected option conflicts with this option)
    const hasNoIncomingConflicts = Object.keys(selectedOptions).every(id => {
        const selected = findOptionById(id);
        return !selected?.conflictsWith || !selected.conflictsWith.includes(option.id);
    });

    // Check subcategory limits
    const subcat = findSubcategoryOfOption(option.id);
    const subcatOptions = subcat?.options || [];
    const subcatCount = getSubcategorySelectionCount(subcat, option.id);
    const subcatMax = subcat?.maxSelections || Infinity; // Default to no limit
    // Allow selecting even if at limit, provided there IS a limit (so we can auto-unselect)
    const underSubcatLimit = (subcatCount < subcatMax) || (subcatMax !== Infinity);

    // Check option-specific max selections
    const maxPerOption = option.maxSelections || 1; // Default to 1 selection
    const currentOptionCount = selectedOptions[option.id] || 0;
    const underOptionLimit = currentOptionCount < maxPerOption;
    const categoryMaxSelections = getCategorySelectionLimit(option.id);
    const categorySelectionCount = getCategorySelectionCount(option.id);
    const underCategoryLimit = categorySelectionCount < categoryMaxSelections;

    // Check if enough points (only for positive costs)
    const effectiveCost = getOptionEffectiveCost(option);
    const hasPoints = Object.entries(effectiveCost || {}).every(([type, cost]) => {
        if (cost < 0) return true; // Gains don't require points
        const projected = points[type] - cost;
        return projected >= 0 || allowNegativeTypes.has(type);
    });

    return meetsPrereq && hasPoints && hasNoOutgoingConflicts && hasNoIncomingConflicts && underOptionLimit && underSubcatLimit && underCategoryLimit;
}


/**
 * Finds the subcategory object that contains a given option.
 * @param {string} optionId - The ID of the option to find.
 * @returns {Object|null} The subcategory object, or null if not found.
 */
function findSubcategoryOfOption(optionId) {
    for (const cat of categories) {
        // If options are directly in the category (no subcategories defined)
        if (cat.options && cat.options.some(opt => opt.id === optionId)) {
            return {
                options: cat.options,
                name: cat.name,
                discountFirstN: cat.discountFirstN,
                discountStartsAfter: cat.discountStartsAfter,
                discountAmount: cat.discountAmount,
                maxSelections: cat.maxSelections
            }; // Return a mock subcategory object
        }
        let foundSubcategory = null;
        walkSubcategoryTree(cat.subcategories || [], subcat => {
            if (foundSubcategory) return;
            if ((subcat.options || []).some(opt => opt.id === optionId)) {
                foundSubcategory = subcat;
            }
        });
        if (foundSubcategory) return foundSubcategory;
    }
    return null;
}

function getOptionCountForSubcategoryLimit(option, rawCount) {
    const count = Number(rawCount) || 0;
    if (count <= 0) return 0;
    if (option?.countsAsOneSelection === true) return 1;
    return count;
}

function getSubcategorySelectionCount(subcat, optionIdToIncrement = null) {
    const subcatOptions = subcat?.options || [];
    let total = 0;
    subcatOptions.forEach(opt => {
        const current = selectedOptions[opt.id] || 0;
        const adjustedCount = optionIdToIncrement && opt.id === optionIdToIncrement ? current + 1 : current;
        total += getOptionCountForSubcategoryLimit(opt, adjustedCount);
    });
    return total;
}

function getCategorySelectionCount(optionId) {
    const info = findSubcategoryInfo(optionId);
    const cat = info?.cat;
    if (!cat) return 0;

    let total = 0;
    (cat.options || []).forEach(opt => {
        total += selectedOptions[opt.id] || 0;
    });
    walkSubcategoryTree(cat.subcategories || [], subcat => {
        (subcat.options || []).forEach(opt => {
            total += selectedOptions[opt.id] || 0;
        });
    });
    return total;
}

function getCategorySelectionLimit(optionId) {
    const info = findSubcategoryInfo(optionId);
    const categoryLimit = Number(info?.cat?.maxSelections);
    if (Number.isFinite(categoryLimit) && categoryLimit > 0) {
        return Math.floor(categoryLimit);
    }
    if (info?.cat?.singleSelectionOnly === true) {
        return 1;
    }
    return Infinity;
}


/**
 * Finds an option object by its ID across all categories.
 * @param {string} id - The ID of the option to find.
 * @returns {Object|null} The option object, or null if not found.
 */
function findOptionById(id) {
    for (const cat of categories) {
        // Check options directly within the category
        for (const opt of cat.options || []) {
            if (opt.id === id) return opt;
        }
        // Check options recursively within subcategories
        let found = null;
        walkSubcategoryTree(cat.subcategories || [], subcat => {
            if (found) return;
            for (const opt of subcat.options || []) {
                if (opt.id === id) {
                    found = opt;
                    return;
                }
            }
        });
        if (found) return found;
    }
    return null;
}

/**
 * Ensures a subcategory's selection limit is not exceeded by auto-removing the oldest selection.
 * @param {Object} option - The option being selected.
 */
function ensureSubcategoryLimit(option) {
    const subcat = findSubcategoryOfOption(option.id);
    if (!subcat || subcat.maxSelections === Infinity) return;

    const subcatOptions = subcat.options || [];
    let subcatCount = getSubcategorySelectionCount(subcat, option.id);
    const subcatMax = subcat.maxSelections;
    const subcatOptionIds = new Set(subcatOptions.map(o => o.id));

    while (subcatCount > subcatMax) {
        let removed = false;

        // Prefer removing an instance that immediately reduces subcategory usage.
        for (let i = 0; i < selectionHistory.length; i++) {
            const id = selectionHistory[i];
            if (!subcatOptionIds.has(id)) continue;

            const oldestOption = findOptionById(id);
            const currentCount = selectedOptions[id] || 0;
            if (!oldestOption || currentCount <= 0) continue;

            const before = getOptionCountForSubcategoryLimit(oldestOption, currentCount);
            const after = getOptionCountForSubcategoryLimit(oldestOption, currentCount - 1);
            if (after >= before) continue;

            removeSelection(oldestOption);
            removed = true;
            break;
        }

        // Fallback: remove oldest in subcategory even if this step doesn't immediately reduce usage.
        if (!removed) {
            for (let i = 0; i < selectionHistory.length; i++) {
                const id = selectionHistory[i];
                if (!subcatOptionIds.has(id)) continue;
                const oldestOption = findOptionById(id);
                if (!oldestOption) continue;
                removeSelection(oldestOption);
                removed = true;
                break;
            }
        }

        if (!removed) {
            break;
        }

        subcatCount = getSubcategorySelectionCount(subcat, option.id);
    }
}

/**
 * Gets the label for a given option ID.
 * @param {string} id - The ID of the option.
 * @returns {string} The label of the option, or the ID if not found.
 */
function getOptionLabel(id) {
    const match = findOptionById(id);
    return match ? match.label : id;
}

// Redundant function, can be removed or alias getOptionLabel
function getSubcategoryOptionLabel(id) {
    return getOptionLabel(id);
}

function buildCategoryKey(catIndex, catName) {
    return `${catIndex}-${slugifyKey(catName || `Category${catIndex}`)}`;
}

function slugifyKey(str) {
    return String(str || "").replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
}

function buildSubcategoryKey(catIndex, catName, subIndex, subName, subPath = null) {
    const catPart = `${catIndex}-${slugifyKey(catName || `Category${catIndex}`)}`;
    if (Array.isArray(subPath)) {
        if (!subPath.length) return `${catPart}__-1-root`;
        const pathPart = subPath.map(({ index, name }, depth) => {
            const idx = Number.isFinite(index) ? index : depth;
            return `${idx}-${slugifyKey(name || `Sub${idx}`)}`;
        }).join("__");
        return `${catPart}__${pathPart}`;
    }
    const subPart = `${subIndex}-${slugifyKey(subName || `Sub${subIndex}`)}`;
    return `${catPart}__${subPart}`;
}

function findSubcategoryInfo(optionId) {
    for (let c = 0; c < categories.length; c++) {
        const cat = categories[c];
        const directOptions = cat.options || [];
        if (directOptions.some(opt => opt.id === optionId)) {
            return {
                cat,
                subcat: null,
                key: buildSubcategoryKey(c, cat.name, -1, 'root'),
                catKey: buildCategoryKey(c, cat.name)
            };
        }
        let result = null;
        walkSubcategoryTree(cat.subcategories || [], (sub, path) => {
            if (result) return;
            if ((sub.options || []).some(opt => opt.id === optionId)) {
                result = {
                    cat,
                    subcat: sub,
                    key: buildSubcategoryKey(c, cat.name, null, null, path),
                    catKey: buildCategoryKey(c, cat.name)
                };
            }
        });
        if (result) return result;
    }
    return {
        cat: null,
        subcat: null,
        key: null,
        catKey: null
    };
}

function getDiscountMap(store, key) {
    if (!key) return null;
    if (!store[key]) store[key] = {};
    return store[key];
}

function getSubcategoryDiscountMap(key) {
    return getDiscountMap(subcategoryDiscountSelections, key) || {};
}

function getCategoryDiscountMap(key) {
    return getDiscountMap(categoryDiscountSelections, key) || {};
}

function getDiscountTotalCount(map) {
    return Object.values(map || {}).reduce((sum, val) => sum + (Number(val) || 0), 0);
}

function buildOptionGrantKey(providerId, ruleIndex) {
    return `${providerId}::${ruleIndex}`;
}

function getOptionGrantMap(key) {
    return getDiscountMap(optionGrantDiscountSelections, key) || {};
}

function getGrantTargetIds(rule) {
    if (!rule) return [];
    if (Array.isArray(rule.targetIds)) return rule.targetIds.filter(Boolean);
    if (Array.isArray(rule.targets)) return rule.targets.filter(Boolean);
    if (rule.targetId) return [rule.targetId];
    return [];
}

function getAllOptions() {
    const all = [];
    categories.forEach(cat => {
        forEachCategoryOption(cat, opt => all.push(opt));
    });
    return all;
}

function getActiveOptionGrantContexts(targetOptionId) {
    const contexts = [];
    getAllOptions().forEach(provider => {
        const providerSelections = selectedOptions[provider.id] || 0;
        if (providerSelections <= 0) return;
        (provider.discountGrants || []).forEach((rule, ruleIndex) => {
            const slotsPerSelection = Math.max(0, Number(rule?.slots) || 0);
            if (slotsPerSelection <= 0) return;
            const targetIds = getGrantTargetIds(rule);
            if (!targetIds.includes(targetOptionId)) return;
            const key = buildOptionGrantKey(provider.id, ruleIndex);
            const map = getOptionGrantMap(key);
            contexts.push({
                provider,
                rule,
                ruleIndex,
                key,
                map,
                targetIds,
                limit: providerSelections * slotsPerSelection,
                mode: rule.mode === 'free' ? 'free' : 'half'
            });
        });
    });
    return contexts;
}

function hasDiscountAmount(entity) {
    return !!(entity && entity.discountAmount && typeof entity.discountAmount === 'object' && Object.keys(entity.discountAmount).length > 0);
}

function getDiscountTypes(entity) {
    if (!entity) return [];
    if (Array.isArray(entity.discountTypes) && entity.discountTypes.length) return entity.discountTypes;
    if (hasDiscountAmount(entity)) return Object.keys(entity.discountAmount);
    return [];
}

function getModeDiscountTypes(entity) {
    if (!entity) return null;
    if (Array.isArray(entity.discountTypes) && entity.discountTypes.length) return entity.discountTypes;
    return null;
}

function getDiscountEligibleCost(baseCost = {}, entity) {
    const types = getDiscountTypes(entity);
    if (types.length) {
        for (const type of types) {
            const val = baseCost[type];
            if (typeof val === 'number' && val > 0) {
                return { type, value: val };
            }
        }
        return { type: null, value: null };
    }
    const entry = Object.entries(baseCost).find(([_, val]) => val > 0);
    return entry ? { type: entry[0], value: entry[1] } : { type: null, value: null };
}

function getDiscountTypeLabel(entity, fallback = 'IP') {
    const types = getDiscountTypes(entity);
    if (types.length === 1) return types[0];
    if (types.length > 1) return 'matching points';
    return fallback;
}

function applyDiscountAmount(cost = {}, discountAmount) {
    if (!discountAmount || typeof discountAmount !== 'object') {
        return { cost, applied: false };
    }
    let applied = false;
    const updated = { ...cost };
    Object.entries(discountAmount).forEach(([type, amt]) => {
        if (typeof updated[type] === 'number' && updated[type] > 0 && typeof amt === 'number') {
            const next = Math.max(0, updated[type] - amt);
            if (next !== updated[type]) applied = true;
            updated[type] = next;
        }
    });
    return { cost: updated, applied };
}

function applyDiscountCost(cost = {}, mode = 'half', allowedTypes = null) {
    const updated = { ...cost };
    const typeSet = Array.isArray(allowedTypes) && allowedTypes.length ? new Set(allowedTypes) : null;
    Object.entries(updated).forEach(([type, val]) => {
        if (val > 0 && (!typeSet || typeSet.has(type))) {
            updated[type] = mode === 'free' ? 0 : Math.ceil(val / 2);
        }
    });
    return updated;
}

function evaluateDiscountRequirementNode(node) {
    if (node === null || node === undefined || node === '') return true;

    if (Array.isArray(node)) {
        if (node.length === 0) return true;
        return node.every(evaluateDiscountRequirementNode);
    }

    if (typeof node === 'string') {
        const trimmed = node.trim();
        if (!trimmed) return true;
        const hasLogicalOperators = /[()!&|]/.test(trimmed);
        if (hasLogicalOperators && typeof window !== 'undefined' && typeof window.evaluatePrereqExpr === 'function') {
            try {
                return window.evaluatePrereqExpr(trimmed, id => selectedOptions[id] || 0);
            } catch (err) {
                console.warn('Failed to evaluate discount requirement expression:', trimmed, err);
                return false;
            }
        }
        return meetsCountRequirement(trimmed);
    }

    if (typeof node === 'object') {
        const {
            all,
            any,
            none
        } = node;

        if (all !== undefined) {
            const list = Array.isArray(all) ? all : [all];
            if (!list.every(evaluateDiscountRequirementNode)) return false;
        }

        if (any !== undefined) {
            const list = Array.isArray(any) ? any : [any];
            if (!list.some(evaluateDiscountRequirementNode)) return false;
        }

        if (none !== undefined) {
            const list = Array.isArray(none) ? none : [none];
            if (list.some(evaluateDiscountRequirementNode)) return false;
        }

        return true;
    }

    return true;
}

function evaluateDiscountRequirement(requirement) {
    return evaluateDiscountRequirementNode(requirement);
}

function hasDiscountConfig(entity) {
    return !!(entity && entity.discountSelectionLimit && entity.discountEligibleUnder);
}

function isDiscountUnlocked(entity) {
    if (!entity) return false;
    return evaluateDiscountRequirement(entity.discountRequires);
}

function canUseDiscount(entity) {
    return hasDiscountConfig(entity) && isDiscountUnlocked(entity);
}

function shouldAutoApplyDiscount(entity) {
    return !!(entity && entity.discountAutoApplyAll && canUseDiscount(entity));
}


/**
 * Renders the accordion structure based on the categories data.
 * It creates collapsible sections for categories and subcategories,
 * and displays options within them.
 */
function renderAccordion() {
    const tabNav = document.getElementById("tabNavigation");
    const tabContentContainer = document.getElementById("tabContent");
    tabNav.innerHTML = "";
    tabContentContainer.innerHTML = "";
    optionGridLayouts.clear();

    // Get all non-special categories
    const visibleCategories = categories.filter(cat => !["points", "headerImage", "title", "description", "formulas"].includes(cat.type));

    // Initialize currentTab to first category if not set
    if (!currentTab && visibleCategories.length > 0) {
        currentTab = visibleCategories[0].name;
    }

    // Create tabs
    visibleCategories.forEach((cat) => {
        const tab = document.createElement("button");
        tab.className = "tab-button";
        if (currentTab === cat.name) {
            tab.classList.add("active");
        }
        tab.textContent = cat.name;
        tab.onclick = () => {
            currentTab = cat.name;
            animateMainTab = true; // Trigger animation on tab switch
            renderAccordion();
        };
        tabNav.appendChild(tab);
    });

    // Render content for the active tab
    const activeCategory = categories.find(cat => cat.name === currentTab);
    if (activeCategory && !["points", "headerImage", "title", "description", "formulas"].includes(activeCategory.type)) {
        if (animateMainTab) {
            tabContentContainer.classList.add("animate-fade-in");
            // Remove the class after animation finishes so it doesn't re-trigger on state changes
            tabContentContainer.addEventListener("animationend", () => {
                tabContentContainer.classList.remove("animate-fade-in");
            }, { once: true });
            animateMainTab = false;
        }
        renderCategoryContent(activeCategory);
    }
}

function evaluateRequirementList(requiredItems = []) {
    return requiredItems.every(req => {
        if (typeof req === 'string' && /[()!&|\s]/.test(req)) {
            try {
                return !!window.evaluatePrereqExpr(req, id => selectedOptions[id] || 0);
            } catch (e) {
                return false;
            }
        }
        return !!selectedOptions[req];
    });
}

function buildRequirementsMarkup(requiredItems = []) {
    const lines = [];
    requiredItems.forEach(req => {
        if (typeof req === 'string' && /[()!&|\s]/.test(req)) {
            const rawExpr = req;
            const tokens = rawExpr.match(/\b[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?\b/g) || [];
            let human = rawExpr;
            const seen = new Set();
            tokens.forEach(tok => {
                if (seen.has(tok)) return;
                seen.add(tok);
                const [id] = tok.split('__');
                const label = getOptionLabel(id) || id;
                const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                human = human.replace(new RegExp('\\b' + esc + '\\b', 'g'), `"${label}"`);
            });
            human = human.replace(/\|\|/g, ' OR ').replace(/&&/g, ' AND ').replace(/!/g, 'NOT ');
            const satisfied = (() => { try { return !!window.evaluatePrereqExpr(rawExpr, id => selectedOptions[id] || 0); } catch (_) { return false; } })();
            lines.push(`${satisfied ? '✅' : '❌'} ${human}`);
        } else {
            const id = req;
            const label = getOptionLabel(id);
            lines.push(`${selectedOptions[id] ? "✅" : "❌"} ${label}`);
        }
    });
    return `🔒 Requires:<br>${lines.join("<br>")}`;
}

function getSubcategoryDisplayMode(entity) {
    return entity?.subcategoryDisplayMode === "all" ? "all" : "tabs";
}

function getSubcategoryPathKey(catIndex, catName, path, subcat) {
    return buildSubcategoryKey(catIndex, catName, null, null, path.concat([{ index: path.length ? path[path.length - 1].index : 0, name: subcat?.name || "" }]));
}

function buildChildPath(path, index, child) {
    return path.concat([{ index, name: child?.name || "" }]);
}

function renderSubcategoryTreeNode(subcat, parentContainer, {
    cat,
    catIndex,
    catKey,
    catDiscountUnlocked,
    catAutoApplyAll,
    path
}) {
    const subcatKey = buildSubcategoryKey(catIndex, cat.name, null, null, path);
    const subcatItem = document.createElement("div");
    subcatItem.className = "subcategory-item";

    const subcatContent = document.createElement("div");
    subcatContent.className = "subcategory-content tab-active";

    const subcatTitle = document.createElement("h3");
    subcatTitle.className = "subcategory-content-title";
    subcatTitle.textContent = subcat.name || `Options ${path[path.length - 1]?.index + 1 || 1}`;
    subcatContent.appendChild(subcatTitle);
    subcatItem.appendChild(subcatContent);
    parentContainer.appendChild(subcatItem);

    const subcatRequires = subcat.requiresOption;
    const subcatReqItems = Array.isArray(subcatRequires) ? subcatRequires : subcatRequires ? [subcatRequires] : [];
    const subcatUnlocked = evaluateRequirementList(subcatReqItems);

    if (!subcatUnlocked) {
        const lockMsg = document.createElement("div");
        lockMsg.style.padding = "8px";
        lockMsg.style.color = "#666";
        lockMsg.innerHTML = buildRequirementsMarkup(subcatReqItems);
        subcatContent.appendChild(lockMsg);
        return;
    }

    if (subcat.type === "storyBlock" && subcat.text && subcat.text.trim() !== "") {
        const storyText = document.createElement("div");
        storyText.className = "story-block";
        setMultilineText(storyText, subcat.text);
        subcatContent.appendChild(storyText);
    }

    const subcatHasDiscounts = hasDiscountConfig(subcat);
    const subcatDiscountUnlocked = subcatHasDiscounts && isDiscountUnlocked(subcat);
    const subcatAutoApplyAll = subcatDiscountUnlocked && shouldAutoApplyDiscount(subcat);

    if (subcatHasDiscounts && subcat.discountRequiresMessage) {
        const note = document.createElement("div");
        note.className = "subcategory-discount-requirement";
        note.textContent = `${subcatDiscountUnlocked ? '✅' : '🔒'} ${subcat.discountRequiresMessage}`;
        subcatContent.appendChild(note);
    }

    if (subcatDiscountUnlocked && !subcatAutoApplyAll) {
        const discountInfo = document.createElement("div");
        discountInfo.className = "subcategory-discount-info";
        const subMap = getSubcategoryDiscountMap(subcatKey);
        const usedSlots = getDiscountTotalCount(subMap);
        const subModeLabel = subcat.discountMode === 'free' ? 'free' : 'half-cost';
        discountInfo.textContent = `Discount slots used: ${usedSlots}/${subcat.discountSelectionLimit} (${subModeLabel})`;
        subcatContent.appendChild(discountInfo);
    } else if (subcatDiscountUnlocked && subcatAutoApplyAll) {
        const discountInfo = document.createElement("div");
        discountInfo.className = "subcategory-discount-info";
        const subModeLabel = subcat.discountMode === 'free' ? 'free' : 'half-cost';
        discountInfo.textContent = `Discount auto-applies to eligible items (${subModeLabel}).`;
        subcatContent.appendChild(discountInfo);
    }

    if (subcat.input) {
        const inputWrapper = document.createElement("div");
        inputWrapper.className = "story-input-wrapper";

        if (subcat.input.label) {
            const label = document.createElement("label");
            label.textContent = subcat.input.label;
            label.setAttribute("for", subcat.input.id);
            inputWrapper.appendChild(label);
        }

        const input = document.createElement("input");
        input.type = "text";
        input.id = subcat.input.id;
        input.placeholder = subcat.input.placeholder || "";
        input.maxLength = subcat.input.maxLength || 20;
        input.value = storyInputs[subcat.input.id] || "";
        input.addEventListener("input", (e) => {
            storyInputs[subcat.input.id] = e.target.value;
        });
        inputWrapper.appendChild(input);
        subcatContent.appendChild(inputWrapper);
    }

    renderSubcategoryOptions(subcat, subcatContent, subcatKey, cat, catIndex, catKey, catDiscountUnlocked, catAutoApplyAll);

    renderSubcategoryLevel(subcat, subcat.subcategories || [], subcatContent, {
        cat,
        catIndex,
        catKey,
        catDiscountUnlocked,
        catAutoApplyAll,
        parentPath: path
    });
}

function renderSubcategoryLevel(parentEntity, children, container, {
    cat,
    catIndex,
    catKey,
    catDiscountUnlocked,
    catAutoApplyAll,
    parentPath = []
}) {
    if (!Array.isArray(children) || children.length === 0) return;

    const mode = getSubcategoryDisplayMode(parentEntity);
    const childMeta = children.map((child, idx) => {
        const path = buildChildPath(parentPath, idx, child);
        const key = buildSubcategoryKey(catIndex, cat.name, null, null, path);
        const subcatRequires = child?.requiresOption;
        const reqItems = Array.isArray(subcatRequires) ? subcatRequires : subcatRequires ? [subcatRequires] : [];
        const unlocked = evaluateRequirementList(reqItems);
        return { child, idx, path, key, unlocked };
    });

    if (mode === "tabs" && !childMeta.some(meta => openSubcategories.has(meta.key))) {
        openSubcategories.add(childMeta[0].key);
    }

    if (mode === "tabs" && (children.length > 1 || children.some(child => child?.name))) {
        const nav = document.createElement("div");
        nav.className = "subcategory-navigation";
        childMeta.forEach((meta) => {
            const subButton = document.createElement("button");
            subButton.className = "subcategory-tab-button";
            if (openSubcategories.has(meta.key)) {
                subButton.classList.add("active");
            }
            subButton.textContent = meta.child?.name || `Options ${meta.idx + 1}`;
            if (!meta.unlocked) {
                subButton.classList.add("locked");
                subButton.textContent = `🔒 ${meta.child?.name || `Options ${meta.idx + 1}`}`;
            }
            subButton.onclick = () => {
                if (openSubcategories.has(meta.key)) {
                    openSubcategories.delete(meta.key);
                } else {
                    openSubcategories.add(meta.key);
                    subcategoriesToAnimate.add(meta.key);
                }
                renderAccordion();
            };
            nav.appendChild(subButton);
        });
        container.appendChild(nav);
    }

    const toRender = mode === "all"
        ? childMeta
        : childMeta.filter(meta => openSubcategories.has(meta.key));

    toRender.forEach((meta) => {
        renderSubcategoryTreeNode(meta.child, container, {
            cat,
            catIndex,
            catKey,
            catDiscountUnlocked,
            catAutoApplyAll,
            path: meta.path
        });
    });
}

function renderCategoryContent(cat) {
    const tabContentContainer = document.getElementById("tabContent");
    const catIndex = categories.indexOf(cat);

    const content = document.createElement("div");
    content.className = "category-content";

    if (typeof cat.description === "string" && cat.description.trim() !== "") {
        const catDescription = document.createElement("div");
        catDescription.className = "category-description";
        setMultilineText(catDescription, cat.description);
        content.appendChild(catDescription);
    }

    const requires = cat.requiresOption;
    const requiredItems = Array.isArray(requires) ? requires : requires ? [requires] : [];
    const categoryUnlocked = evaluateRequirementList(requiredItems);

    if (!categoryUnlocked) {
        const lockMsg = document.createElement("div");
        lockMsg.style.padding = "8px";
        lockMsg.style.color = "#666";
        lockMsg.innerHTML = buildRequirementsMarkup(requiredItems);
        content.appendChild(lockMsg);
        tabContentContainer.appendChild(content);
        return;
    }

    const catKey = buildCategoryKey(catIndex, cat.name);
    const catHasDiscounts = hasDiscountConfig(cat);
    const catDiscountUnlocked = catHasDiscounts && isDiscountUnlocked(cat);
    const catAutoApplyAll = catDiscountUnlocked && shouldAutoApplyDiscount(cat);

    if (catHasDiscounts && cat.discountRequiresMessage) {
        const note = document.createElement("div");
        note.className = "category-discount-requirement";
        note.textContent = `${catDiscountUnlocked ? '✅' : '🔒'} ${cat.discountRequiresMessage}`;
        content.appendChild(note);
    }

    if (catDiscountUnlocked) {
        const catInfo = document.createElement("div");
        catInfo.className = "category-discount-info";
        if (catAutoApplyAll) {
            const catModeLabel = cat.discountMode === 'free' ? 'free' : 'half-cost';
            catInfo.textContent = `Category discount auto-applies to eligible items (${catModeLabel}).`;
        } else {
            const catMap = getCategoryDiscountMap(catKey);
            const used = getDiscountTotalCount(catMap);
            const catModeLabel = cat.discountMode === 'free' ? 'free' : 'half-cost';
            const eligibleLabel = getDiscountTypeLabel(cat, 'IP');
            catInfo.textContent = `Category discount slots used: ${used}/${cat.discountSelectionLimit} (eligible items ≤ ${cat.discountEligibleUnder} ${eligibleLabel}, ${catModeLabel})`;
        }
        content.appendChild(catInfo);
    }

    const topLevelSubcats = Array.isArray(cat.subcategories) && cat.subcategories.length
        ? cat.subcategories
        : [{ options: cat.options || [], name: "" }];
    renderSubcategoryLevel(cat, topLevelSubcats, content, {
        cat,
        catIndex,
        catKey,
        catDiscountUnlocked,
        catAutoApplyAll,
        parentPath: []
    });

    tabContentContainer.appendChild(content);
}

function renderSubcategoryOptions(subcat, subcatContent, subcatKey, cat, catIndex, catKey, catDiscountUnlocked, catAutoApplyAll) {
    const subcatHasDiscounts = hasDiscountConfig(subcat);
    const subcatDiscountUnlocked = subcatHasDiscounts && isDiscountUnlocked(subcat);
    const subcatAutoApplyAll = subcatDiscountUnlocked && shouldAutoApplyDiscount(subcat);
    const isDiscountableSubcat = subcatDiscountUnlocked && !subcatAutoApplyAll;

    const grid = document.createElement("div");
    grid.className = "options-grid";
    const rawColumns = Number.parseInt(subcat.columnsPerRow, 10);
    const columnsPerRow = Number.isFinite(rawColumns) && rawColumns > 0 ? rawColumns : 2;
    registerOptionGrid(grid, columnsPerRow);
    subcatContent.appendChild(grid);

    (subcat.options || []).forEach(opt => {
        renderOption(opt, grid, subcat, subcatKey, cat, catIndex, catKey, catDiscountUnlocked, catAutoApplyAll, isDiscountableSubcat);
    });
}

function renderOption(opt, grid, subcat, subcatKey, cat, catIndex, catKey, catDiscountUnlocked, catAutoApplyAll, isDiscountableSubcat) {
    const wrapper = document.createElement("div");
    wrapper.className = "option-wrapper";

    const selectedCount = selectedOptions[opt.id] || 0;
    const maxSelections = opt.maxSelections || 1;
    const isSingleChoice = maxSelections === 1;

    if (isSingleChoice) {
        wrapper.classList.add("is-clickable");
    }
    if (selectedCount > 0) {
        wrapper.classList.add("selected");
    }

    if (isSingleChoice) {
        wrapper.onclick = (e) => {
            // Check if we clicked an interactive element like a discount button
            if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input')) {
                return;
            }
            if (selectedCount > 0) {
                removeSelection(opt);
            } else {
                ensureSubcategoryLimit(opt);
                if (canSelect(opt)) {
                    addSelection(opt);
                }
            }
        };
    }

    const imageUrl = opt.image || opt.img;
    if (imageUrl) {
        const normalizedImageUrl = normalizeAssetUrl(imageUrl);
        const cachedImg = normalizedImageUrl ? preloadedImageCache.get(normalizedImageUrl) : null;
        const img = cachedImg ? cachedImg.cloneNode(true) : document.createElement("img");
        img.loading = "eager";
        img.decoding = "sync";
        if (!cachedImg) {
            img.src = imageUrl;
        }
        img.alt = opt.label;
        wrapper.appendChild(img);
    }

    const contentWrapper = document.createElement("div");
    contentWrapper.className = "option-content";

    const label = document.createElement("strong");
    label.textContent = opt.label;

    const requirements = document.createElement("div");
    requirements.className = "option-requirements";

    // Default display cost is what the next selection would cost (considering discounts)
    const displayCost = getOptionEffectiveCost(opt);
    const originalCost = getOptionBaseCost(opt);

    // If this option is already selected, prefer showing the actual paid cost for the existing instance(s)
    let costToShow = displayCost;
    // selectedCount is already declared above
    if (selectedCount > 0 && discountedSelections[opt.id] && discountedSelections[opt.id].length >= selectedCount) {
        // Show the cost that was actually paid for the last recorded instance
        costToShow = discountedSelections[opt.id][selectedCount - 1] || displayCost;
    }

    const gain = [], spend = [];

    Object.entries(costToShow || {}).forEach(([type, val]) => {
        if (val < 0) {
            gain.push(`${type} ${Math.abs(val)}`);
        } else {
            const orig = originalCost[type];
            if (orig !== undefined && orig !== val) {
                // Show discounted price and original in parentheses
                spend.push(`${type} ${val} (was ${orig})`);
            } else {
                spend.push(`${type} ${val}`);
            }
        }
    });

    if (gain.length) requirements.innerHTML += `Gain: ${gain.join(', ')}<br>`;
    if (spend.length) requirements.innerHTML += `Cost: ${spend.join(', ')}<br>`;

    // Indicate discount availability/applied for this item
    const displayDiffers = Object.entries(displayCost || {}).some(([type, val]) => val !== (originalCost[type] ?? val));
    const currentPaidDiffers = Object.entries(costToShow || {}).some(([type, val]) => val !== (originalCost[type] ?? val));
    const displayShowsFree = Object.entries(displayCost || {}).some(([type, val]) => val === 0 && (originalCost[type] ?? 0) > 0);
    const currentShowsFree = Object.entries(costToShow || {}).some(([type, val]) => val === 0 && (originalCost[type] ?? 0) > 0);

    if (selectedCount > 0 && currentPaidDiffers) {
        // A paid (or free) discount has been applied to an existing selection
        requirements.innerHTML += currentShowsFree ? `🔻 Discount Applied (Free)<br>` : `🔻 Discount Applied<br>`;
    } else if (selectedCount === 0 && displayDiffers) {
        // Discount is available for this item (but not yet used)
        requirements.innerHTML += displayShowsFree ? `🔻 Discount Available (Free)<br>` : `🔻 Discount Available<br>`;
    }

    // Show prerequisites...
    if (opt.prerequisites && opt.prerequisites.length > 0) {
        let prereqLines = [];
        if (typeof opt.prerequisites === 'string') {
            const tokens = opt.prerequisites.match(/!?[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?/g) || [];
            const reserved = new Set(['true', 'false', 'null', 'undefined', 'if', 'else', 'return', 'let', 'var', 'const', 'function', 'while', 'for', 'do', 'switch', 'case', 'break', 'continue', 'default', 'new', 'this', 'typeof', 'instanceof', 'void', 'delete', 'in', 'of', 'with', 'try', 'catch', 'finally', 'throw', 'class', 'extends', 'super', 'import', 'export', 'from', 'as', 'await', 'async', 'yield']);
            const seen = new Set();
            let exprTrue = false;
            try {
                exprTrue = !!window.evaluatePrereqExpr(opt.prerequisites, id => selectedOptions[id] || 0);
            } catch (e) {
                exprTrue = false;
            }
            tokens.forEach(token => {
                const negated = token.startsWith('!');
                const core = negated ? token.slice(1) : token;
                const [id, minSuffix] = core.split('__');
                if (reserved.has(id) || seen.has(core)) return;
                seen.add(core);
                const requiredCount = minSuffix ? Number(minSuffix) : 1;
                let satisfied;
                if (exprTrue) {
                    satisfied = true;
                } else {
                    const actual = selectedOptions[id] || 0;
                    satisfied = negated ? actual < requiredCount : actual >= requiredCount;
                }
                const label = getOptionLabel(id) + (requiredCount > 1 ? ` (x${requiredCount})` : "");
                prereqLines.push(`${satisfied ? "✅" : "❌"} ${label}`);
            });
        } else if (Array.isArray(opt.prerequisites)) {
            prereqLines = opt.prerequisites.map(id => {
                const label = getOptionLabel(id);
                const isSelected = selectedOptions[id];
                const symbol = isSelected ? "✅" : "❌";
                return `${symbol} ${label}`;
            });
        } else if (typeof opt.prerequisites === 'object' && opt.prerequisites !== null) {
            const andList = opt.prerequisites.and || [];
            const orList = opt.prerequisites.or || [];
            let orAccepted = orList.some(id => selectedOptions[id]);
            if (andList.length)
                prereqLines.push(...andList.map(id => {
                    const label = getOptionLabel(id);
                    const isSelected = selectedOptions[id];
                    const symbol = isSelected ? "✅" : "❌";
                    return `${symbol} ${label}`;
                }));
            if (orList.length)
                prereqLines.push(...orList.map(id => {
                    const label = getOptionLabel(id);
                    const symbol = orAccepted ? "✅" : (selectedOptions[id] ? "✅" : "❌");
                    return `${symbol} ${label}`;
                }));
        }
        let prereqHelpTitle = "Prerequisites are checked against selected options. String expressions support &&, ||, and !. When the overall expression evaluates true the UI marks referenced prerequisites as satisfied for clarity.";
        if (typeof opt.prerequisites === 'string') {
            const rawExpr = opt.prerequisites;
            const tokens = rawExpr.match(/\b[a-zA-Z_][a-zA-Z0-9_]*(?:__\d+)?\b/g) || [];
            let human = rawExpr;
            const seenIds = new Set();
            tokens.forEach(tok => {
                const [id] = tok.split('__');
                if (seenIds.has(tok)) return;
                seenIds.add(tok);
                const label = getOptionLabel(id) || id;
                const esc = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                human = human.replace(new RegExp('\\b' + esc + '\\b', 'g'), `"${label}"`);
            });
            human = human.replace(/\|\|/g, ' OR ').replace(/&&/g, ' AND ').replace(/!/g, 'NOT ');
            prereqHelpTitle = `${human}\n\nExpression: ${rawExpr}`;
        }
        const helpHtml = `<span class=\"prereq-help\" title=\"${prereqHelpTitle.replace(/\"/g, '&quot;')}\">?</span>`;
        requirements.innerHTML += `🔒 Requires: ${helpHtml}<br>${prereqLines.join("<br>")}`;

        if (opt.conflictsWith && Array.isArray(opt.conflictsWith) && opt.conflictsWith.length > 0) {
            const conflictLines = opt.conflictsWith.map(id => {
                const label = getOptionLabel(id) || id;
                const selected = !!selectedOptions[id];
                const symbol = selected ? '❌' : '✅';
                return `${symbol} ${label}`;
            });
            requirements.innerHTML += `<br>⚠️ Incompatible With:<br>${conflictLines.join("<br>")}`;
        }
    }

    if ((!requirements.innerHTML || !requirements.innerHTML.includes('Incompatible With')) && opt.conflictsWith && Array.isArray(opt.conflictsWith) && opt.conflictsWith.length > 0) {
        const conflictLines = opt.conflictsWith.map(id => {
            const label = getOptionLabel(id) || id;
            const selected = !!selectedOptions[id];
            const symbol = selected ? '❌' : '✅';
            return `${symbol} ${label}`;
        });
        requirements.innerHTML += `<br>⚠️ Incompatible With:<br>${conflictLines.join("<br>")}`;
    }

    const desc = document.createElement("div");
    desc.className = "option-description";
    setMultilineText(desc, opt.description || "");

    const baseCost = getOptionBaseCost(opt);
    const discountContexts = [];
    if (isDiscountableSubcat && opt.disableSubcategoryDiscount !== true) {
        discountContexts.push({
            level: 'subcategory',
            entity: subcat,
            limit: subcat.discountSelectionLimit,
            eligible: subcat.discountEligibleUnder,
            map: getSubcategoryDiscountMap(subcatKey),
            mode: subcat.discountMode || 'half'
        });
    }
    if (catDiscountUnlocked && opt.disableCategoryDiscount !== true && !catAutoApplyAll) {
        discountContexts.push({
            level: 'category',
            entity: cat,
            limit: cat.discountSelectionLimit,
            eligible: cat.discountEligibleUnder,
            map: getCategoryDiscountMap(catKey),
            mode: cat.discountMode || 'half'
        });
    }

    discountContexts.forEach(discountContext => {
        const {
            value: eligibleCost
        } = getDiscountEligibleCost(baseCost, discountContext.entity);
        if (eligibleCost === null || eligibleCost <= 0 || eligibleCost > discountContext.eligible) {
            return;
        }

        const discountMap = discountContext.map;
        const assignedCount = discountMap[opt.id] || 0;
        const totalAssigned = getDiscountTotalCount(discountMap);
        const discountLimit = discountContext.limit || 0;
        const alreadySelected = selectedOptions[opt.id] > 0;
        const totalOthers = totalAssigned - assignedCount;
        const availableSlots = Math.max(0, discountLimit - totalOthers);
        const contextLabel = discountContext.level === 'subcategory' ? 'subcategory' : 'category';
        const discountLabel = discountContext.mode === 'free' ? 'Free slots' : 'Discount slots';

        if (assignedCount > 0) {
            const remaining = Math.max(0, assignedCount - (selectedOptions[opt.id] || 0));
            const remainingText = remaining > 0 ? ` (remaining ${remaining})` : '';
            requirements.innerHTML += `${discountLabel} assigned (${contextLabel}): ${assignedCount}${remainingText}<br>`;
        }

        const discountBtn = document.createElement("button");
        discountBtn.className = "discount-toggle";
        if (assignedCount > 0) {
            discountBtn.textContent = discountContext.mode === 'free'
                ? `Discount Applied (${assignedCount}) – Free (${contextLabel})`
                : `Discount Applied (${assignedCount}) (${contextLabel})`;
        } else {
            discountBtn.textContent = discountContext.mode === 'free'
                ? `Apply Free Slot (${contextLabel})`
                : `Apply Discount (${contextLabel})`;
        }

        const canIncrease = availableSlots > assignedCount;
        discountBtn.disabled = alreadySelected || (assignedCount === 0 && !canIncrease);
        if (alreadySelected) {
            discountBtn.title = `Remove and re-select this item to change ${contextLabel} discount status.`;
        } else if (assignedCount === 0 && !canIncrease) {
            const limitLabel = discountContext.mode === 'free' ? 'Free slot' : 'Discount';
            discountBtn.title = `${limitLabel} limit reached at the ${contextLabel} level. Remove an existing selection to free a slot (limit ${discountLimit}).`;
        } else {
            discountBtn.title = discountContext.mode === 'free'
                ? `Assign or remove a free ${contextLabel} slot for this item.`
                : `Cycle the number of ${contextLabel} discount slots applied to this item.`;
        }

        discountBtn.onclick = () => {
            if (selectedOptions[opt.id] > 0) return;

            const current = discountMap[opt.id] || 0;
            const freshTotal = getDiscountTotalCount(discountMap) - current;
            const maxAllowed = Math.max(0, discountLimit - freshTotal);

            if (maxAllowed === 0 && current === 0) {
                const limitLabel = discountContext.mode === 'free' ? 'Free slot' : 'Discount';
                alert(`${limitLabel} limit reached at the ${contextLabel} level. Remove an existing selection to free a slot (limit ${discountLimit}).`);
                return;
            }

            let next = current + 1;
            if (next > maxAllowed) {
                next = 0;
            }

            if (next > 0) {
                discountMap[opt.id] = next;
                discountContexts.forEach(otherContext => {
                    if (otherContext !== discountContext && otherContext.map[opt.id]) {
                        delete otherContext.map[opt.id];
                    }
                });
            } else {
                delete discountMap[opt.id];
            }
            renderAccordion();
        };
        requirements.appendChild(discountBtn);
    });

    const optionGrantContexts = getActiveOptionGrantContexts(opt.id);
    optionGrantContexts.forEach(ctx => {
        const assignedCount = ctx.map[opt.id] || 0;
        const totalAssigned = getDiscountTotalCount(ctx.map);
        const totalOthers = totalAssigned - assignedCount;
        const maxAllowed = Math.max(0, ctx.limit - totalOthers);
        const alreadySelected = selectedOptions[opt.id] || 0;
        const providerLabel = ctx.provider?.label || ctx.provider?.id || "Option";

        if (assignedCount > 0) {
            const remaining = Math.max(0, assignedCount - alreadySelected);
            const remainingText = remaining > 0 ? ` (remaining ${remaining})` : "";
            const slotText = ctx.mode === 'free' ? "Free slots" : "Discount slots";
            requirements.innerHTML += `${slotText} assigned by ${providerLabel}: ${assignedCount}${remainingText}<br>`;
        }

        const btn = document.createElement("button");
        btn.className = "discount-toggle";
        btn.textContent = ctx.mode === 'free'
            ? `Use Free Slot (${providerLabel})`
            : `Use Discount Slot (${providerLabel})`;
        if (assignedCount > 0) {
            btn.textContent = ctx.mode === 'free'
                ? `Free Slot Applied (${assignedCount}) – ${providerLabel}`
                : `Discount Applied (${assignedCount}) – ${providerLabel}`;
        }

        const canIncrease = maxAllowed > assignedCount;
        btn.disabled = alreadySelected > 0 || (assignedCount === 0 && !canIncrease);
        if (alreadySelected > 0) {
            btn.title = `Remove and re-select this item to change slots from ${providerLabel}.`;
        } else if (assignedCount === 0 && !canIncrease) {
            btn.title = `${providerLabel} has no slots left to assign (${ctx.limit} max).`;
        } else {
            btn.title = `Cycle assigned slots from ${providerLabel}.`;
        }

        btn.onclick = () => {
            if ((selectedOptions[opt.id] || 0) > 0) return;
            const current = ctx.map[opt.id] || 0;
            const freshTotal = getDiscountTotalCount(ctx.map) - current;
            const allowed = Math.max(0, ctx.limit - freshTotal);
            if (allowed === 0 && current === 0) {
                alert(`${providerLabel} has no slots left to assign.`);
                return;
            }
            let next = current + 1;
            if (next > allowed) next = 0;
            if (next > 0) {
                ctx.map[opt.id] = next;
            } else {
                delete ctx.map[opt.id];
            }
            renderAccordion();
        };

        requirements.appendChild(btn);
    });

    contentWrapper.appendChild(label);
    contentWrapper.appendChild(requirements);
    contentWrapper.appendChild(desc);

    if (opt.inputType === "slider") {
        renderSliderControl(opt, contentWrapper);
    } else {
        const isSingleChoice = (opt.maxSelections || 1) === 1;
        if (!isSingleChoice) {
            renderSelectionButton(opt, contentWrapper);
        }
        if (selectedOptions[opt.id] && opt.dynamicCost) {
            renderDynamicCost(opt, contentWrapper);
        }
    }

    wrapper.appendChild(contentWrapper);
    grid.appendChild(wrapper);
}

function renderSliderControl(opt, contentWrapper) {
    const { currencyType, attributeType } = getSliderTypes(opt.costPerPoint || {});
    const attrName = attributeType;
    const effectiveMin = opt.min ?? attributeRanges[attrName]?.min ?? 0;
    const effectiveMax = attributeRanges[attrName]?.max ?? opt.max ?? 40;

    let currentValue = attributeSliderValues[opt.id] ?? effectiveMin;
    if (currentValue > effectiveMax) {
        currentValue = effectiveMax;
        attributeSliderValues[opt.id] = currentValue;
        if (attrName) attributeSliderValues[attrName] = currentValue;
    }
    if (currentValue < effectiveMin) {
        currentValue = effectiveMin;
        attributeSliderValues[opt.id] = currentValue;
        if (attrName) attributeSliderValues[attrName] = currentValue;
    }

    if (attributeSliderValues[opt.id] === undefined) {
        attributeSliderValues[opt.id] = currentValue;
    }
    if (attrName && attributeSliderValues[attrName] === undefined) {
        attributeSliderValues[attrName] = currentValue;
    }

    const sliderWrapper = document.createElement("div");
    sliderWrapper.className = "slider-wrapper";

    const sliderLabel = document.createElement("label");
    sliderLabel.textContent = `${opt.label}: ${currentValue}`;
    sliderLabel.htmlFor = `${opt.id}-slider`;

    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = effectiveMin;
    slider.max = effectiveMax;
    slider.value = currentValue;
    slider.id = `${opt.id}-slider`;

    slider.oninput = (e) => {
        const newVal = parseInt(e.target.value);
        const { currencyType: currentCurrency, attributeType: currentAttribute } = getSliderTypes(opt.costPerPoint || {});
        const costPerPoint = opt.costPerPoint?.[currentCurrency] || 0;
        const attrNameForCost = currentAttribute;

        const currentEffectiveMax = attributeRanges[attrNameForCost]?.max ?? parseInt(slider.max);
        slider.max = currentEffectiveMax;

        if (newVal > currentEffectiveMax) {
            e.target.value = currentEffectiveMax;
            sliderLabel.textContent = `${opt.label}: ${currentEffectiveMax}`;
            return;
        }

        const oldVal = attributeSliderValues[opt.id] ?? effectiveMin;
        let diff = newVal - oldVal;

        let freeBoostAmount = 0;
        for (const dynOptId in dynamicSelections) {
            const dynOpt = findOptionById(dynOptId);
            if (dynOpt && dynOpt.dynamicCost) {
                dynOpt.dynamicCost.choices.forEach((choice, i) => {
                    if (dynamicSelections[dynOptId][i] === attrNameForCost && dynOpt.dynamicCost.types[i] === "Boost Attribute") {
                        freeBoostAmount = parseInt(dynOpt.dynamicCost.values[i]);
                    }
                });
            }
        }

        let pointsChange = 0;

        if (diff > 0) {
            const paidOldVal = Math.max(0, oldVal - freeBoostAmount);
            const paidNewVal = Math.max(0, newVal - freeBoostAmount);
            const paidIncrease = paidNewVal - paidOldVal;

            if (paidIncrease > 0) {
                const cost = costPerPoint * paidIncrease;
                if (points[currentCurrency] < cost && !allowNegativeTypes.has(currentCurrency)) {
                    e.target.value = oldVal;
                    sliderLabel.textContent = `${opt.label}: ${oldVal}`;
                    return;
                }
                pointsChange = -cost;
            }
        } else if (diff < 0) {
            const paidOldVal = Math.max(0, oldVal - freeBoostAmount);
            const paidNewVal = Math.max(0, newVal - freeBoostAmount);
            const paidDecrease = paidOldVal - paidNewVal;

            if (paidDecrease > 0) {
                pointsChange = costPerPoint * paidDecrease;
            }
        }

        if (pointsChange !== 0) {
            points[currentCurrency] += pointsChange;
        }

        attributeSliderValues[opt.id] = newVal;
        if (attrNameForCost) {
            attributeSliderValues[attrNameForCost] = newVal;
        }
        if (attrNameForCost && points.hasOwnProperty(attrNameForCost)) {
            points[attrNameForCost] = newVal;
        }

        sliderLabel.textContent = `${opt.label}: ${newVal}`;
        evaluateFormulas();
        updatePointsDisplay();
    };

    sliderWrapper.appendChild(sliderLabel);
    sliderWrapper.appendChild(slider);
    contentWrapper.appendChild(sliderWrapper);
}

function renderSelectionButton(opt, contentWrapper) {
    const controls = document.createElement("div");
    controls.className = "option-controls";

    const count = selectedOptions[opt.id] || 0;
    const max = opt.maxSelections || 1;
    const canAdd = canSelect(opt);

    if (max > 1) {
        const stepper = document.createElement("div");
        stepper.className = "option-stepper";

        const incrementBtn = document.createElement("button");
        incrementBtn.type = "button";
        incrementBtn.className = "stepper-btn";
        incrementBtn.textContent = "+";
        incrementBtn.disabled = (!canAdd && count === 0) || (count >= max && max !== Infinity);
        incrementBtn.onclick = (e) => {
            e.stopPropagation();
            ensureSubcategoryLimit(opt);
            if (canSelect(opt)) {
                addSelection(opt);
            }
        };

        const countDisplay = document.createElement("span");
        countDisplay.className = "stepper-count";
        countDisplay.textContent = String(count);
        const maxLabel = max === Infinity ? "∞" : String(max);
        countDisplay.title = `Selected ${count} of ${maxLabel}`;

        const decrementBtn = document.createElement("button");
        decrementBtn.type = "button";
        decrementBtn.className = "stepper-btn remove-btn";
        decrementBtn.textContent = "-";
        decrementBtn.disabled = count <= 0;
        decrementBtn.onclick = (e) => {
            e.stopPropagation();
            removeSelection(opt);
        };

        stepper.appendChild(decrementBtn);
        stepper.appendChild(countDisplay);
        stepper.appendChild(incrementBtn);
        controls.appendChild(stepper);
    } else {
        const btn = document.createElement("button");
        btn.textContent = count > 0 ? "✓ Selected" : "Select";
        btn.disabled = !canAdd && count === 0;
        btn.onclick = () => {
            if (count > 0) {
                removeSelection(opt);
            } else {
                ensureSubcategoryLimit(opt);
                if (canSelect(opt)) {
                    addSelection(opt);
                }
            }
        };
        controls.appendChild(btn);
    }

    contentWrapper.appendChild(controls);
}

function renderDynamicCost(opt, contentWrapper) {
    const choiceWrapper = document.createElement("div");
    choiceWrapper.className = "dynamic-choice-wrapper";

    const numChoices = opt.dynamicCost.values.length;
    const affectedTypes = opt.dynamicCost.types || [];

    if (!dynamicSelections[opt.id]) {
        dynamicSelections[opt.id] = Array(numChoices).fill("");
    }

    for (let i = 0; i < numChoices; i++) {
        const select = document.createElement("select");
        select.innerHTML = `<option value="">-- Select --</option>` +
            opt.dynamicCost.choices.map(choice => `<option value="${choice}">${choice}</option>`).join("");
        select.value = dynamicSelections[opt.id][i] || "";

        const label = document.createElement("label");
        const valueText = opt.dynamicCost.values[i];
        let effectText = "";
        if (typeof valueText === 'string' && valueText.startsWith("cap:")) {
            effectText = `(Cap at ${valueText.slice(4)})`;
        } else if (typeof valueText === 'number') {
            effectText = `(${valueText >= 0 ? "+" : ""}${valueText})`;
        }
        label.textContent = `${affectedTypes[i] || "Select Effect"}: ${effectText}`;
        label.style.display = "block";
        label.style.marginTop = "0.25em";

        select.onchange = (e) => {
            const newValue = e.target.value;
            const prevValue = dynamicSelections[opt.id][i];

            const tempDynamicSelections = [...dynamicSelections[opt.id]];
            tempDynamicSelections[i] = newValue;
            const uniqueSelections = new Set(tempDynamicSelections.filter(v => v !== ""));
            if (uniqueSelections.size !== tempDynamicSelections.filter(v => v !== "").length) {
                alert("Each selection must be unique for this set of choices.");
                e.target.value = prevValue;
                return;
            }

            dynamicSelections[opt.id][i] = newValue;
            evaluateFormulas();
            updatePointsDisplay();
            renderAccordion();
        };
        choiceWrapper.appendChild(label);
        choiceWrapper.appendChild(select);
    }
    contentWrapper.appendChild(choiceWrapper);
}

// Put this near your other helpers (top-level scope)

// Put this near your other helpers (top-level scope)
function prereqReferencesId(prereq, id) {
    if (!prereq) return false;

    // String: could be a single id or a boolean expression referencing ids
    if (typeof prereq === 'string') {
        // Match whole-id occurrences: kgA, not substrings like kgAB
        const re = new RegExp(`\\b${id}\\b`);
        return re.test(prereq);
    }

    // Array: interpreted as "must have all" (or however you’re using it)
    if (Array.isArray(prereq)) {
        return prereq.includes(id);
    }

    // Object: support {and:[]}, {or:[]}, {not:...} (any can be omitted)
    if (typeof prereq === 'object') {
        const hasAnd = Array.isArray(prereq.and) && prereq.and.some(p => prereqReferencesId(p, id));
        const hasOr = Array.isArray(prereq.or) && prereq.or.some(p => prereqReferencesId(p, id));
        const hasNot = prereq.not ? prereqReferencesId(prereq.not, id) : false;

        // If it's referenced positively in AND/OR, or in NOT (still a dependency)
        return hasAnd || hasOr || hasNot;
    }

    return false;
}

function updateThemeToggleButton() {
    const btn = document.getElementById('themeToggle');
    if (btn) {
        btn.textContent = isDarkMode ? '☀️' : '🌙';
    }
}

function toggleDarkMode() {
    isDarkMode = !isDarkMode;
    localStorage.setItem('cyoa-dark-mode', isDarkMode);
    // Re-apply the theme with the new dark mode state
    // We can just call applyCyoaData with the current categories to force a theme refresh
    if (window._lastCyoaData) {
        applyCyoaData(window._lastCyoaData);
    }
}

document.getElementById('themeToggle')?.addEventListener('click', toggleDarkMode);

// Backpack Feature
function openBackpackModal() {
    const modal = document.getElementById("backpackModal");
    const content = document.getElementById("backpackContent");
    content.innerHTML = "";

    // Group selected options by category
    const backpackByCategory = {};

    categories.forEach((cat) => {
        if (["points", "headerImage", "title", "description", "formulas", "backpack"].includes(cat.type)) {
            return;
        }

        const catName = cat.name;
        const selectedInCat = [];

        forEachCategoryOption(cat, (opt) => {
            if (selectedOptions[opt.id] > 0) {
                selectedInCat.push(opt);
            }
        });

        if (selectedInCat.length > 0) {
            backpackByCategory[catName] = selectedInCat;
        }
    });

    // Render categories and items
    Object.entries(backpackByCategory).forEach(([catName, options]) => {
        const categoryDiv = document.createElement("div");
        categoryDiv.className = "backpack-category";

        const titleDiv = document.createElement("div");
        titleDiv.className = "backpack-category-title";
        titleDiv.textContent = catName;
        categoryDiv.appendChild(titleDiv);

        const gridDiv = document.createElement("div");
        gridDiv.className = "backpack-grid";

        options.forEach((opt) => {
            const itemDiv = document.createElement("div");
            itemDiv.className = "backpack-item";

            const imageUrl = opt.image || opt.img;
            if (imageUrl) {
                const img = document.createElement("img");
                img.src = imageUrl;
                img.alt = opt.label;
                img.className = "backpack-item-image";
                itemDiv.appendChild(img);
            }

            const labelDiv = document.createElement("div");
            labelDiv.className = "backpack-item-label";
            labelDiv.textContent = opt.label;
            itemDiv.appendChild(labelDiv);

            gridDiv.appendChild(itemDiv);
        });

        categoryDiv.appendChild(gridDiv);
        content.appendChild(categoryDiv);
    });

    // Show empty message if no selections
    if (Object.keys(backpackByCategory).length === 0) {
        const emptyMsg = document.createElement("p");
        emptyMsg.style.textAlign = "center";
        emptyMsg.style.color = "var(--text-muted)";
        emptyMsg.textContent = "No selections yet. Make some choices to see them here!";
        content.appendChild(emptyMsg);
    }

    modal.style.display = "flex";
}

function closeBackpackModal() {
    const modal = document.getElementById("backpackModal");
    modal.style.display = "none";
}



// Close modal when clicking outside
window.onclick = (event) => {
    const modal = document.getElementById("modal");
    const backpackModal = document.getElementById("backpackModal");

    if (event.target === modal) closeModal();
    if (event.target === backpackModal) closeBackpackModal();
};
