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


const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalTextarea = document.getElementById("modalTextarea");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");
const modalClose = document.getElementById("modalClose");
let modalMode = null;

document.getElementById("exportBtn").onclick = () => openModal("export");
document.getElementById("importBtn").onclick = () => openModal("import");
document.getElementById("modalClose").onclick = () => closeModal();
document.getElementById("resetBtn").onclick = () => {
    if (!confirm("Are you sure you want to reset all selections?")) return;

    // Refund slider-based attribute costs (optional, but you already do it)
    for (let id in attributeSliderValues) {
        const value = attributeSliderValues[id];
        const option = findOptionById(id);
        if (option && option.costPerPoint) {
            for (let [type, costPer] of Object.entries(option.costPerPoint)) {
                points[type] += costPer * value;
            }
        }
    }

    // Refund selectedOptions
    for (let id in selectedOptions) {
        const option = findOptionById(id);
        if (option) {
            const count = selectedOptions[id];
            for (let i = 0; i < count; i++) {
                Object.entries(option.cost).forEach(([type, cost]) => {
                    points[type] += cost;
                });
            }
        }
    }

    // Clear all state
    for (let key in selectedOptions) delete selectedOptions[key];
    for (let key in attributeSliderValues) delete attributeSliderValues[key];
    for (let key in discountedSelections) delete discountedSelections[key];
    for (let key in storyInputs) delete storyInputs[key];

    // 🔥 Reset points to original values
    points = { ...originalPoints };

    // Recalculate and re-render
    evaluateFormulas();
    updatePointsDisplay();
    renderAccordion();
};

window.onclick = (e) => { if (e.target === modal) closeModal(); };

