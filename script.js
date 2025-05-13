const categories = [
    {
        name: "Abilities",
        options: [
            {
                id: "strength",
                label: "Super Strength",
                cost: { Power: 3 },
                img: "https://cdn.unifiedcommerce.com/content/product/large/0670889330057.jpg",
                description: "Grants immense strength. You can punch through walls and lift vehicles."
            },
            {
                id: "speed",
                label: "Super Speed",
                cost: { Power: 2 },
                img: "https://i.ytimg.com/vi/aC6NwmFI99Y/maxresdefault.jpg",
                description: "Move faster than the eye can see. Dodge bullets and run on water."
            },
            {
                id: "flight",
                label: "Flight",
                cost: { Power: 4 },
                prerequisites: ["strength"],
                img: "https://static1.srcdn.com/wordpress/wp-content/uploads/2021/06/Superman-Flight.jpg",
                description: "Soar through the skies at incredible speed. Requires Super Strength."
            },
            {
                id: "advancedFlight",
                label: "Advanced Flight",
                cost: { Power: 4 },
                prerequisites: ["strength", "flight"],
                img: "https://static1.srcdn.com/wordpress/wp-content/uploads/2021/06/Superman-Flight.jpg",
                description: "Perform aerial combat maneuvers and sonic-speed bursts. Requires Flight + Strength."
            },
            {
                id: "laser",
                label: "Laser Vision",
                cost: { Power: 3 },
                prerequisites: ["strength"],
                img: "https://static1.srcdn.com/wordpress/wp-content/uploads/2023/08/superman-heat-vision.jpg",
                description: "Shoot concentrated beams of energy from your eyes. Devastating and precise."
            }
        ]
    },
    {
        name: "Personality",
        options: [
            {
                id: "charm",
                label: "Charming",
                cost: { Charisma: 2 },
                img: "https://www.dreamstime.com/charming-superhero-animated-d-cartoon-childlike-innocence-model-super-woman-cape-showcasing-wonder-realistic-image299895449.jpg",
                description: "You win people over with a smile. Great for diplomacy and persuasion."
            },
            {
                id: "intimidation",
                label: "Intimidating",
                cost: { Charisma: 3 },
                img: "https://www.superherodb.com/pictures2/portraits/10/050/10461.jpg",
                description: "Your presence alone makes enemies hesitate. You command fear."
            }
        ]
    }
];
let points = { Power: 10, Charisma: 5 };
const selectedOptions = {};
const openCategories = new Set();
const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalTextarea = document.getElementById("modalTextarea");
const modalConfirmBtn = document.getElementById("modalConfirmBtn");
const modalClose = document.getElementById("modalClose");
let modalMode = null;

document.getElementById("uploadBtn").onclick = () => {
    document.getElementById("imageInput").click();
};

document.getElementById("imageInput").onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = () => {
            document.getElementById("imagePreview").innerHTML = `<img src="${reader.result}" alt="Character Image">`;
        };
        reader.readAsDataURL(file);
    }
};

function canSelect(option) {
    const meetsPrereq = !option.prerequisites || option.prerequisites.every((id) => selectedOptions[id]);
    const hasPoints = Object.entries(option.cost).every(([type, cost]) => points[type] >= cost);
    return meetsPrereq && hasPoints;
}

function updatePointsDisplay() {
    const display = document.getElementById("pointsDisplay");
    display.innerHTML = Object.entries(points)
        .map(([type, val]) => `<strong>${type}</strong>: ${val}`)
        .join(" | ");
}

function toggleOption(option, button) {
    const isSelected = !!selectedOptions[option.id];
    if (isSelected) {
        Object.entries(option.cost).forEach(([type, cost]) => (points[type] += cost));
        delete selectedOptions[option.id];
        button.textContent = "Select";
    } else if (canSelect(option)) {
        Object.entries(option.cost).forEach(([type, cost]) => (points[type] -= cost));
        selectedOptions[option.id] = true;
        button.textContent = "✓ Selected";
    }
    updatePointsDisplay();
    renderAccordion();
}

function renderAccordion() {
    const container = document.getElementById("accordionContainer");
    container.innerHTML = "";

    categories.forEach((cat) => {
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

        cat.options.forEach((opt) => {
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

            if (opt.prerequisites?.length) {
                const prereqNames = opt.prerequisites.map(id => {
                    const match = categories.flatMap(c => c.options).find(o => o.id === id);
                    return match ? match.label : id;
                });
                reqText.push(`Requires: ${prereqNames.join(', ')}`);
            }

            const costText = Object.entries(opt.cost).map(([type, val]) => `${type} ${val}`).join(', ');
            reqText.push(`Cost: ${costText}`);
            requirements.innerHTML = reqText.join('<br>');

            const desc = document.createElement("div");
            desc.className = "option-description";
            desc.textContent = opt.description || "";

            const btn = document.createElement("button");
            btn.textContent = selectedOptions[opt.id] ? "✓ Selected" : "Select";

            const hasPrereqs = !opt.prerequisites || opt.prerequisites.every(id => selectedOptions[id]);
            const hasPoints = Object.entries(opt.cost).every(([type, cost]) => points[type] >= cost);
            const isDisabled = !selectedOptions[opt.id] && (!hasPrereqs || !hasPoints);

            btn.disabled = isDisabled;
            if (isDisabled) {
                btn.title = !hasPrereqs ? `Requires: ${opt.prerequisites.join(', ')}` : `Not enough points`;
            }

            btn.onclick = () => toggleOption(opt, btn);

            contentWrapper.appendChild(label);
            contentWrapper.appendChild(requirements);
            contentWrapper.appendChild(desc);
            contentWrapper.appendChild(btn);

            wrapper.appendChild(img);
            wrapper.appendChild(contentWrapper);
            content.appendChild(wrapper);
        });

        item.appendChild(header);
        item.appendChild(content);
        container.appendChild(item);
    });
}

// Modal Logic
document.getElementById("exportBtn").onclick = () => openModal("export");
document.getElementById("importBtn").onclick = () => openModal("import");
document.getElementById("modalClose").onclick = () => closeModal();
window.onclick = (e) => { if (e.target === modal) closeModal(); };

function openModal(mode) {
    modalMode = mode;
    modal.style.display = "block";

    if (mode === "export") {
        modalTitle.textContent = "Export Your Choices";
        modalTextarea.value = JSON.stringify(Object.keys(selectedOptions), null, 2);
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
        const importedIds = JSON.parse(modalTextarea.value);
        if (!Array.isArray(importedIds)) throw new Error("Invalid format");

        for (let id in selectedOptions) {
            const option = findOptionById(id);
            if (option) {
                Object.entries(option.cost).forEach(([type, cost]) => {
                    points[type] += cost;
                });
            }
        }
        for (let key in selectedOptions) delete selectedOptions[key];

        importedIds.forEach((id) => {
            const option = findOptionById(id);
            if (option && canSelect(option)) {
                selectedOptions[id] = true;
                Object.entries(option.cost).forEach(([type, cost]) => {
                    points[type] -= cost;
                });
            }
        });

        updatePointsDisplay();
        renderAccordion();
        closeModal();
        alert("Choices imported successfully.");
    } catch (err) {
        alert("Import failed: " + err.message);
    }
};

function findOptionById(id) {
    for (const category of categories) {
        for (const option of category.options) {
            if (option.id === id) return option;
        }
    }
    return null;
}

renderAccordion();
updatePointsDisplay();
