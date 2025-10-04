let categories = [];
let points = {};
const selectedOptions = {};
const discountedSelections = {};
const openCategories = new Set();
const storyInputs = {};
let formulas = {};
const openSubcategories = new Set();
const attributeSliderValues = {};
let originalPoints = {};
let allowNegativeTypes = new Set();
const dynamicSelections = {};
let attributeRanges = {}; // Will be updated by dynamic effects
let originalAttributeRanges = {}; // Stores the initial, base ranges from input.json

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
                const refundCost = discountedSelections[id]?.shift() || option.cost; // Use shift to get the correct instance cost
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


    // Reset points and attribute ranges to their original states from input.json
    points = {
        ...originalPoints
    };
    attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges)); // Reset ranges to original

    // Re-evaluate formulas to ensure all derived points are correctly reset
    evaluateFormulas();
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

        // Reset attribute ranges to original before re-applying dynamic effects
        attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges));

        evaluateFormulas(); // Evaluate formulas after initial points are set and ranges reset
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
            computedPoints: Object.keys(formulas), // For debugging/info, not strictly needed for import
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

    // Populate optionMap and dependencyGraph
    data.forEach(entry => {
        (entry.subcategories || [{
            options: entry.options || []
        }]).forEach(subcat => {
            (subcat.options || []).forEach(opt => {
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
            });
        });

        // Handle category-level requiresOption applying to all its options
        if (entry.requiresOption) {
            const requiredIds = Array.isArray(entry.requiresOption) ? entry.requiresOption : [entry.requiresOption];
            (entry.subcategories || [{
                options: entry.options || []
            }]).forEach(subcat => {
                (subcat.options || []).forEach(opt => {
                    const node = dependencyGraph.get(opt.id);
                    if (node) {
                        requiredIds.forEach(req => node.prerequisites.add(req));
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

    if (errors.length > 0) {
        throw new Error("Validation Errors:\n\n" + errors.map(err => `• ${err}`).join("\n\n"));
    }

    // Validate slider attributes against defined points
    const knownAttributes = Object.keys(pointsEntry?.values || {});
    for (const cat of data.filter(e => e.name)) { // Filter for actual categories
        for (const subcat of cat.subcategories || [{
            options: cat.options || []
        }]) {
            for (const opt of subcat.options || []) {
                if (opt.inputType === "slider") {
                    // Find the attribute name that is not "Attribute Points" (if it exists)
                    const attr = Object.keys(opt.costPerPoint || {}).find(t => t !== "Attribute Points");
                    if (attr && !knownAttributes.includes(attr)) {
                        errors.push(`Slider option "${opt.id}" references unknown attribute "${attr}" in its costPerPoint.`);
                    }
                }
            }
        }
    }

    if (errors.length > 0) {
        throw new Error("Validation Errors:\n\n" + errors.map(err => `• ${err}`).join("\n\n"));
    }
}


// Load and parse the input.json file
fetch("input.json")
    .then(res => res.json())
    .then(data => {
        try {
            const pointsEntry = data.find(entry => entry.type === "points");
            validateInputJson(data, pointsEntry);

            // Set Title
            const titleEntry = data.find(entry => entry.type === "title");
            if (titleEntry?.text) {
                const titleEl = document.getElementById("cyoaTitle");
                if (titleEl) titleEl.textContent = titleEntry.text;
            }

            // Set Description
            const descriptionEntry = data.find(entry => entry.type === "description");
            if (descriptionEntry?.text) {
                const descEl = document.getElementById("cyoaDescription");
                setMultilineText(descEl, descriptionEntry.text);
            }

            // Set Header Image
            const headerImageEntry = data.find(entry => entry.type === "headerImage");
            if (headerImageEntry?.url) {
                const container = document.getElementById("headerImageContainer");
                container.innerHTML = `<img src="${headerImageEntry.url}" alt="Header Image" class="header-image" />`;
            }

            // Initialize points and attribute ranges
            // Store originalAttributeRanges immediately after parsing, before any modifications
            originalAttributeRanges = pointsEntry?.attributeRanges ? JSON.parse(JSON.stringify(pointsEntry.attributeRanges)) : {};
            attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges)); // Deep copy to current working object

            allowNegativeTypes = new Set(pointsEntry?.allowNegative || []);
            originalPoints = pointsEntry?.values ? {
                ...pointsEntry.values
            } : {};
            points = {
                ...originalPoints
            };

            // Filter out special entries to get only categories
            categories = data.filter(entry => !entry.type || entry.name);

            // Initialize formulas
            const formulaEntry = data.find(entry => entry.type === "formulas");
            if (formulaEntry?.values) {
                formulas = {
                    ...formulaEntry.values
                };
            }

            // Initial render
            renderAccordion();
            evaluateFormulas(); // Evaluate formulas after initial points are set
            updatePointsDisplay();
        } catch (validationError) {
            console.error("Validation error in input.json:", validationError);
            alert("Invalid input.json: " + validationError.message);
            throw validationError; // Re-throw to stop further execution
        }
    })
    .catch(err => {
        console.error("Failed to load input.json:", err);
        alert("Failed to load input.json. Please check the file path and format.");
    });


/**
 * Recursively removes dependent options when a prerequisite is deselected.
 * @param {string} deselectedId - The ID of the option that was deselected.
 */
function removeDependentOptions(deselectedId) {
    for (const cat of categories) {
        // Check options directly in category
        for (const opt of cat.options || []) {
            if (opt.prerequisites?.includes(deselectedId) && selectedOptions[opt.id]) {
                removeSelection(opt);
                removeDependentOptions(opt.id); // Recursively remove dependents
            }
        }
        // Check options within subcategories
        for (const subcat of cat.subcategories || []) {
            for (const opt of subcat.options || []) {
                if (opt.prerequisites?.includes(deselectedId) && selectedOptions[opt.id]) {
                    removeSelection(opt);
                    removeDependentOptions(opt.id); // Recursively remove dependents
                }
            }
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
    const refundCost = discountedSelections[option.id]?.pop() || option.cost;

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

    evaluateFormulas(); // Re-evaluate formulas to reflect changes
    updatePointsDisplay();
    renderAccordion(); // Re-render to update UI elements (sliders, etc.)
    window.scrollTo(0, scrollY); // Restore scroll position
}

/**
 * Evaluates all defined formulas and updates point values.
 * Also handles dynamic cost effects like attribute capping and boosting.
 */
function evaluateFormulas() {
    // IMPORTANT: Reset attribute ranges to their original defaults first
    // This ensures that previous dynamic caps are removed before new ones are applied.
    attributeRanges = JSON.parse(JSON.stringify(originalAttributeRanges));

    // First, apply base formulas that might affect point types
    Object.entries(formulas).forEach(([pointType, {
        formula
    }]) => {
        try {
            const evalFunc = new Function("points", `return ${formula}`);
            points[pointType] = evalFunc(points);
        } catch (err) {
            console.warn(`Failed to evaluate formula for ${pointType}:`, err);
        }
    });

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
    const discounted = subcat?.discountFirstN && subcatCount < subcat.discountFirstN;

    const actualCost = {};
    Object.entries(option.cost).forEach(([type, cost]) => {
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

    evaluateFormulas();
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
            meetsPrereq = window.evaluatePrereqExpr(option.prerequisites, id => !!selectedOptions[id]);
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
    const subcatCount = subcatOptions.reduce((sum, o) => sum + (selectedOptions[o.id] || 0), 0);
    const subcatMax = subcat?.maxSelections || Infinity; // Default to no limit
    const underSubcatLimit = subcatCount < subcatMax;

    // Check option-specific max selections
    const maxPerOption = option.maxSelections || 1; // Default to 1 selection
    const currentOptionCount = selectedOptions[option.id] || 0;
    const underOptionLimit = currentOptionCount < maxPerOption;

    // Check if enough points (only for positive costs)
    const hasPoints = Object.entries(option.cost || {}).every(([type, cost]) => {
        if (cost < 0) return true; // Gains don't require points
        const projected = points[type] - cost;
        return projected >= 0 || allowNegativeTypes.has(type);
    });

    return meetsPrereq && hasPoints && hasNoOutgoingConflicts && hasNoIncomingConflicts && underOptionLimit && underSubcatLimit;
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
                discountAmount: cat.discountAmount,
                maxSelections: cat.maxSelections
            }; // Return a mock subcategory object
        }
        // If subcategories exist
        for (const subcat of cat.subcategories || []) {
            if ((subcat.options || []).some(opt => opt.id === optionId)) {
                return subcat;
            }
        }
    }
    return null;
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
        // Check options within subcategories
        for (const subcat of cat.subcategories || []) {
            for (const opt of subcat.options || []) {
                if (opt.id === id) return opt;
            }
        }
    }
    return null;
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


/**
 * Renders the accordion structure based on the categories data.
 * It creates collapsible sections for categories and subcategories,
 * and displays options within them.
 */
function renderAccordion() {
    const container = document.getElementById("accordionContainer");
    container.innerHTML = ""; // Clear previous content

    categories.forEach(cat => {
        // Skip special types (points, headerImage, title, description, formulas) as they are handled separately
        if (["points", "headerImage", "title", "description", "formulas"].includes(cat.type)) {
            return;
        }

        const item = document.createElement("div");
        item.className = "accordion-item";

        const header = document.createElement("div");
        header.className = "accordion-header";
        header.textContent = cat.name;

        const content = document.createElement("div");
        content.className = "accordion-content";
        content.style.display = openCategories.has(cat.name) ? "block" : "none"; // Maintain open state

        header.onclick = () => {
            if (openCategories.has(cat.name)) {
                openCategories.delete(cat.name);
                content.style.display = "none";
            } else {
                openCategories.add(cat.name);
                content.style.display = "block";
            }
        };

        item.appendChild(header);
        item.appendChild(content);

        // Check category-level requirements
        const requires = cat.requiresOption;
        const requiredIds = Array.isArray(requires) ? requires : requires ? [requires] : [];
        const categoryUnlocked = requiredIds.every(id => selectedOptions[id]);

        if (!categoryUnlocked) {
            const lockMsg = document.createElement("div");
            lockMsg.style.padding = "8px";
            lockMsg.style.color = "#666";
            const lines = requiredIds.map(id => {
                const label = getOptionLabel(id);
                const isSelected = selectedOptions[id];
                const symbol = isSelected ? "✅" : "❌";
                return `${symbol} ${label}`;
            });
            lockMsg.innerHTML = `🔒 Requires:<br>${lines.join("<br>")}`;
            content.appendChild(lockMsg);
        } else {
            // Handle subcategories or direct options if no subcategories defined
            const subcats = cat.subcategories || [{
                options: cat.options || [],
                name: ""
            }]; // Treat options directly in category as a single subcategory

            subcats.forEach((subcat, subIndex) => {
                // Check subcategory-level requirements
                const subcatRequires = subcat.requiresOption;
                const subcatReqIds = Array.isArray(subcatRequires) ? subcatRequires : subcatRequires ? [subcatRequires] : [];
                const subcatUnlocked = subcatReqIds.every(id => selectedOptions[id]);

                const subcatHeader = document.createElement("div");
                subcatHeader.className = "subcategory-header";
                subcatHeader.style.cursor = "pointer";
                subcatHeader.style.fontWeight = "bold";
                subcatHeader.style.marginTop = "1em";
                subcatHeader.textContent = subcat.name || `Options ${subIndex + 1}`; // Fallback name

                const subcatContent = document.createElement("div");
                subcatContent.className = "subcategory-content";
                const subcatKey = `${cat.name}__${subcat.name || subIndex}`; // Unique key for subcategory state

                if (openSubcategories.has(subcatKey)) {
                    subcatContent.style.display = "block";
                } else {
                    subcatContent.style.display = "none";
                }

                subcatHeader.onclick = () => {
                    if (openSubcategories.has(subcatKey)) {
                        openSubcategories.delete(subcatKey);
                        subcatContent.style.display = "none";
                    } else {
                        openSubcategories.add(subcatKey);
                        subcatContent.style.display = "block";
                    }
                };

                content.appendChild(subcatHeader);
                content.appendChild(subcatContent);

                if (!subcatUnlocked) {
                    const lockMsg = document.createElement("div");
                    lockMsg.style.padding = "8px";
                    lockMsg.style.color = "#666";
                    const lines = subcatReqIds.map(id => {
                        const label = getSubcategoryOptionLabel(id);
                        const isSelected = selectedOptions[id];
                        const symbol = isSelected ? "✅" : "❌";
                        return `${symbol} ${label}`;
                    });
                    lockMsg.innerHTML = `🔒 Requires:<br>${lines.join("<br>")}`;
                    subcatContent.appendChild(lockMsg);
                    return; // Skip rendering options if subcategory is locked
                }

                // Handle storyBlock type
                if (subcat.type === "storyBlock") {
                    if (subcat.text && subcat.text.trim() !== "") {
                        const storyText = document.createElement("div");
                        storyText.className = "story-block";
                        setMultilineText(storyText, subcat.text);
                        subcatContent.appendChild(storyText);
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
                        input.maxLength = subcat.input.maxLength || 20; // Default max length
                        input.value = storyInputs[subcat.input.id] || ""; // Load saved input
                        input.addEventListener("input", (e) => {
                            storyInputs[subcat.input.id] = e.target.value;
                        });
                        inputWrapper.appendChild(input);
                        subcatContent.appendChild(inputWrapper);
                    }
                }

                // Render options within the subcategory
                (subcat.options || []).forEach(opt => {
                    const wrapper = document.createElement("div");
                    wrapper.className = "option-wrapper";

                    // Only add image if img URL is provided
                    if (opt.img) {
                        const img = document.createElement("img");
                        img.src = opt.img;
                        img.alt = opt.label;
                        wrapper.appendChild(img);
                    }


                    const contentWrapper = document.createElement("div");
                    contentWrapper.className = "option-content";

                    const label = document.createElement("strong");
                    label.textContent = opt.label;

                    const requirements = document.createElement("div");
                    requirements.className = "option-requirements";
                    const gain = [],
                        spend = [];
                    Object.entries(opt.cost || {}).forEach(([type, val]) => {
                        if (val < 0) gain.push(`${type} ${Math.abs(val)}`);
                        else spend.push(`${type} ${val}`);
                    });
                    if (gain.length) requirements.innerHTML += `Gain: ${gain.join(', ')}<br>`;
                    if (spend.length) requirements.innerHTML += `Cost: ${spend.join(', ')}<br>`;

                    // Show prerequisites for options (like Archangel)
                    if (opt.prerequisites && opt.prerequisites.length > 0) {
                        let prereqLines = [];
                        if (typeof opt.prerequisites === 'string') {
                            // Parse the string for variable names (option IDs)
                            const ids = opt.prerequisites.match(/\b[a-zA-Z_][a-zA-Z0-9_]*\b/g) || [];
                            // Remove JS reserved words and boolean literals
                            const reserved = new Set(['true', 'false', 'null', 'undefined', 'if', 'else', 'return', 'let', 'var', 'const', 'function', 'while', 'for', 'do', 'switch', 'case', 'break', 'continue', 'default', 'new', 'this', 'typeof', 'instanceof', 'void', 'delete', 'in', 'of', 'with', 'try', 'catch', 'finally', 'throw', 'class', 'extends', 'super', 'import', 'export', 'from', 'as', 'await', 'async', 'yield']);
                            // For OR logic: if any option is selected, mark all as accepted
                            let isOr = opt.prerequisites.includes('||');
                            let orAccepted = false;
                            if (isOr) {
                                orAccepted = ids.some(id => !reserved.has(id) && !!selectedOptions[id]);
                            }
                            ids.forEach(id => {
                                if (!reserved.has(id)) {
                                    const label = getOptionLabel(id);
                                    let symbol;
                                    if (isOr && orAccepted) {
                                        symbol = "✅";
                                    } else {
                                        symbol = !!selectedOptions[id] ? "✅" : "❌";
                                    }
                                    prereqLines.push(`${symbol} ${label}`);
                                }
                            });
                        } else if (Array.isArray(opt.prerequisites)) {
                            prereqLines = opt.prerequisites.map(id => {
                                const label = getOptionLabel(id);
                                const isSelected = selectedOptions[id];
                                const symbol = isSelected ? "✅" : "❌";
                                return `${symbol} ${label}`;
                            });
                        } else if (typeof opt.prerequisites === 'object' && opt.prerequisites !== null) {
                            // For legacy AND/OR object
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
                        requirements.innerHTML += `🔒 Requires:<br>${prereqLines.join("<br>")}`;
                    }

                    const desc = document.createElement("div");
                    desc.className = "option-description";
                    setMultilineText(desc, opt.description || "");

                    contentWrapper.appendChild(label);
                    contentWrapper.appendChild(requirements);
                    contentWrapper.appendChild(desc);

                    if (opt.inputType === "slider") {
                        const {
                            currencyType,
                            attributeType
                        } = getSliderTypes(opt.costPerPoint || {});

                        const attrName = attributeType;

                        const effectiveMin = opt.min ?? attributeRanges[attrName]?.min ?? 0;
                        // Use attributeRanges for max, which will be updated by dynamic effects
                        const effectiveMax = attributeRanges[attrName]?.max ?? opt.max ?? 40;

                        // Ensure current value respects the new effectiveMax/Min
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
                        slider.max = effectiveMax; // Set slider max to the effective max
                        slider.value = currentValue;
                        slider.id = `${opt.id}-slider`;


                        slider.oninput = (e) => {
                            const newVal = parseInt(e.target.value);
                            const {
                                currencyType: currentCurrency,
                                attributeType: currentAttribute
                            } = getSliderTypes(opt.costPerPoint || {});
                            const costPerPoint = opt.costPerPoint?.[currentCurrency] || 0;
                            const attrNameForCost = currentAttribute;

                            // Re-check current effective max (could have been changed by a dynamic cap)
                            const currentEffectiveMax = attributeRanges[attrNameForCost]?.max ?? parseInt(slider.max);
                            slider.max = currentEffectiveMax; // Update slider's max attribute visually

                            if (newVal > currentEffectiveMax) {
                                e.target.value = currentEffectiveMax; // Cap the slider visually if user dragged past cap
                                // Only update label, do not proceed with cost calculation if it's beyond valid range
                                sliderLabel.textContent = `${opt.label}: ${currentEffectiveMax}`;
                                return;
                            }

                            const oldVal = attributeSliderValues[opt.id] ?? effectiveMin; // Value before this input event
                            let diff = newVal - oldVal;

                            let freeBoostAmount = 0;
                            // Dynamically find boost for this attribute if it exists from any dynamic selection
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

                            // Calculate the cost/refund for "Attribute Points"
                            // Points are only spent/refunded for the "paid" portion of the attribute.
                            let pointsChange = 0;

                            if (diff > 0) { // Increasing attribute value
                                const paidOldVal = Math.max(0, oldVal - freeBoostAmount);
                                const paidNewVal = Math.max(0, newVal - freeBoostAmount);
                                const paidIncrease = paidNewVal - paidOldVal;

                                if (paidIncrease > 0) {
                                    const cost = costPerPoint * paidIncrease;
                                    if (points[currentCurrency] < cost && !allowNegativeTypes.has(currentCurrency)) {
                                        e.target.value = oldVal; // Revert slider visually
                                        sliderLabel.textContent = `${opt.label}: ${oldVal}`; // Also revert label
                                        return; // Not enough points, prevent change
                                    }
                                    pointsChange = -cost; // Deduct points
                                }
                            } else if (diff < 0) { // Decreasing attribute value
                                const paidOldVal = Math.max(0, oldVal - freeBoostAmount);
                                const paidNewVal = Math.max(0, newVal - freeBoostAmount);
                                const paidDecrease = paidOldVal - paidNewVal; // This should be positive for refund

                                if (paidDecrease > 0) {
                                    pointsChange = costPerPoint * paidDecrease; // Refund points
                                }
                            }

                            // Apply the calculated point change
                            if (pointsChange !== 0) {
                                points[currentCurrency] += pointsChange;
                            }

                            // Update the stored attribute value
                            attributeSliderValues[opt.id] = newVal;
                            if (attrNameForCost) {
                                attributeSliderValues[attrNameForCost] = newVal;
                            }
                            // Also update the points object if the attribute is directly tied to a point type
                            // (this was causing issues with 'Strength' not updating in points display previously)
                            if (attrNameForCost && points.hasOwnProperty(attrNameForCost)) {
                                points[attrNameForCost] = newVal;
                            }

                            sliderLabel.textContent = `${opt.label}: ${newVal}`; // Update label dynamically
                            evaluateFormulas(); // Re-evaluate formulas after slider change
                            updatePointsDisplay();
                        };

                        sliderWrapper.appendChild(sliderLabel);
                        sliderWrapper.appendChild(slider);
                        contentWrapper.appendChild(sliderWrapper);

                    } else {
                        // Regular button for selection
                        const controls = document.createElement("div");
                        controls.className = "option-controls";

                        const count = selectedOptions[opt.id] || 0;
                        const max = opt.maxSelections || 1;

                        const btn = document.createElement("button");
                        btn.textContent = count > 0 ? "✓ Selected" : "Select";

                        const canAdd = canSelect(opt);
                        // Disable if cannot select AND nothing is already selected (prevent adding)
                        // Or if max selections reached
                        btn.disabled = (!canAdd && count === 0) || (count >= max && max !== Infinity);

                        // Add 'Remove' button if already selected and maxSelections allows removal (or no maxSelections)
                        if (count > 0) {
                            const removeBtn = document.createElement("button");
                            removeBtn.textContent = "Remove";
                            removeBtn.classList.add("remove-btn"); // Add a class for potential styling
                            removeBtn.onclick = (e) => {
                                e.stopPropagation(); // Prevent parent button's click from firing
                                removeSelection(opt);
                            };
                            controls.appendChild(removeBtn);
                        }


                        btn.onclick = () => {
                            if (count > 0 && max === 1) { // If single selection already picked, deselect
                                removeSelection(opt);
                            } else if (canAdd) { // If can add and not at max, add it
                                addSelection(opt);
                            }
                        };
                        controls.appendChild(btn);
                        contentWrapper.appendChild(controls);

                        // Render dynamic cost choices if applicable
                        if (selectedOptions[opt.id] && opt.dynamicCost && Array.isArray(opt.dynamicCost.choices) && Array.isArray(opt.dynamicCost.values)) {
                            const choiceWrapper = document.createElement("div");
                            choiceWrapper.className = "dynamic-choice-wrapper";

                            const numChoices = opt.dynamicCost.values.length;
                            const affectedTypes = opt.dynamicCost.types || [];

                            // Initialize dynamicSelections for this option if not already present
                            if (!dynamicSelections[opt.id]) {
                                dynamicSelections[opt.id] = Array(numChoices).fill("");
                            }

                            for (let i = 0; i < numChoices; i++) {
                                const select = document.createElement("select");
                                select.innerHTML = `<option value="">-- Select --</option>` +
                                    opt.dynamicCost.choices.map(choice => `<option value="${choice}">${choice}</option>`).join("");
                                select.value = dynamicSelections[opt.id][i] || ""; // Set current selected value

                                const label = document.createElement("label");
                                // Adjust label to reflect "Cap" or "Boost" clearly
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
                                    const prevValue = dynamicSelections[opt.id][i]; // Get previous value

                                    const targetValue = opt.dynamicCost.values[i];
                                    const typeOfEffect = opt.dynamicCost.types[i]; // e.g., "Cap Attribute", "Boost Attribute"
                                    const isAttributeTarget = opt.dynamicCost.target === "attributes";


                                    // Check for duplicate selections within the same option's dynamic choices
                                    const tempDynamicSelections = [...dynamicSelections[opt.id]];
                                    tempDynamicSelections[i] = newValue; // Temporarily update for duplicate check
                                    const uniqueSelections = new Set(tempDynamicSelections.filter(v => v !== "")); // Exclude empty
                                    if (uniqueSelections.size !== tempDynamicSelections.filter(v => v !== "").length) {
                                        // A duplicate was found among selected non-empty choices
                                        alert("Each selection must be unique for this set of choices.");
                                        e.target.value = prevValue; // Revert dropdown
                                        return; // Stop processing
                                    }


                                    // --- Update dynamicSelections array (this needs to happen BEFORE evaluateFormulas) ---
                                    dynamicSelections[opt.id][i] = newValue;

                                    // --- Trigger re-evaluation of all dynamic effects and formulas ---
                                    // evaluateFormulas will now correctly reset attributeRanges and apply boosts/caps
                                    evaluateFormulas();
                                    updatePointsDisplay();
                                    renderAccordion(); // Re-render to update slider positions/labels
                                };
                                choiceWrapper.appendChild(label);
                                choiceWrapper.appendChild(select);
                            }
                            contentWrapper.appendChild(choiceWrapper);
                        }
                    }
                    wrapper.appendChild(contentWrapper);
                    subcatContent.appendChild(wrapper);
                });
            });
        }
        container.appendChild(item);
    });
}