modalConfirmBtn.onclick = () => {
    try {
        const importedData = JSON.parse(modalTextarea.value);
        if (typeof importedData !== 'object' || !importedData.points || !importedData.selectedOptions) {
            throw new Error("Invalid format");
        }

        points = { ...importedData.points };
        for (let key in selectedOptions) delete selectedOptions[key];
        Object.entries(importedData.selectedOptions).forEach(([key, val]) => {
            selectedOptions[key] = val;
        });
        Object.entries(importedData.discountedSelections || {}).forEach(([key, val]) => {
            discountedSelections[key] = val;
        });
        Object.entries(importedData.storyInputs || {}).forEach(([key, val]) => {
            storyInputs[key] = val;
        });
        Object.entries(importedData.attributeSliderValues || {}).forEach(([key, val]) => {
            attributeSliderValues[key] = val;
        });


        evaluateFormulas();
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
            computedPoints: Object.keys(formulas),

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

function validateInputJson(data) {
    const optionMap = new Map();
    const dependencyGraph = new Map();
    const errors = [];

    // Step 1: Build option map and dependency graph
    data.forEach(entry => {
        (entry.subcategories || [{ options: entry.options || [] }]).forEach(subcat => {
            (subcat.options || []).forEach(opt => {
                optionMap.set(opt.id, opt);
                dependencyGraph.set(opt.id, {
                    prerequisites: new Set(opt.prerequisites || []),
                    conflicts: new Set(opt.conflictsWith || [])
                });
            });
        });

        // Step 2: Apply requiresOption to all options in the category
        if (entry.requiresOption) {
            const requiredIds = Array.isArray(entry.requiresOption)
                ? entry.requiresOption
                : [entry.requiresOption];

            (entry.subcategories || [{ options: entry.options || [] }]).forEach(subcat => {
                (subcat.options || []).forEach(opt => {
                    const node = dependencyGraph.get(opt.id);
                    if (node) {
                        requiredIds.forEach(req => node.prerequisites.add(req));
                    }
                });
            });
        }
    });

    // Step 3: Make conflicts bidirectional
    for (let [id, node] of dependencyGraph.entries()) {
        for (let conflictId of node.conflicts) {
            if (!dependencyGraph.has(conflictId)) continue;
            dependencyGraph.get(conflictId).conflicts.add(id);
        }
    }

    // Step 4: Recursively validate option paths
    function validateOption(id, path = new Set()) {
        if (path.has(id)) {
            errors.push(`Circular prerequisite detected involving "${id}"`);
            return;
        }

        path.add(id);
        const current = dependencyGraph.get(id);
        if (!current) return;

        for (let otherId of path) {
            if (otherId === id) continue;
            const other = dependencyGraph.get(otherId);
            if (other?.conflicts.has(id) || current.conflicts.has(otherId)) {
                errors.push(
                    `Option "${id}" cannot be selected due to conflict with its prerequisite "${otherId}"`
                );
            }
        }

        for (let pre of current.prerequisites) {
            if (!optionMap.has(pre)) {
                errors.push(`Missing prerequisite "${pre}" for option "${id}"`);
                continue;
            }
            validateOption(pre, new Set(path));
        }
    }

    // Step 5: Validate all options
    for (let id of optionMap.keys()) {
        validateOption(id);
    }

    if (errors.length > 0) {
        throw new Error("Validation Errors:\n\n" + errors.map(err => `• ${err}`).join("\n\n"));
    }
}

fetch("input.json")
    .then(res => res.json())
    .then(data => {
        try {
            validateInputJson(data);

            const titleEntry = data.find(entry => entry.type === "title");
            if (titleEntry?.text) {
                const titleEl = document.getElementById("cyoaTitle");
                if (titleEl) titleEl.textContent = titleEntry.text;
            }

            const descriptionEntry = data.find(entry => entry.type === "description");
            if (descriptionEntry?.text) {
                const descEl = document.getElementById("cyoaDescription");
                if (descEl) descEl.textContent = descriptionEntry.text;
            }

            const headerImageEntry = data.find(entry => entry.type === "headerImage");
            if (headerImageEntry?.url) {
                const container = document.getElementById("headerImageContainer");
                container.innerHTML = `<img src="${headerImageEntry.url}" alt="Header Image" class="header-image" />`;
            }

            const pointsEntry = data.find(entry => entry.type === "points");
            originalPoints = pointsEntry?.values ? { ...pointsEntry.values } : {};  // ✅ Save original values
            points = { ...originalPoints }; // ✅ Use copy of original

            categories = data.filter(entry => !entry.type || entry.name);

            const formulaEntry = data.find(entry => entry.type === "formulas");
            if (formulaEntry?.values) {
                formulas = { ...formulaEntry.values };
            }

            renderAccordion();
            evaluateFormulas();
            updatePointsDisplay();
        } catch (validationError) {
            console.error("Validation error in input.json:", validationError);
            alert("Invalid input.json: " + validationError.message);
            throw validationError; // Prevents further loading
        }
    })
    .catch(err => {
        console.error("Failed to load input.json:", err);
        alert("Failed to load input.json.");
    });

function removeDependentOptions(deselectedId) {
    for (const cat of categories) {
        for (const opt of cat.options || []) {
            if (opt.prerequisites?.includes(deselectedId) && selectedOptions[opt.id]) {
                removeSelection(opt);
                removeDependentOptions(opt.id);
            }
        }
    }
}

function removeSelection(option) {
    const count = typeof selectedOptions[option.id] === 'number' ? selectedOptions[option.id] : 1;
    if (!selectedOptions[option.id]) return;

    const refundCost = discountedSelections[option.id]?.pop() || option.cost;

    Object.entries(refundCost).forEach(([type, cost]) => {
        points[type] += cost;
    });

    if (option.maxSelections && count > 1) {
        selectedOptions[option.id] = count - 1;
    } else {
        delete selectedOptions[option.id];
        delete discountedSelections[option.id];
        removeDependentOptions(option.id);
    }
    evaluateFormulas();
    updatePointsDisplay();
    renderAccordion();
}

function evaluateFormulas() {
    Object.entries(formulas).forEach(([pointType, { formula }]) => {
        try {
            const evalFunc = new Function("points", `return ${formula}`);
            points[pointType] = evalFunc(points);
        } catch (err) {
            console.warn(`Failed to evaluate formula for ${pointType}:`, err);
        }
    });
}



function addSelection(option) {
    const current = selectedOptions[option.id] || 0;
    const subcat = findSubcategoryOfOption(option.id);
    const subcatOptions = subcat?.options || [];
    const subcatCount = subcatOptions.reduce((sum, o) => sum + (selectedOptions[o.id] || 0), 0);

    const discounted = subcat?.discountFirstN && subcatCount < subcat.discountFirstN;

    const actualCost = {};
    Object.entries(option.cost).forEach(([type, cost]) => {
        const discount = discounted ? (subcat?.discountAmount?.[type] || 0) : 0;
        let finalCost;
        if (cost < 0) {
            // Gain points
            finalCost = cost;
            points[type] -= cost; // Subtracting a negative = adding
        } else {
            // Spend points (with discount if any)
            const discount = discounted ? (subcat?.discountAmount?.[type] || 0) : 0;
            finalCost = Math.max(0, cost - discount);
            points[type] -= finalCost;
        }
        actualCost[type] = finalCost;

    });

    // Track the actual cost used
    if (!discountedSelections[option.id]) discountedSelections[option.id] = [];
    discountedSelections[option.id].push(actualCost);

    selectedOptions[option.id] = current + 1;
    evaluateFormulas();
    updatePointsDisplay();
    renderAccordion();
}


function updatePointsDisplay() {
    const display = document.getElementById("pointsDisplay");
    display.innerHTML = Object.entries(points)
        .map(([type, val]) => `<strong>${type}</strong>: ${val}`)
        .join(" | ");
}

function canSelect(option) {
    const meetsPrereq = !option.prerequisites || option.prerequisites.every(id => selectedOptions[id]);
    const hasPoints = Object.entries(option.cost).every(([type, cost]) => points[type] >= cost);
    const hasNoOutgoingConflicts = !option.conflictsWith || option.conflictsWith.every(id => !selectedOptions[id]);
    const hasNoIncomingConflicts = Object.keys(selectedOptions).every(id => {
        const selected = findOptionById(id);
        return !selected?.conflictsWith || !selected.conflictsWith.includes(option.id);
    });
    const max = option.maxSelections || 1;
    const current = selectedOptions[option.id] || 0;
    return meetsPrereq && hasPoints && hasNoOutgoingConflicts && hasNoIncomingConflicts && current < max;
}

function findSubcategoryOfOption(optionId) {
    for (const cat of categories) {
        for (const subcat of cat.subcategories || [{ options: cat.options || [] }]) {
            if ((subcat.options || []).some(opt => opt.id === optionId)) {
                return subcat;
            }
        }
    }
    return null;
}

function findOptionById(id) {
    for (const cat of categories) {
        for (const opt of cat.options || []) {
            if (opt.id === id) return opt;
        }
    }
    return null;
}

function getOptionLabel(id) {
    const match = categories.flatMap(c => c.options || []).find(o => o.id === id);
    return match ? match.label : id;
}

function renderAccordion() {
    const container = document.getElementById("accordionContainer");
    container.innerHTML = "";

    categories.forEach(cat => {
        if (cat.type === "points" || cat.type === "headerImage") return;

        const item = document.createElement("div");
        item.className = "accordion-item";

        const header = document.createElement("div");
        header.className = "accordion-header";
        header.textContent = cat.name;

        const content = document.createElement("div");
        content.className = "accordion-content";
        content.style.display = openCategories.has(cat.name) ? "block" : "none";

        header.onclick = () => {
            if (openCategories.has(cat.name)) {
                openCategories.delete(cat.name);
                content.style.display = "none";
            } else {
                openCategories.add(cat.name);
                content.style.display = "block";
            }
        };

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
            const subcats = cat.subcategories || [{ options: cat.options || [], name: "" }];
            subcats.forEach((subcat, subIndex) => {
                const subcatHeader = document.createElement("div");
                subcatHeader.className = "subcategory-header";
                subcatHeader.style.cursor = "pointer";
                subcatHeader.style.fontWeight = "bold";
                subcatHeader.style.marginTop = "1em";
                subcatHeader.textContent = subcat.name || `Options ${subIndex + 1}`;

                const subcatContent = document.createElement("div");
                subcatContent.className = "subcategory-content";
                subcatContent.style.display = "block";

                subcatHeader.onclick = () => {
                    const isVisible = subcatContent.style.display === "block";
                    subcatContent.style.display = isVisible ? "none" : "block";
                };

                content.appendChild(subcatHeader);
                content.appendChild(subcatContent);

                if (subcat.type === "storyBlock") {
                    const storyText = document.createElement("div");
                    storyText.className = "story-block";
                    storyText.textContent = subcat.text || "";
                    subcatContent.appendChild(storyText);

                    if (subcat.input) {
                        const inputWrapper = document.createElement("div");
                        inputWrapper.className = "story-input-wrapper";

                        const label = document.createElement("label");
                        label.textContent = subcat.input.label || "Input:";
                        label.setAttribute("for", subcat.input.id);

                        const input = document.createElement("input");
                        input.type = "text";
                        input.id = subcat.input.id;
                        input.placeholder = subcat.input.placeholder || "";
                        input.maxLength = subcat.input.maxLength || 20;
                        input.value = storyInputs[subcat.input.id] || "";

                        input.addEventListener("input", (e) => {
                            storyInputs[subcat.input.id] = e.target.value;
                        });

                        inputWrapper.appendChild(label);
                        inputWrapper.appendChild(input);
                        subcatContent.appendChild(inputWrapper);
                    }
                }

                (subcat.options || []).forEach(opt => {
                    const wrapper = document.createElement("div");
                    wrapper.className = "option-wrapper";

                    const img = document.createElement("img");
                    img.src = opt.img || "";
                    img.alt = opt.label;

                    const contentWrapper = document.createElement("div");
                    contentWrapper.className = "option-content";

                    const label = document.createElement("strong");
                    label.textContent = opt.label;

                    const requirements = document.createElement("div");
                    requirements.className = "option-requirements";

                    const gain = [], spend = [];
                    Object.entries(opt.cost || {}).forEach(([type, val]) => {
                        if (val < 0) gain.push(`${type} ${Math.abs(val)}`);
                        else spend.push(`${type} ${val}`);
                    });

                    if (gain.length) requirements.innerHTML += `Gain: ${gain.join(', ')}<br>`;
                    if (spend.length) requirements.innerHTML += `Cost: ${spend.join(', ')}<br>`;

                    const desc = document.createElement("div");
                    desc.className = "option-description";
                    desc.textContent = opt.description || "";

                    contentWrapper.appendChild(label);
                    contentWrapper.appendChild(requirements);
                    contentWrapper.appendChild(desc);

                    if (opt.inputType === "slider") {
                        const currentValue = attributeSliderValues[opt.id] || 0;

                        const sliderWrapper = document.createElement("div");
                        sliderWrapper.className = "slider-wrapper";

                        const sliderLabel = document.createElement("label");
                        sliderLabel.textContent = `${opt.label}: ${currentValue}`;
                        sliderLabel.htmlFor = `${opt.id}-slider`;

                        const slider = document.createElement("input");
                        slider.type = "range";
                        slider.min = opt.min ?? 0;
                        slider.max = opt.max ?? 40;
                        slider.value = currentValue;
                        slider.id = `${opt.id}-slider`;

                        slider.oninput = (e) => {
                            const newVal = parseInt(e.target.value);
                            const oldVal = attributeSliderValues[opt.id] || 0;
                            const diff = newVal - oldVal;

                            const costPerPoint = opt.costPerPoint || {};
                            const costTypes = Object.keys(costPerPoint);

                            let canChange = true;

                            for (let type of costTypes) {
                                const cost = costPerPoint[type] * diff;
                                if (diff > 0 && points[type] < cost) {
                                    canChange = false;
                                    break;
                                }
                            }

                            if (!canChange) {
                                e.target.value = oldVal;
                                return;
                            }

                            costTypes.forEach(type => {
                                const cost = costPerPoint[type] * diff;
                                points[type] -= cost;
                            });

                            attributeSliderValues[opt.id] = newVal;
                            sliderLabel.textContent = `${opt.label}: ${newVal}`;
                            evaluateFormulas();
                            updatePointsDisplay();
                        };

                        sliderWrapper.appendChild(sliderLabel);
                        sliderWrapper.appendChild(slider);
                        contentWrapper.appendChild(sliderWrapper);
                    } else {
                        const controls = document.createElement("div");
                        controls.className = "option-controls";

                        const count = selectedOptions[opt.id] || 0;
                        const max = opt.maxSelections || 1;

                        const btn = document.createElement("button");
                        btn.textContent = count > 0 ? "✓ Selected" : "Select";

                        const canAdd = canSelect(opt);
                        btn.disabled = !canAdd && count === 0;

                        btn.onclick = () => {
                            if (count > 0) {
                                removeSelection(opt);
                            } else if (canAdd) {
                                addSelection(opt);
                            }
                        };

                        controls.appendChild(btn);
                        contentWrapper.appendChild(controls);
                    }

                    wrapper.appendChild(img);
                    wrapper.appendChild(contentWrapper);
                    subcatContent.appendChild(wrapper);
                });
            });
        }

        item.appendChild(header);
        item.appendChild(content);
        container.appendChild(item);
    });
}
