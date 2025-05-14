let categories = [];
let points = {};
const selectedOptions = {};
const openCategories = new Set();

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
            points
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

fetch("input.json")
    .then(res => res.json())
    .then(data => {
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
    Object.entries(option.cost).forEach(([type, cost]) => (points[type] += cost));
    if (option.maxSelections && count > 1) {
        selectedOptions[option.id] = count - 1;
    } else {
        delete selectedOptions[option.id];
        removeDependentOptions(option.id);
    }
    updatePointsDisplay();
    renderAccordion();
}

function addSelection(option) {
    const current = selectedOptions[option.id] || 0;
    Object.entries(option.cost).forEach(([type, cost]) => (points[type] -= cost));
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
            (cat.options || []).forEach(opt => {
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
                categories.flatMap(c => c.options || []).forEach(other => {
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
                if (spend.length) reqText.push(`Cost: ${spend.join(', ')}`);

                requirements.innerHTML = reqText.join('<br>');

                const desc = document.createElement("div");
                desc.className = "option-description";
                desc.textContent = opt.description || "";

                const count = selectedOptions[opt.id] || 0;
                const max = opt.maxSelections || 1;

                const controls = document.createElement("div");
                controls.className = "option-controls";

                const hasPrereqs = !opt.prerequisites || opt.prerequisites.every(id => selectedOptions[id]);
                const hasPoints = Object.entries(opt.cost).every(([type, cost]) => points[type] >= cost);
                const hasNoOutgoingConflicts = !opt.conflictsWith || opt.conflictsWith.every(id => !selectedOptions[id]);
                const hasNoIncomingConflicts = Object.keys(selectedOptions).every(id => {
                    const selected = findOptionById(id);
                    return !selected?.conflictsWith || !selected.conflictsWith.includes(opt.id);
                });

                const isDisabled = !hasPrereqs || !hasPoints || !hasNoOutgoingConflicts || !hasNoIncomingConflicts;

                if (max > 1) {
                    const addBtn = document.createElement("button");
                    addBtn.textContent = "+";
                    addBtn.disabled = isDisabled || count >= max;
                    addBtn.title = addBtn.disabled ? "Cannot add more" : "Click to add";
                    addBtn.onclick = () => addSelection(opt);

                    const removeBtn = document.createElement("button");
                    removeBtn.textContent = "−";
                    removeBtn.disabled = count === 0;
                    removeBtn.title = count > 0 ? "Click to remove" : "Not selected";
                    removeBtn.onclick = () => removeSelection(opt);

                    const countText = document.createElement("span");
                    countText.textContent = `${count} selected`;

                    controls.appendChild(addBtn);
                    controls.appendChild(removeBtn);
                    controls.appendChild(countText);
                } else {
                    const btn = document.createElement("button");
                    btn.textContent = count > 0 ? "✓ Selected" : "Select";
                    btn.disabled = false;

                    if (count > 0) {
                        btn.onclick = () => removeSelection(opt);
                        btn.title = "Click to deselect";
                    } else if (isDisabled) {
                        if (!hasNoOutgoingConflicts || !hasNoIncomingConflicts) {
                            btn.classList.add("conflict");
                            btn.title = `Incompatible with: ${incompatibleNames.join(', ')}`;
                        } else if (!hasPrereqs) {
                            btn.classList.add("prereq");
                            btn.title = `Requires: ${opt.prerequisites.join(', ')}`;
                        } else {
                            btn.title = `Not enough points`;
                        }
                        btn.disabled = true;
                    } else {
                        btn.onclick = () => addSelection(opt);
                        btn.title = `Click to select`;
                    }

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
        }

        item.appendChild(header);
        item.appendChild(content);
        container.appendChild(item);
    });
}
