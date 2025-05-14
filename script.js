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

fetch("input.json")
    .then(res => res.json())
    .then(data => {
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

function canSelect(option) {
    const meetsPrereq = !option.prerequisites || option.prerequisites.every(id => selectedOptions[id]);
    const hasPoints = Object.entries(option.cost).every(([type, cost]) => points[type] >= cost);
    const hasNoOutgoingConflicts = !option.conflictsWith || option.conflictsWith.every(id => !selectedOptions[id]);
    const hasNoIncomingConflicts = Object.keys(selectedOptions).every(id => {
        const selected = findOptionById(id);
        return !selected?.conflictsWith || !selected.conflictsWith.includes(option.id);
    });
    const currentCount = typeof selectedOptions[option.id] === 'number' ? selectedOptions[option.id] : (selectedOptions[option.id] ? 1 : 0);
    return meetsPrereq && hasPoints && hasNoOutgoingConflicts && hasNoIncomingConflicts && (!option.maxSelections || currentCount < option.maxSelections);
}

function updatePointsDisplay() {
    const display = document.getElementById("pointsDisplay");
    display.innerHTML = Object.entries(points)
        .map(([type, val]) => `<strong>${type}</strong>: ${val}`)
        .join(" | ");
}

function addSelection(option) {
    if (!canSelect(option)) return;
    Object.entries(option.cost).forEach(([type, cost]) => (points[type] -= cost));
    selectedOptions[option.id] = (selectedOptions[option.id] || 0) + 1;
    updatePointsDisplay();
    renderAccordion();
}

function removeSelection(option) {
    const count = typeof selectedOptions[option.id] === 'number' ? selectedOptions[option.id] : 1;
    if (!selectedOptions[option.id]) return;
    Object.entries(option.cost).forEach(([type, cost]) => (points[type] += cost));
    if (count > 1) {
        selectedOptions[option.id] = count - 1;
    } else {
        delete selectedOptions[option.id];
    }
    updatePointsDisplay();
    renderAccordion();
}

function renderAccordion() {
    const container = document.getElementById("accordionContainer");
    container.innerHTML = "";

    categories.forEach((cat) => {
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
            (cat.options || []).forEach((opt) => {
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
                requirements.title = reqText.join('\n');

                const desc = document.createElement("div");
                desc.className = "option-description";
                desc.textContent = opt.description || "";

                const buttonGroup = document.createElement("div");
                buttonGroup.style.display = "flex";
                buttonGroup.style.gap = "10px";
                buttonGroup.style.marginTop = "8px";

                const count = typeof selectedOptions[opt.id] === 'number' ? selectedOptions[opt.id] : (selectedOptions[opt.id] ? 1 : 0);

                if (opt.maxSelections) {
                    const addBtn = document.createElement("button");
                    addBtn.textContent = "+";
                    addBtn.title = "Add selection";
                    addBtn.disabled = !canSelect(opt);
                    addBtn.onclick = (e) => {
                        e.stopPropagation();
                        addSelection(opt);
                    };

                    const removeBtn = document.createElement("button");
                    removeBtn.textContent = "–";
                    removeBtn.title = "Remove selection";
                    removeBtn.disabled = count === 0;
                    removeBtn.onclick = (e) => {
                        e.stopPropagation();
                        removeSelection(opt);
                    };

                    buttonGroup.appendChild(addBtn);
                    buttonGroup.appendChild(removeBtn);

                    const countText = document.createElement("div");
                    countText.textContent = `${count} selected${opt.maxSelections ? ` / ${opt.maxSelections}` : ""}`;
                    countText.style.marginTop = "8px";
                    contentWrapper.appendChild(countText);
                } else {
                    const toggleBtn = document.createElement("button");
                    toggleBtn.textContent = count > 0 ? "✓" : "Select";
                    toggleBtn.title = count > 0 ? "Click to deselect" : "Click to select";
                    toggleBtn.disabled = !canSelect(opt) && count === 0;
                    toggleBtn.onclick = (e) => {
                        e.stopPropagation();
                        if (count > 0) removeSelection(opt);
                        else addSelection(opt);
                    };
                    buttonGroup.appendChild(toggleBtn);
                }

                contentWrapper.appendChild(label);
                contentWrapper.appendChild(requirements);
                contentWrapper.appendChild(desc);
                contentWrapper.appendChild(buttonGroup);

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

function getOptionLabel(id) {
    const match = categories.flatMap(c => c.options || []).find(o => o.id === id);
    return match ? match.label : id;
}

function openModal(mode) {
    modalMode = mode;
    modal.style.display = "block";

    if (mode === "export") {
        modalTitle.textContent = "Export Your Choices";
        modalTextarea.value = JSON.stringify(selectedOptions, null, 2);
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

modalConfirmBtn.onclick = () => {
    try {
        const imported = JSON.parse(modalTextarea.value);
        for (let id in selectedOptions) {
            const option = findOptionById(id);
            if (option) {
                const count = typeof selectedOptions[id] === 'number' ? selectedOptions[id] : 1;
                for (let i = 0; i < count; i++) {
                    Object.entries(option.cost).forEach(([type, cost]) => (points[type] += cost));
                }
            }
        }
        for (let key in selectedOptions) delete selectedOptions[key];

        for (let id in imported) {
            const option = findOptionById(id);
            const count = typeof imported[id] === 'number' ? imported[id] : 1;
            for (let i = 0; i < count; i++) {
                if (option && canSelect(option)) {
                    selectedOptions[id] = typeof selectedOptions[id] === 'number' ? selectedOptions[id] + 1 : 1;
                    Object.entries(option.cost).forEach(([type, cost]) => (points[type] -= cost));
                }
            }
        }

        updatePointsDisplay();
        renderAccordion();
        closeModal();
        alert("Choices imported successfully.");
    } catch (err) {
        alert("Import failed: " + err.message);
    }
};

document.getElementById("exportBtn").onclick = () => openModal("export");
document.getElementById("importBtn").onclick = () => openModal("import");
document.getElementById("modalClose").onclick = () => closeModal();
window.onclick = (e) => { if (e.target === modal) closeModal(); };

function findOptionById(id) {
    for (const category of categories) {
        for (const option of category.options || []) {
            if (option.id === id) return option;
        }
    }
    return null;
}
