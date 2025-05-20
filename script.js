let categories = [];
let points = {};
const selectedOptions = {};
const discountedSelections = {}; 
const openCategories = new Set();
const storyInputs = {};


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

    for (let key in selectedOptions) delete selectedOptions[key];
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
            storyInputs
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
            validateInputJson(data); // Validate for logical consistency

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
            points = pointsEntry?.values ? { ...pointsEntry.values } : {};

            categories = data.filter(entry => !entry.type || entry.name);

            renderAccordion();
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

    updatePointsDisplay();
    renderAccordion();
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
            subcats.forEach(subcat => {
                if (subcat.type === "storyBlock") {
                    const storyText = document.createElement("div");
                    storyText.className = "story-block";
                    storyText.textContent = subcat.text || "";
                    content.appendChild(storyText);

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
                        content.appendChild(inputWrapper);
                    }

                    const subHeader = document.createElement("h4");
                    subHeader.textContent = subcat.name || "Options";
                    content.appendChild(subHeader);
                } else {
                    const subHeader = document.createElement("h4");
                    subHeader.style.display = "flex";
                    subHeader.style.justifyContent = "space-between";
                    subHeader.style.alignItems = "center";

                    const nameSpan = document.createElement("span");
                    nameSpan.textContent = subcat.name || "Options";

                    subHeader.appendChild(nameSpan);

                    if (subcat.maxSelections) {
                        const limitNote = document.createElement("span");
                        limitNote.style.fontSize = "12px";
                        limitNote.style.color = "#666";
                        limitNote.textContent = `Choose up to ${subcat.maxSelections}`;
                        subHeader.appendChild(limitNote);
                    }

                    content.appendChild(subHeader);
                }

                const subcatLimit = subcat.maxSelections || null;
                const subcatCount = () => (subcat.options || []).reduce((sum, opt) => sum + (selectedOptions[opt.id] || 0), 0);

                (subcat.options || []).forEach(opt => {
                    const wrapper = document.createElement("div");
                    wrapper.className = "option-wrapper";

                    const img = document.createElement("img");
                    img.src = opt.img;
                    img.alt = opt.label;

                    const contentWrapper = document.createElement("div");
                    contentWrapper.className = "option-content";

                    const label = document.createElement("strong");
                    label.textContent = opt.label;

                    const requirements = document.createElement("div");
                    requirements.className = "option-requirements";
                    let reqText = [];

                    const allConflicts = new Set();
                    (opt.conflictsWith || []).forEach(id => allConflicts.add(id));
                    categories.flatMap(c => c.subcategories || [{ options: c.options || [] }])
                        .flatMap(sc => sc.options || [])
                        .forEach(other => {
                            if (other.conflictsWith?.includes(opt.id)) {
                                allConflicts.add(other.id);
                            }
                        });

                    const incompatibleNames = Array.from(allConflicts).map(getOptionLabel);
                    if (incompatibleNames.length > 0) {
                        reqText.push(`Incompatible with: ${incompatibleNames.join(', ')}`);
                    }

                    if (opt.prerequisites?.length) {
                        const prereqNames = opt.prerequisites.map(getOptionLabel);
                        reqText.push(`Requires: ${prereqNames.join(', ')}`);
                    }

                    const gain = [], spend = [];
                    Object.entries(opt.cost).forEach(([type, val]) => {
                        if (val < 0) gain.push(`${type} ${Math.abs(val)}`);
                        else spend.push(`${type} ${val}`);
                    });
                    if (gain.length) reqText.push(`Gain: ${gain.join(', ')}`);
                    if (spend.length) {
                        const discounted = (() => {
                            const subcatOptions = subcat.options || [];
                            const currentSubcatCount = subcatOptions.reduce((sum, o) => sum + (selectedOptions[o.id] || 0), 0);
                            return subcat?.discountFirstN && currentSubcatCount < subcat.discountFirstN;
                        })();

                        if (discounted) {
                            const adjusted = Object.entries(opt.cost).map(([type, val]) => {
                                const discount = subcat.discountAmount?.[type] || 0;
                                const effective = Math.max(0, val - discount);
                                return effective < val
                                    ? `<span style="color: green;">${type} ${effective} (was ${val})</span>`
                                    : `${type} ${val}`;
                            });
                            reqText.push(`Cost: ${adjusted.join(', ')}`);
                        } else {
                            reqText.push(`Cost: ${spend.join(', ')}`);
                        }
                    }

                    requirements.innerHTML = reqText.join('<br>');

                    const desc = document.createElement("div");
                    desc.className = "option-description";
                    desc.textContent = opt.description || "";

                    const count = selectedOptions[opt.id] || 0;
                    const max = opt.maxSelections || 1;

                    const controls = document.createElement("div");
                    controls.className = "option-controls";

                    const canAdd = () => {
                        const currentSubcatCount = subcatCount();
                        return currentSubcatCount < (subcatLimit || Infinity);
                    };

                    const hasPrereqs = !opt.prerequisites || opt.prerequisites.every(id => selectedOptions[id]);
                    const hasPoints = Object.entries(opt.cost).every(([type, cost]) => points[type] >= cost);
                    const hasNoOutgoingConflicts = !opt.conflictsWith || opt.conflictsWith.every(id => !selectedOptions[id]);
                    const hasNoIncomingConflicts = Object.keys(selectedOptions).every(id => {
                        const selected = findOptionById(id);
                        return !selected?.conflictsWith || !selected.conflictsWith.includes(opt.id);
                    });
                    const isDisabled = !hasPrereqs || !hasPoints || !hasNoOutgoingConflicts || !hasNoIncomingConflicts || !canAdd();

                    if (max > 1) {
                        const addBtn = document.createElement("button");
                        addBtn.textContent = "+";
                        addBtn.disabled = isDisabled || count >= max;
                        addBtn.onclick = () => addSelection(opt);

                        const removeBtn = document.createElement("button");
                        removeBtn.textContent = "−";
                        removeBtn.disabled = count === 0;
                        removeBtn.onclick = () => removeSelection(opt);

                        const countText = document.createElement("span");
                        countText.textContent = `${count} selected`;

                        controls.appendChild(addBtn);
                        controls.appendChild(removeBtn);
                        controls.appendChild(countText);
                    } else {
                        const btn = document.createElement("button");
                        btn.textContent = count > 0 ? "✓ Selected" : "Select";
                        if (count > 0) {
                            btn.onclick = () => removeSelection(opt);
                        } else if (!isDisabled) {
                            btn.onclick = () => addSelection(opt);
                        }

                        let tooltip = [];

                        if (!hasPoints) {
                            tooltip.push("Not enough points");
                        }
                        if (!hasPrereqs) {
                            const missing = opt.prerequisites
                                .filter(id => !selectedOptions[id])
                                .map(getOptionLabel);
                            tooltip.push(`Missing prerequisites: ${missing.join(', ')}`);
                        }
                        if (!hasNoOutgoingConflicts || !hasNoIncomingConflicts) {
                            tooltip.push(`Conflicts with incompatible option(s): ${incompatibleNames.join(', ')}`);
                        }
                        if (!canAdd()) {
                            tooltip.push("Max selections reached for this group");
                        }

                        const discounted = (() => {
                            const subcatOptions = subcat.options || [];
                            const currentSubcatCount = subcatOptions.reduce((sum, o) => sum + (selectedOptions[o.id] || 0), 0);
                            return subcat?.discountFirstN && currentSubcatCount < subcat.discountFirstN;
                        })();

                        if (discounted) {
                            Object.entries(subcat.discountAmount || {}).forEach(([type, val]) => {
                                tooltip.push(`Discount: -${val} ${type}`);
                            });
                        }

                        btn.disabled = count === 0 && isDisabled;
                        btn.title = tooltip.length > 0
                            ? tooltip.join(" | ")
                            : (count > 0 ? "Click to deselect" : "Click to select");
                        controls.appendChild(btn);
                    }

                    contentWrapper.appendChild(label);
                    contentWrapper.appendChild(requirements);
                    contentWrapper.appendChild(desc);
                    contentWrapper.appendChild(controls);

                    wrapper.appendChild(img);
                    wrapper.appendChild(contentWrapper);
                    content.appendChild(wrapper);
                });
            });
        }

        item.appendChild(header);
        item.appendChild(content);
        container.appendChild(item);
    });
}
