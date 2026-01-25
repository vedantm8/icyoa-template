(function () {
    const CORE_TYPES_ORDER = ["title", "description", "headerImage", "points"];
    const BASE_OPTION_KEYS = new Set(["id", "label", "description", "image", "inputType", "inputLabel", "cost"]);

    const state = {
        data: [],
        previewReady: false,
        lastPreviewError: null,
        selectedFile: new URLSearchParams(window.location.search).get('cyoa') || null
    };
    const CONFIG_ENDPOINT = "/api/config";
    const tempSyncState = {
        enabled: false,
        pendingData: null,
        saving: false,
        warningShown: false,
        loadFallbackWarned: false
    };
    const categoryOpenState = new WeakMap();
    const subcategoryOpenState = new WeakMap();
    const sectionOpenState = new Map();
    const optionIdAutoMap = new WeakMap();

    function snapshotOpenStates(categorySnapshots) {
        const existingCategoryEls = categoryListEl?.querySelectorAll?.(".category-card");
        if (!existingCategoryEls || !existingCategoryEls.length) return;
        categorySnapshots.forEach(({ entry: category }, idx) => {
            const catEl = existingCategoryEls[idx];
            if (!catEl) return;
            categoryOpenState.set(category, catEl.open);
            const subEls = catEl.querySelectorAll(".subcategory-item");
            (category.subcategories || []).forEach((subcat, subIdx) => {
                const subEl = subEls[subIdx];
                if (!subEl) return;
                subcategoryOpenState.set(subcat, subEl.open);
            });
        });
    }

    const globalSettingsEl = document.getElementById("globalSettings");
    const categoryListEl = document.getElementById("categoryList");
    const previewFrame = document.getElementById("previewFrame");
    const previewStatusEl = document.getElementById("previewStatus");
    const editorMessageEl = document.getElementById("editorMessage");
    const addCategoryBtn = document.getElementById("addCategoryBtn");
    const importJsonBtn = document.getElementById("importJsonBtn");
    const exportJsonBtn = document.getElementById("exportJsonBtn");
    const selectCyoaBtn = document.getElementById("selectCyoaBtn");
    const importFileInput = document.getElementById("importFileInput");

    let previewUpdateHandle = null;
    let pendingPreviewData = null;

    function cloneData(data) {
        return JSON.parse(JSON.stringify(data));
    }

    function showEditorMessage(text, tone = "info", timeout = 4000) {
        if (!editorMessageEl) return;
        editorMessageEl.textContent = text;
        editorMessageEl.dataset.tone = tone;
        if (timeout) {
            setTimeout(() => {
                if (editorMessageEl.textContent === text) {
                    editorMessageEl.textContent = "";
                    delete editorMessageEl.dataset.tone;
                }
            }, timeout);
        }
    }

    function queueTempSave(data) {
        if (!tempSyncState.enabled) return;
        tempSyncState.pendingData = data;
        if (!tempSyncState.saving) {
            void flushTempSaveQueue();
        }
    }

    async function flushTempSaveQueue() {
        if (!tempSyncState.enabled || !tempSyncState.pendingData) return;
        const payload = tempSyncState.pendingData;
        tempSyncState.pendingData = null;
        tempSyncState.saving = true;
        try {
            const endpoint = state.selectedFile
                ? `${CONFIG_ENDPOINT}?file=${encodeURIComponent(state.selectedFile)}`
                : CONFIG_ENDPOINT;
            const res = await fetch(endpoint, {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
        } catch (err) {
            tempSyncState.enabled = false;
            if (!tempSyncState.warningShown) {
                showEditorMessage(`Lost connection to temp file server. Edits will no longer sync: ${err.message}`, "warning", 6000);
                tempSyncState.warningShown = true;
            }
        } finally {
            tempSyncState.saving = false;
            if (tempSyncState.enabled && tempSyncState.pendingData) {
                void flushTempSaveQueue();
            }
        }
    }

    async function loadSelectedConfig() {
        try {
            const endpoint = state.selectedFile
                ? `${CONFIG_ENDPOINT}?file=${encodeURIComponent(state.selectedFile)}`
                : CONFIG_ENDPOINT;
            const res = await fetch(endpoint, {
                cache: "no-store"
            });
            if (!res.ok) {
                return {
                    ok: false,
                    error: `HTTP ${res.status}`
                };
            }
            const data = await res.json();
            if (!Array.isArray(data)) {
                return {
                    ok: false,
                    error: "Config file must contain a JSON array."
                };
            }
            tempSyncState.enabled = true;
            tempSyncState.warningShown = false;
            return {
                ok: true,
                data
            };
        } catch (err) {
            tempSyncState.enabled = false;
            return {
                ok: false,
                error: err?.message || String(err)
            };
        }
    }


    function findInsertIndexForType(type) {
        const orderIndex = CORE_TYPES_ORDER.indexOf(type);
        if (orderIndex === -1) return state.data.length;

        for (let i = orderIndex - 1; i >= 0; i--) {
            const priorType = CORE_TYPES_ORDER[i];
            const idx = state.data.findIndex(entry => entry.type === priorType);
            if (idx !== -1) {
                return idx + 1;
            }
        }
        return 0;
    }

    function ensureEntry(type, factory) {
        let index = state.data.findIndex(entry => entry.type === type);
        if (index !== -1) {
            return {
                entry: state.data[index],
                index
            };
        }
        const value = typeof factory === "function" ? factory() : factory;
        const insertIndex = findInsertIndexForType(type);
        state.data.splice(insertIndex, 0, value);
        return {
            entry: state.data[insertIndex],
            index: insertIndex
        };
    }

    function getCategorySnapshots() {
        const result = [];
        state.data.forEach((entry, index) => {
            if (!entry.type) {
                if (!Array.isArray(entry.subcategories)) {
                    entry.subcategories = [];
                }
                result.push({
                    entry,
                    index
                });
            }
        });
        return result;
    }

    function collectOptionIds() {
        const ids = new Set();
        state.data.forEach(entry => {
            if (!entry.type && Array.isArray(entry.subcategories)) {
                entry.subcategories.forEach(sub => {
                    (sub.options || []).forEach(opt => {
                        if (opt.id) ids.add(opt.id);
                    });
                });
            }
        });
        return ids;
    }

    function slugifyLabel(label) {
        if (typeof label !== "string") return "";
        const words = label.match(/[A-Za-z0-9]+/g);
        if (!words || !words.length) return "";
        const [first, ...rest] = words;
        const firstPart = first.toLowerCase();
        const remainder = rest.map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join("");
        return firstPart + remainder;
    }

    function normalizeIdBase(base) {
        if (base == null) return "option";
        let normalized = String(base).trim();
        normalized = normalized.replace(/[^A-Za-z0-9_]/g, "");
        if (!normalized) normalized = "option";
        if (/^\d/.test(normalized)) {
            normalized = `opt${normalized}`;
        }
        return normalized;
    }

    function shouldAutoManageId(option) {
        if (!option) return false;
        if (!option.id) return true;
        if (/^option/i.test(option.id)) return true;
        const slug = slugifyLabel(option.label || "");
        return Boolean(slug && option.id === slug);
    }

    function generateOptionId(base = "option", {
        skipOption = null
    } = {}) {
        const used = collectOptionIds();
        if (skipOption && skipOption.id) {
            used.delete(skipOption.id);
        }
        const normalized = normalizeIdBase(base);
        let candidate = normalized;
        let attempt = 1;
        while (used.has(candidate)) {
            candidate = `${normalized}${attempt}`;
            attempt += 1;
        }
        return candidate;
    }

    function schedulePreviewUpdate() {
        pendingPreviewData = cloneData(state.data);
        if (previewUpdateHandle) return;
        previewUpdateHandle = setTimeout(() => {
            previewUpdateHandle = null;
            flushPreviewUpdate();
        }, 250);
    }

    function flushPreviewUpdate() {
        if (!state.previewReady || !pendingPreviewData) return;
        const payload = pendingPreviewData;
        if (previewStatusEl) {
            previewStatusEl.textContent = "Updating preview…";
            previewStatusEl.dataset.state = "pending";
        }
        queueTempSave(payload);
        previewFrame.contentWindow.postMessage({
            type: "cyoa-data-update",
            payload
        }, "*");
        pendingPreviewData = null;
    }

    function preventSummaryToggle(element) {
        if (!element) return;
        ["click", "mousedown"].forEach(eventName => {
            element.addEventListener(eventName, (event) => {
                event.stopPropagation();
            });
        });
    }

    function createSectionContainer(title, {
        defaultOpen = true
    } = {}) {
        const details = document.createElement("details");
        details.className = "section-block";
        const stored = sectionOpenState.has(title) ? sectionOpenState.get(title) : defaultOpen;
        if (stored) {
            details.open = true;
        }
        const summary = document.createElement("summary");
        summary.textContent = title;
        const body = document.createElement("div");
        body.className = "section-body";
        details.append(summary, body);
        details.addEventListener("toggle", () => {
            sectionOpenState.set(title, details.open);
        });
        return {
            container: details,
            body,
            summary
        };
    }

    function moveArrayItem(arr, index, direction) {
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= arr.length) return false;
        const temp = arr[index];
        arr[index] = arr[targetIndex];
        arr[targetIndex] = temp;
        return true;
    }

    function keepPanelOpen(category, subcategory) {
        if (category) categoryOpenState.set(category, true);
        if (subcategory) subcategoryOpenState.set(subcategory, true);
    }

    function createDefaultCategory() {
        return {
            name: "New Category",
            subcategories: [createDefaultSubcategory()]
        };
    }

    function createDefaultSubcategory() {
        return {
            name: "New Section",
            type: "storyBlock",
            text: "",
            options: []
        };
    }

    function createDefaultOption() {
        const option = {
            label: "New Option",
            description: "",
            cost: {}
        };
        const base = slugifyLabel(option.label) || "option";
        option.id = generateOptionId(base);
        optionIdAutoMap.set(option, true);
        return option;
    }

    function renderGlobalSettings() {
        const fragment = document.createDocumentFragment();

        const titleEntry = ensureEntry("title", () => ({
            type: "title",
            text: ""
        })).entry;
        const titleSection = createSectionContainer("Title");
        const titleField = document.createElement("div");
        titleField.className = "field";
        const titleLabel = document.createElement("label");
        titleLabel.textContent = "Displayed title";
        titleLabel.htmlFor = "globalTitleInput";
        const titleInput = document.createElement("input");
        titleInput.id = "globalTitleInput";
        titleInput.type = "text";
        titleInput.value = titleEntry.text || "";
        titleInput.placeholder = "Naruto Jumpchain CYOA";
        titleInput.addEventListener("input", () => {
            titleEntry.text = titleInput.value;
            schedulePreviewUpdate();
        });
        titleField.appendChild(titleLabel);
        titleField.appendChild(titleInput);
        titleSection.body.appendChild(titleField);
        fragment.appendChild(titleSection.container);

        const descriptionEntry = ensureEntry("description", () => ({
            type: "description",
            text: ""
        })).entry;
        const descriptionSection = createSectionContainer("Description");
        const descField = document.createElement("div");
        descField.className = "field";
        const descLabel = document.createElement("label");
        descLabel.textContent = "Intro text";
        descLabel.htmlFor = "globalDescriptionInput";
        const descriptionTextarea = document.createElement("textarea");
        descriptionTextarea.id = "globalDescriptionInput";
        descriptionTextarea.value = descriptionEntry.text || "";
        descriptionTextarea.placeholder = "World overview shown under the header.";
        descriptionTextarea.addEventListener("input", () => {
            descriptionEntry.text = descriptionTextarea.value;
            schedulePreviewUpdate();
        });
        descField.appendChild(descLabel);
        descField.appendChild(descriptionTextarea);
        descriptionSection.body.appendChild(descField);
        fragment.appendChild(descriptionSection.container);

        const headerImageEntry = ensureEntry("headerImage", () => ({
            type: "headerImage",
            url: ""
        })).entry;
        const headerSection = createSectionContainer("Header Image");
        const headerField = document.createElement("div");
        headerField.className = "field";
        const headerLabel = document.createElement("label");
        headerLabel.textContent = "Image URL";
        headerLabel.htmlFor = "globalHeaderInput";
        const headerInput = document.createElement("input");
        headerInput.id = "globalHeaderInput";
        headerInput.type = "url";
        headerInput.placeholder = "https://example.com/header.png";
        headerInput.value = headerImageEntry.url || "";
        headerInput.addEventListener("input", () => {
            if (headerInput.value.trim()) {
                headerImageEntry.url = headerInput.value.trim();
            } else {
                delete headerImageEntry.url;
            }
            schedulePreviewUpdate();
        });
        headerField.appendChild(headerLabel);
        headerField.appendChild(headerInput);
        headerSection.body.appendChild(headerField);
        fragment.appendChild(headerSection.container);

        const pointsEntry = ensureEntry("points", () => ({
            type: "points",
            values: {},
            allowNegative: [],
            attributeRanges: {}
        })).entry;
        if (!pointsEntry.values) pointsEntry.values = {};
        if (!Array.isArray(pointsEntry.allowNegative)) pointsEntry.allowNegative = [];
        if (!pointsEntry.attributeRanges) pointsEntry.attributeRanges = {};
        fragment.appendChild(renderPointsSection(pointsEntry));

        const themeEntry = ensureEntry("theme", () => ({
            type: "theme",
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
            "shadow-color": "rgba(0,0,0,0.1)"
        })).entry;
        fragment.appendChild(renderThemeSection(themeEntry));

        globalSettingsEl.innerHTML = "";
        globalSettingsEl.appendChild(fragment);
    }

    function renderPointsSection(pointsEntry) {
        const {
            container,
            body
        } = createSectionContainer("Point Pools");

        const valuesContainer = document.createElement("div");
        valuesContainer.className = "list-stack";

        Object.entries(pointsEntry.values).forEach(([currency, amount]) => {
            const row = document.createElement("div");
            row.className = "list-row";

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = currency;
            nameInput.placeholder = "Currency";

            const valueInput = document.createElement("input");
            valueInput.type = "number";
            valueInput.value = typeof amount === "number" ? amount : 0;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Remove currency";
            removeBtn.textContent = "✕";

            valueInput.addEventListener("input", () => {
                pointsEntry.values[currency] = Number(valueInput.value) || 0;
                schedulePreviewUpdate();
            });

            nameInput.addEventListener("blur", () => {
                const newName = nameInput.value.trim();
                if (!newName || newName === currency) {
                    nameInput.value = currency;
                    return;
                }
                if (pointsEntry.values.hasOwnProperty(newName)) {
                    showEditorMessage(`Currency "${newName}" already exists.`, "warning");
                    nameInput.value = currency;
                    return;
                }
                const existingValue = pointsEntry.values[currency];
                delete pointsEntry.values[currency];
                pointsEntry.values[newName] = existingValue;

                const allowIdx = pointsEntry.allowNegative.indexOf(currency);
                if (allowIdx !== -1) {
                    pointsEntry.allowNegative[allowIdx] = newName;
                }
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            removeBtn.addEventListener("click", () => {
                delete pointsEntry.values[currency];
                pointsEntry.allowNegative = pointsEntry.allowNegative.filter(t => t !== currency);
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            row.appendChild(nameInput);
            row.appendChild(valueInput);
            row.appendChild(removeBtn);
            valuesContainer.appendChild(row);
        });

        const addCurrencyBtn = document.createElement("button");
        addCurrencyBtn.type = "button";
        addCurrencyBtn.className = "button-subtle";
        addCurrencyBtn.textContent = "Add currency";
        addCurrencyBtn.addEventListener("click", () => {
            let base = "New Currency";
            let suffix = 1;
            let candidate = base;
            while (pointsEntry.values.hasOwnProperty(candidate)) {
                suffix += 1;
                candidate = `${base} ${suffix}`;
            }
            pointsEntry.values[candidate] = 0;
            renderGlobalSettings();
            schedulePreviewUpdate();
        });

        body.appendChild(valuesContainer);
        body.appendChild(addCurrencyBtn);

        const negHeading = document.createElement("div");
        negHeading.className = "subheading";
        negHeading.textContent = "Allow negative balances";
        body.appendChild(negHeading);

        const checkboxGrid = document.createElement("div");
        checkboxGrid.className = "checkbox-grid";
        Object.keys(pointsEntry.values).forEach(currency => {
            const label = document.createElement("label");
            label.className = "checkbox-option";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.checked = pointsEntry.allowNegative.includes(currency);
            checkbox.addEventListener("change", () => {
                const idx = pointsEntry.allowNegative.indexOf(currency);
                if (checkbox.checked && idx === -1) {
                    pointsEntry.allowNegative.push(currency);
                }
                if (!checkbox.checked && idx !== -1) {
                    pointsEntry.allowNegative.splice(idx, 1);
                }
                schedulePreviewUpdate();
            });
            label.appendChild(checkbox);
            const span = document.createElement("span");
            span.textContent = currency;
            label.appendChild(span);
            checkboxGrid.appendChild(label);
        });
        body.appendChild(checkboxGrid);

        const rangesHeading = document.createElement("div");
        rangesHeading.className = "subheading";
        rangesHeading.textContent = "Attribute ranges";
        body.appendChild(rangesHeading);

        const rangesContainer = document.createElement("div");
        rangesContainer.className = "list-stack";

        Object.entries(pointsEntry.attributeRanges).forEach(([attr, range]) => {
            const row = document.createElement("div");
            row.className = "list-row";

            const attrInput = document.createElement("input");
            attrInput.type = "text";
            attrInput.value = attr;
            attrInput.placeholder = "Attribute (e.g., Strength)";

            const minInput = document.createElement("input");
            minInput.type = "number";
            minInput.value = typeof range?.min === "number" ? range.min : 0;

            const maxInput = document.createElement("input");
            maxInput.type = "number";
            maxInput.value = typeof range?.max === "number" ? range.max : 0;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Remove attribute";
            removeBtn.textContent = "✕";

            minInput.addEventListener("input", () => {
                pointsEntry.attributeRanges[attr].min = Number(minInput.value) || 0;
                schedulePreviewUpdate();
            });
            maxInput.addEventListener("input", () => {
                pointsEntry.attributeRanges[attr].max = Number(maxInput.value) || 0;
                schedulePreviewUpdate();
            });

            attrInput.addEventListener("blur", () => {
                const newName = attrInput.value.trim();
                if (!newName || newName === attr) {
                    attrInput.value = attr;
                    return;
                }
                if (pointsEntry.attributeRanges.hasOwnProperty(newName)) {
                    showEditorMessage(`Attribute "${newName}" already exists.`, "warning");
                    attrInput.value = attr;
                    return;
                }
                const existing = pointsEntry.attributeRanges[attr];
                delete pointsEntry.attributeRanges[attr];
                pointsEntry.attributeRanges[newName] = existing;
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            removeBtn.addEventListener("click", () => {
                delete pointsEntry.attributeRanges[attr];
                renderGlobalSettings();
                schedulePreviewUpdate();
            });

            row.appendChild(attrInput);
            row.appendChild(minInput);
            row.appendChild(maxInput);
            row.appendChild(removeBtn);
            rangesContainer.appendChild(row);
        });

        const addAttrBtn = document.createElement("button");
        addAttrBtn.type = "button";
        addAttrBtn.className = "button-subtle";
        addAttrBtn.textContent = "Add attribute";
        addAttrBtn.addEventListener("click", () => {
            let base = "Attribute";
            let suffix = 1;
            let candidate = base;
            while (pointsEntry.attributeRanges.hasOwnProperty(candidate)) {
                suffix += 1;
                candidate = `${base} ${suffix}`;
            }
            pointsEntry.attributeRanges[candidate] = {
                min: 0,
                max: 10
            };
            renderGlobalSettings();
            schedulePreviewUpdate();
        });

        body.appendChild(rangesContainer);
        body.appendChild(addAttrBtn);

        return container;
    }

    function renderThemeSection(themeEntry) {
        const {
            container,
            body
        } = createSectionContainer("Theme Settings", {
            defaultOpen: false
        });

        const themes = {
            "bg-color": "Page Background",
            "container-bg": "Content Background",
            "text-color": "Main Text",
            "text-muted": "Muted Text",
            "accent-color": "Primary Accent",
            "accent-text": "Accent Text Color",
            "border-color": "Border Color",
            "item-bg": "Category Background",
            "item-header-bg": "Category Header",
            "points-bg": "Points Tracker Background",
            "points-border": "Points Tracker Border",
            "shadow-color": "Shadow Color"
        };

        const grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "1fr 1fr";
        grid.style.gap = "12px";

        Object.entries(themes).forEach(([key, labelText]) => {
            const field = document.createElement("div");
            field.className = "field";

            const label = document.createElement("label");
            label.textContent = labelText;

            const inputContainer = document.createElement("div");
            inputContainer.style.display = "flex";
            inputContainer.style.gap = "8px";

            const colorInput = document.createElement("input");
            colorInput.type = "color";
            colorInput.style.padding = "0";
            colorInput.style.width = "32px";
            colorInput.style.height = "32px";
            colorInput.style.border = "none";
            colorInput.style.cursor = "pointer";

            const textInput = document.createElement("input");
            textInput.type = "text";
            textInput.style.flex = "1";
            textInput.placeholder = "#RRGGBB";

            // Initialize values
            const val = themeEntry[key] || "";
            textInput.value = val;
            if (val.startsWith("#")) {
                colorInput.value = val.length === 4 ? `#${val[1]}${val[1]}${val[2]}${val[2]}${val[3]}${val[3]}` : val;
            }

            const update = (newVal) => {
                themeEntry[key] = newVal;
                textInput.value = newVal;
                if (newVal.startsWith("#")) {
                    colorInput.value = newVal.length === 4 ? `#${newVal[1]}${newVal[1]}${newVal[2]}${newVal[2]}${newVal[3]}${newVal[3]}` : newVal;
                }
                schedulePreviewUpdate();
            };

            colorInput.addEventListener("input", () => update(colorInput.value));
            textInput.addEventListener("input", () => update(textInput.value));

            inputContainer.append(colorInput, textInput);
            field.append(label, inputContainer);
            grid.appendChild(field);
        });

        body.appendChild(grid);
        return container;
    }



    function renderCategories() {
        const categories = getCategorySnapshots();
        snapshotOpenStates(categories);
        categoryListEl.innerHTML = "";

        if (!categories.length) {
            const emptyState = document.createElement("div");
            emptyState.className = "empty-state";
            emptyState.textContent = "No categories yet. Add one to start structuring your CYOA.";
            categoryListEl.appendChild(emptyState);
            return;
        }

        const categoryIndices = categories.map(cat => cat.index);

        categories.forEach(({ entry: category, index: dataIndex }, position) => {
            const details = document.createElement("details");
            details.className = "category-card";
            const storedOpen = categoryOpenState.has(category) ? categoryOpenState.get(category) : true;
            if (storedOpen) {
                details.open = true;
            }
            details.addEventListener("toggle", () => {
                categoryOpenState.set(category, details.open);
            });

            const summary = document.createElement("summary");
            const summaryLabel = document.createElement("span");
            summaryLabel.className = "summary-label";
            summaryLabel.textContent = category.name?.trim() ? category.name : `Category ${position + 1}`;
            summary.appendChild(summaryLabel);

            const actions = document.createElement("div");
            actions.className = "category-actions";
            preventSummaryToggle(actions);

            const upBtn = document.createElement("button");
            upBtn.type = "button";
            upBtn.className = "button-icon";
            upBtn.disabled = position === 0;
            upBtn.title = "Move category up";
            upBtn.textContent = "↑";
            upBtn.addEventListener("click", (event) => {
                event.preventDefault();
                const targetIndex = categoryIndices[position - 1];
                const currentIndex = categoryIndices[position];
                const temp = state.data[currentIndex];
                state.data[currentIndex] = state.data[targetIndex];
                state.data[targetIndex] = temp;
                keepPanelOpen(category);
                renderCategories();
                schedulePreviewUpdate();
            });

            const downBtn = document.createElement("button");
            downBtn.type = "button";
            downBtn.className = "button-icon";
            downBtn.disabled = position === categoryIndices.length - 1;
            downBtn.title = "Move category down";
            downBtn.textContent = "↓";
            downBtn.addEventListener("click", (event) => {
                event.preventDefault();
                const targetIndex = categoryIndices[position + 1];
                const currentIndex = categoryIndices[position];
                const temp = state.data[currentIndex];
                state.data[currentIndex] = state.data[targetIndex];
                state.data[targetIndex] = temp;
                keepPanelOpen(category);
                renderCategories();
                schedulePreviewUpdate();
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Delete category";
            removeBtn.textContent = "✕";
            removeBtn.addEventListener("click", (event) => {
                event.preventDefault();
                if (!confirm(`Delete category "${category.name || ""}"?`)) return;
                state.data.splice(dataIndex, 1);
                renderCategories();
                schedulePreviewUpdate();
            });

            actions.appendChild(upBtn);
            actions.appendChild(downBtn);
            actions.appendChild(removeBtn);
            summary.appendChild(actions);
            details.appendChild(summary);

            const body = document.createElement("div");
            body.className = "category-body";

            const nameField = document.createElement("div");
            nameField.className = "field";
            const nameLabel = document.createElement("label");
            nameLabel.textContent = "Name";
            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = category.name || "";
            nameInput.placeholder = "Category name";
            nameInput.addEventListener("input", () => {
                category.name = nameInput.value;
                summaryLabel.textContent = nameInput.value.trim() ? nameInput.value : `Category ${position + 1}`;
                schedulePreviewUpdate();
            });
            nameField.appendChild(nameLabel);
            nameField.appendChild(nameInput);
            body.appendChild(nameField);

            const subcategoriesContainer = document.createElement("div");
            subcategoriesContainer.className = "subcategory-list";
            category.subcategories.forEach((subcat, subIndex) => {
                const subDetails = document.createElement("details");
                subDetails.className = "subcategory-item";
                const storedSubOpen = subcategoryOpenState.has(subcat) ? subcategoryOpenState.get(subcat) : subIndex === 0;
                if (storedSubOpen) subDetails.open = true;

                const subSummary = document.createElement("summary");
                const subSummaryLabel = document.createElement("span");
                subSummaryLabel.className = "summary-label";
                subSummaryLabel.textContent = subcat.name || `Subcategory ${subIndex + 1}`;
                subSummary.appendChild(subSummaryLabel);
                subDetails.appendChild(subSummary);
                subDetails.addEventListener("toggle", () => {
                    subcategoryOpenState.set(subcat, subDetails.open);
                });

                const subBody = document.createElement("div");
                subBody.className = "subcategory-body";

                const subNameField = document.createElement("div");
                subNameField.className = "field";
                const subNameLabel = document.createElement("label");
                subNameLabel.textContent = "Name";
                const subNameInput = document.createElement("input");
                subNameInput.type = "text";
                subNameInput.value = subcat.name || "";
                subNameInput.placeholder = "Background";
                subNameInput.addEventListener("input", () => {
                    subcat.name = subNameInput.value;
                    subSummaryLabel.textContent = subcat.name || `Subcategory ${subIndex + 1}`;
                    schedulePreviewUpdate();
                });
                subNameField.appendChild(subNameLabel);
                subNameField.appendChild(subNameInput);
                subBody.appendChild(subNameField);

                const typeField = document.createElement("div");
                typeField.className = "field-inline";
                const typeLabel = document.createElement("label");
                typeLabel.textContent = "Type";
                const typeInput = document.createElement("input");
                typeInput.type = "text";
                typeInput.value = subcat.type || "";
                typeInput.placeholder = "storyBlock";
                typeInput.addEventListener("input", () => {
                    if (typeInput.value.trim()) {
                        subcat.type = typeInput.value.trim();
                    } else {
                        delete subcat.type;
                    }
                    schedulePreviewUpdate();
                });
                typeField.appendChild(typeLabel);
                typeField.appendChild(typeInput);
                subBody.appendChild(typeField);

                const maxRow = document.createElement("div");
                maxRow.className = "field-inline";

                const maxLabel = document.createElement("label");
                maxLabel.textContent = "Max selections";
                const maxInput = document.createElement("input");
                maxInput.type = "number";
                maxInput.value = subcat.maxSelections ?? "";
                maxInput.placeholder = "Leave blank for unlimited";
                maxInput.addEventListener("input", () => {
                    const value = maxInput.value.trim();
                    if (value === "") {
                        delete subcat.maxSelections;
                    } else {
                        subcat.maxSelections = Number(value) || 0;
                    }
                    schedulePreviewUpdate();
                });

                const minLabel = document.createElement("label");
                minLabel.textContent = "Min selections";
                const minInput = document.createElement("input");
                minInput.type = "number";
                minInput.value = subcat.minSelections ?? "";
                minInput.placeholder = "Optional";
                minInput.addEventListener("input", () => {
                    const value = minInput.value.trim();
                    if (value === "") {
                        delete subcat.minSelections;
                    } else {
                        subcat.minSelections = Number(value) || 0;
                    }
                    schedulePreviewUpdate();
                });

                maxRow.appendChild(maxLabel);
                maxRow.appendChild(maxInput);
                maxRow.appendChild(minLabel);
                maxRow.appendChild(minInput);
                subBody.appendChild(maxRow);

                const textField = document.createElement("div");
                textField.className = "field";
                const textLabel = document.createElement("label");
                textLabel.textContent = "Description";
                const textArea = document.createElement("textarea");
                textArea.value = subcat.text || "";
                textArea.placeholder = "Explain how to use this section.";
                textArea.addEventListener("input", () => {
                    subcat.text = textArea.value;
                    schedulePreviewUpdate();
                });
                textField.appendChild(textLabel);
                textField.appendChild(textArea);
                subBody.appendChild(textField);

                const subActions = document.createElement("div");
                subActions.className = "inline-actions";

                const subUpBtn = document.createElement("button");
                subUpBtn.type = "button";
                subUpBtn.className = "button-icon";
                subUpBtn.disabled = subIndex === 0;
                subUpBtn.title = "Move section up";
                subUpBtn.textContent = "↑";
                subUpBtn.addEventListener("click", () => {
                    if (moveArrayItem(category.subcategories, subIndex, -1)) {
                        keepPanelOpen(category, subcat);
                        renderCategories();
                        schedulePreviewUpdate();
                    }
                });

                const subDownBtn = document.createElement("button");
                subDownBtn.type = "button";
                subDownBtn.className = "button-icon";
                subDownBtn.disabled = subIndex === category.subcategories.length - 1;
                subDownBtn.title = "Move section down";
                subDownBtn.textContent = "↓";
                subDownBtn.addEventListener("click", () => {
                    if (moveArrayItem(category.subcategories, subIndex, 1)) {
                        keepPanelOpen(category, subcat);
                        renderCategories();
                        schedulePreviewUpdate();
                    }
                });

                const subRemoveBtn = document.createElement("button");
                subRemoveBtn.type = "button";
                subRemoveBtn.className = "button-icon danger";
                subRemoveBtn.title = "Delete section";
                subRemoveBtn.textContent = "✕";
                subRemoveBtn.addEventListener("click", () => {
                    if (!confirm(`Delete section "${subcat.name || ""}"?`)) return;
                    category.subcategories.splice(subIndex, 1);
                    keepPanelOpen(category);
                    subcategoryOpenState.delete(subcat);
                    renderCategories();
                    schedulePreviewUpdate();
                });

                subActions.appendChild(subUpBtn);
                subActions.appendChild(subDownBtn);
                subActions.appendChild(subRemoveBtn);
                subBody.appendChild(subActions);

                const optionsHeading = document.createElement("div");
                optionsHeading.className = "subheading";
                optionsHeading.textContent = "Options";
                subBody.appendChild(optionsHeading);

                const optionsContainer = document.createElement("div");
                optionsContainer.className = "option-list";
                renderOptionsList(optionsContainer, category, subcat, subIndex);
                subBody.appendChild(optionsContainer);

                const addOptionBtn = document.createElement("button");
                addOptionBtn.type = "button";
                addOptionBtn.className = "button-subtle";
                addOptionBtn.textContent = "Add option";
                addOptionBtn.addEventListener("click", () => {
                    subcat.options = subcat.options || [];
                    subcat.options.push(createDefaultOption());
                    keepPanelOpen(category, subcat);
                    renderCategories();
                    schedulePreviewUpdate();
                });
                subBody.appendChild(addOptionBtn);

                subDetails.appendChild(subBody);
                subcategoriesContainer.appendChild(subDetails);
            });

            body.appendChild(subcategoriesContainer);

            const addSubBtn = document.createElement("button");
            addSubBtn.type = "button";
            addSubBtn.className = "button-subtle";
            addSubBtn.textContent = "Add subcategory";
            addSubBtn.addEventListener("click", () => {
                const newSub = createDefaultSubcategory();
                category.subcategories.push(newSub);
                keepPanelOpen(category, newSub);
                renderCategories();
                schedulePreviewUpdate();
            });
            body.appendChild(addSubBtn);

            details.appendChild(body);
            categoryListEl.appendChild(details);
        });
    }

    function formatOptionSummary(option) {
        const label = option.label || "Untitled option";
        const id = option.id ? ` (${option.id})` : "";
        return `${label}${id}`;
    }

    function renderOptionsList(container, category, subcategory, subIndex) {
        container.innerHTML = "";
        subcategory.options = subcategory.options || [];
        subcategory.options.forEach((option, optionIndex) => {
            const details = document.createElement("details");
            details.className = "option-item";
            if (optionIndex < 2) details.open = true;

            const summary = document.createElement("summary");
            const summaryLabel = document.createElement("span");
            summaryLabel.className = "summary-label";
            summaryLabel.textContent = formatOptionSummary(option);
            summary.appendChild(summaryLabel);

            if (!optionIdAutoMap.has(option)) {
                optionIdAutoMap.set(option, shouldAutoManageId(option));
            }

            const toolbar = document.createElement("div");
            toolbar.className = "option-toolbar";

            const upBtn = document.createElement("button");
            upBtn.type = "button";
            upBtn.className = "button-icon";
            upBtn.disabled = optionIndex === 0;
            upBtn.title = "Move option up";
            upBtn.textContent = "↑";
            upBtn.addEventListener("click", () => {
                if (moveArrayItem(subcategory.options, optionIndex, -1)) {
                    keepPanelOpen(category, subcategory);
                    renderCategories();
                    schedulePreviewUpdate();
                }
            });

            const downBtn = document.createElement("button");
            downBtn.type = "button";
            downBtn.className = "button-icon";
            downBtn.disabled = optionIndex === subcategory.options.length - 1;
            downBtn.title = "Move option down";
            downBtn.textContent = "↓";
            downBtn.addEventListener("click", () => {
                if (moveArrayItem(subcategory.options, optionIndex, 1)) {
                    keepPanelOpen(category, subcategory);
                    renderCategories();
                    schedulePreviewUpdate();
                }
            });

            const cloneBtn = document.createElement("button");
            cloneBtn.type = "button";
            cloneBtn.className = "button-icon";
            cloneBtn.title = "Duplicate option";
            cloneBtn.textContent = "⧉";
            cloneBtn.addEventListener("click", () => {
                const copy = cloneData(option);
                const baseId = option.id ? `${option.id}_copy` : (slugifyLabel(option.label || "") || "option");
                copy.id = generateOptionId(baseId);
                optionIdAutoMap.set(copy, true);
                subcategory.options.splice(optionIndex + 1, 0, copy);
                keepPanelOpen(category, subcategory);
                renderCategories();
                schedulePreviewUpdate();
            });

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.title = "Delete option";
            removeBtn.textContent = "✕";
            removeBtn.addEventListener("click", () => {
                if (!confirm(`Delete option "${option.label || option.id || ""}"?`)) return;
                subcategory.options.splice(optionIndex, 1);
                keepPanelOpen(category, subcategory);
                renderCategories();
                schedulePreviewUpdate();
            });

            toolbar.appendChild(upBtn);
            toolbar.appendChild(downBtn);
            toolbar.appendChild(cloneBtn);
            toolbar.appendChild(removeBtn);
            summary.appendChild(toolbar);
            preventSummaryToggle(toolbar);
            details.appendChild(summary);

            const body = document.createElement("div");
            body.className = "option-body";

            const idField = document.createElement("div");
            idField.className = "field";
            const idLabel = document.createElement("label");
            idLabel.textContent = "ID";
            const idInput = document.createElement("input");
            idInput.type = "text";
            idInput.value = option.id || "";
            idInput.placeholder = "Unique identifier";
            idInput.addEventListener("input", () => {
                option.id = idInput.value.trim();
                optionIdAutoMap.set(option, false);
                summaryLabel.textContent = formatOptionSummary(option);
                schedulePreviewUpdate();
            });
            idInput.addEventListener("blur", () => {
                const trimmed = idInput.value.trim();
                if (!trimmed) {
                    optionIdAutoMap.set(option, true);
                    const slug = slugifyLabel(option.label);
                    const autoBase = slug || "option";
                    const autoId = generateOptionId(autoBase, {
                        skipOption: option
                    });
                    option.id = autoId;
                    idInput.value = autoId;
                } else {
                    const uniqueId = generateOptionId(trimmed, {
                        skipOption: option
                    });
                    if (uniqueId !== trimmed) {
                        showEditorMessage(`ID "${trimmed}" already exists. Renamed to "${uniqueId}".`, "warning", 6000);
                    }
                    option.id = uniqueId;
                    idInput.value = uniqueId;
                }
                summaryLabel.textContent = formatOptionSummary(option);
                schedulePreviewUpdate();
            });
            idField.appendChild(idLabel);
            idField.appendChild(idInput);
            body.appendChild(idField);

            const labelField = document.createElement("div");
            labelField.className = "field";
            const labelLabel = document.createElement("label");
            labelLabel.textContent = "Label";
            const labelInput = document.createElement("input");
            labelInput.type = "text";
            labelInput.value = option.label || "";
            labelInput.placeholder = "Displayed choice text";
            labelInput.addEventListener("input", () => {
                option.label = labelInput.value;
                if (optionIdAutoMap.get(option)) {
                    const slug = slugifyLabel(option.label);
                    const base = slug || "option";
                    const newId = generateOptionId(base, {
                        skipOption: option
                    });
                    option.id = newId;
                    idInput.value = newId;
                }
                summaryLabel.textContent = formatOptionSummary(option);
                schedulePreviewUpdate();
            });
            labelField.appendChild(labelLabel);
            labelField.appendChild(labelInput);
            body.appendChild(labelField);

            const descField = document.createElement("div");
            descField.className = "field";
            const descLabel = document.createElement("label");
            descLabel.textContent = "Description";
            const descTextarea = document.createElement("textarea");
            descTextarea.value = option.description || "";
            descTextarea.placeholder = "Explain what this choice does.";
            descTextarea.addEventListener("input", () => {
                option.description = descTextarea.value;
                schedulePreviewUpdate();
            });
            descField.appendChild(descLabel);
            descField.appendChild(descTextarea);
            body.appendChild(descField);

            const imageField = document.createElement("div");
            imageField.className = "field";
            const imageLabel = document.createElement("label");
            imageLabel.textContent = "Image URL (optional)";
            const imageInput = document.createElement("input");
            imageInput.type = "url";
            imageInput.value = option.image || "";
            imageInput.placeholder = "https://example.com/image.png";
            imageInput.addEventListener("input", () => {
                if (imageInput.value.trim()) {
                    option.image = imageInput.value.trim();
                } else {
                    delete option.image;
                }
                schedulePreviewUpdate();
            });
            imageField.appendChild(imageLabel);
            imageField.appendChild(imageInput);
            body.appendChild(imageField);

            const inputTypeField = document.createElement("div");
            inputTypeField.className = "field-inline";
            const inputTypeLabel = document.createElement("label");
            inputTypeLabel.textContent = "Input type";
            const inputTypeInput = document.createElement("input");
            inputTypeInput.type = "text";
            inputTypeInput.value = option.inputType || "";
            inputTypeInput.placeholder = "button, slider, text...";
            inputTypeInput.addEventListener("input", () => {
                if (inputTypeInput.value.trim()) {
                    option.inputType = inputTypeInput.value.trim();
                } else {
                    delete option.inputType;
                }
                schedulePreviewUpdate();
            });
            const inputLabelLabel = document.createElement("label");
            inputLabelLabel.textContent = "Input label";
            const inputLabelInput = document.createElement("input");
            inputLabelInput.type = "text";
            inputLabelInput.value = option.inputLabel || "";
            inputLabelInput.placeholder = "Shown next to sliders/text inputs";
            inputLabelInput.addEventListener("input", () => {
                if (inputLabelInput.value.trim()) {
                    option.inputLabel = inputLabelInput.value;
                } else {
                    delete option.inputLabel;
                }
                schedulePreviewUpdate();
            });
            inputTypeField.appendChild(inputTypeLabel);
            inputTypeField.appendChild(inputTypeInput);
            inputTypeField.appendChild(inputLabelLabel);
            inputTypeField.appendChild(inputLabelInput);
            body.appendChild(inputTypeField);

            const costSection = document.createElement("div");
            costSection.className = "field";
            const costLabel = document.createElement("label");
            costLabel.textContent = "Cost";
            const costContainer = document.createElement("div");
            costContainer.className = "cost-list";
            renderCostEditor(costContainer, option);
            costSection.appendChild(costLabel);
            costSection.appendChild(costContainer);
            body.appendChild(costSection);

            const advancedKeys = Object.keys(option).filter(key => !BASE_OPTION_KEYS.has(key));
            const advancedSection = document.createElement("div");
            advancedSection.className = "field";
            const advancedLabel = document.createElement("label");
            advancedLabel.textContent = "Advanced fields (JSON)";
            const advancedTextarea = document.createElement("textarea");
            if (advancedKeys.length) {
                const advancedData = {};
                advancedKeys.forEach(key => {
                    advancedData[key] = option[key];
                });
                advancedTextarea.value = JSON.stringify(advancedData, null, 2);
            } else {
                advancedTextarea.placeholder = "{ }";
            }
            advancedTextarea.addEventListener("blur", () => {
                const raw = advancedTextarea.value.trim();
                if (!raw) {
                    advancedKeys.forEach(key => delete option[key]);
                    advancedTextarea.classList.remove("field-error");
                    schedulePreviewUpdate();
                    return;
                }
                try {
                    const parsed = JSON.parse(raw);
                    Object.keys(option).forEach(key => {
                        if (!BASE_OPTION_KEYS.has(key)) delete option[key];
                    });
                    Object.keys(parsed).forEach(key => {
                        option[key] = parsed[key];
                    });
                    advancedTextarea.classList.remove("field-error");
                    schedulePreviewUpdate();
                } catch (err) {
                    advancedTextarea.classList.add("field-error");
                    showEditorMessage(`Advanced JSON error: ${err.message}`, "error", 6000);
                }
            });
            advancedSection.appendChild(advancedLabel);
            advancedSection.appendChild(advancedTextarea);
            body.appendChild(advancedSection);

            details.appendChild(body);
            container.appendChild(details);
        });
    }

    function renderCostEditor(container, option) {
        container.innerHTML = "";
        option.cost = option.cost || {};
        Object.entries(option.cost).forEach(([currency, amount]) => {
            const row = document.createElement("div");
            row.className = "cost-row";

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = currency;
            nameInput.placeholder = "Currency";

            const valueInput = document.createElement("input");
            valueInput.type = "number";
            valueInput.value = typeof amount === "number" ? amount : 0;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.textContent = "✕";
            removeBtn.title = "Remove cost entry";

            valueInput.addEventListener("input", () => {
                option.cost[currency] = Number(valueInput.value) || 0;
                schedulePreviewUpdate();
            });

            nameInput.addEventListener("blur", () => {
                const newName = nameInput.value.trim();
                if (!newName || newName === currency) {
                    nameInput.value = currency;
                    return;
                }
                if (option.cost.hasOwnProperty(newName)) {
                    showEditorMessage(`Duplicate cost key "${newName}"`, "warning");
                    nameInput.value = currency;
                    return;
                }
                const existing = option.cost[currency];
                delete option.cost[currency];
                option.cost[newName] = existing;
                renderCostEditor(container, option);
                schedulePreviewUpdate();
            });

            removeBtn.addEventListener("click", () => {
                delete option.cost[currency];
                renderCostEditor(container, option);
                schedulePreviewUpdate();
            });

            row.appendChild(nameInput);
            row.appendChild(valueInput);
            row.appendChild(removeBtn);
            container.appendChild(row);
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add cost";
        addBtn.addEventListener("click", () => {
            let base = "Currency";
            let suffix = 1;
            let candidate = base;
            while (option.cost.hasOwnProperty(candidate)) {
                suffix += 1;
                candidate = `${base} ${suffix}`;
            }
            option.cost[candidate] = 0;
            renderCostEditor(container, option);
            schedulePreviewUpdate();
        });

        container.appendChild(addBtn);
    }

    async function loadInitialData() {
        let activeSource = "input.json";
        try {
            const tempResult = await tryLoadTempConfig();
            if (tempResult.ok) {
                state.data = tempResult.data;
                activeSource = "temp file";
            } else {
                if (tempResult.error && !tempSyncState.loadFallbackWarned) {
                    showEditorMessage("Temp file server unavailable. Falling back to input.json.", "info");
                    tempSyncState.loadFallbackWarned = true;
                }
                state.data = await loadPrimaryInputJson();
            }
            renderGlobalSettings();
            renderCategories();
            schedulePreviewUpdate();
        } catch (err) {
            showEditorMessage(`Failed to load ${activeSource}: ${err.message}`, "error", 0);
            state.data = [];
            renderGlobalSettings();
            renderCategories();
        }
    }

    function exportJson() {
        const blob = new Blob([JSON.stringify(state.data, null, 2)], {
            type: "application/json"
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "input.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        showEditorMessage("Exported current configuration.", "success");
    }

    function handleImport(text) {
        try {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) throw new Error("Imported JSON must be an array.");
            state.data = parsed;
            renderGlobalSettings();
            renderCategories();
            schedulePreviewUpdate();
            showEditorMessage("Imported configuration.", "success");
        } catch (err) {
            showEditorMessage(`Import failed: ${err.message}`, "error", 6000);
        }
    }

    async function loadInitialData() {
        if (!state.selectedFile) {
            showSelectionModal();
            return;
        }

        // Update preview iframe to load the correct CYOA
        if (previewFrame) {
            previewFrame.src = `index.html?cyoa=${encodeURIComponent(state.selectedFile)}`;
        }

        const config = await loadSelectedConfig();
        if (config.ok) {
            state.data = config.data;
            renderGlobalSettings();
            renderCategories();
            showEditorMessage(`Loaded ${state.selectedFile}`, "success");
            return;
        }

        showEditorMessage(`Failed to load ${state.selectedFile}: ${config.error}`, "error", 10000);
        // If it fails, maybe show the selection modal again after a delay
        setTimeout(() => showSelectionModal(), 3000);
    }

    async function fetchCyoaList() {
        try {
            const res = await fetch("/api/cyoas");
            if (res.ok) return await res.json();
        } catch (e) { }
        return [];
    }

    async function showSelectionModal() {
        const modal = document.getElementById("cyoaSelectionModal");
        const listContainer = document.getElementById("cyoaList");
        if (!modal || !listContainer) return;

        modal.style.display = "block";
        const cyoas = await fetchCyoaList();
        listContainer.innerHTML = "";

        if (cyoas.length === 0) {
            listContainer.innerHTML = "<p>No CYOAs found in CYOAs/ directory.</p>";
            return;
        }

        cyoas.forEach(cyoa => {
            const container = document.createElement("div");
            container.className = "cyoa-item-container";

            const item = document.createElement("div");
            item.className = "cyoa-item";
            item.textContent = cyoa.title || cyoa.filename;
            item.onclick = () => {
                const newUrl = new URL(window.location.href);
                newUrl.searchParams.set('cyoa', cyoa.filename);
                window.location.href = newUrl.toString();
            };

            const deleteBtn = document.createElement("button");
            deleteBtn.type = "button";
            deleteBtn.className = "delete-cyoa-btn";
            deleteBtn.innerHTML = "🗑️";
            deleteBtn.title = "Move to trash";
            deleteBtn.onclick = async (e) => {
                e.stopPropagation();
                if (!confirm(`Move "${cyoa.title || cyoa.filename}" to trash?`)) return;
                try {
                    const res = await fetch(`/api/cyoas?file=${encodeURIComponent(cyoa.filename)}`, {
                        method: "DELETE"
                    });
                    const text = await res.text();
                    let result;
                    try {
                        result = JSON.parse(text);
                    } catch (parseErr) {
                        if (res.status === 404) throw new Error("API endpoint not found. Please restart server.js to enable management features.");
                        throw new Error(text.slice(0, 50) || `Server error ${res.status}`);
                    }
                    if (result.ok) {
                        showEditorMessage(`Moved ${cyoa.filename} to trash.`, "success");
                        // If we deleted the file we are currently editing, redirect to default
                        if (state.selectedFile === cyoa.filename) {
                            window.location.href = window.location.pathname; // Reload without query params
                        } else {
                            showSelectionModal(); // Refresh list
                        }
                    } else {
                        throw new Error(result.error || "Failed to delete");
                    }
                } catch (err) {
                    showEditorMessage(`Delete failed: ${err.message}`, "error");
                }
            };

            container.appendChild(item);
            container.appendChild(deleteBtn);
            listContainer.appendChild(container);
        });
    }

    async function handleCreateCyoa() {
        const titleInput = document.getElementById("newCyoaTitle");
        const title = titleInput.value.trim();
        if (!title) {
            showEditorMessage("Please enter a title for the new CYOA.", "warning");
            return;
        }

        // Generate filename from title
        const filename = title.toLowerCase().replace(/[^a-z0-9]/g, "_") + ".json";

        try {
            const res = await fetch("/api/cyoas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ filename, title })
            });
            const text = await res.text();
            let result;
            try {
                result = JSON.parse(text);
            } catch (parseErr) {
                if (res.status === 404) throw new Error("API endpoint not found. Please restart server.js to enable management features.");
                throw new Error(text.slice(0, 50) || `Server error ${res.status}`);
            }
            if (result.ok) {
                showEditorMessage(`Created ${filename}!`, "success");
                titleInput.value = "";
                showSelectionModal(); // Refresh list
            } else {
                throw new Error(result.error || "Failed to create");
            }
        } catch (err) {
            showEditorMessage(`Create failed: ${err.message}`, "error");
        }
    }

    function setupEventListeners() {
        selectCyoaBtn?.addEventListener("click", () => {
            showSelectionModal();
        });

        document.getElementById("closeSelectionModal")?.addEventListener("click", () => {
            const modal = document.getElementById("cyoaSelectionModal");
            if (modal) modal.style.display = "none";
        });

        document.getElementById("confirmCreateCyoaBtn")?.addEventListener("click", () => {
            handleCreateCyoa();
        });

        document.getElementById("newCyoaTitle")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") handleCreateCyoa();
        });

        addCategoryBtn?.addEventListener("click", () => {
            state.data.push(createDefaultCategory());
            renderCategories();
            schedulePreviewUpdate();
        });

        importJsonBtn?.addEventListener("click", () => {
            importFileInput?.click();
        });

        exportJsonBtn?.addEventListener("click", () => {
            exportJson();
        });

        importFileInput?.addEventListener("change", async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                handleImport(text);
            } finally {
                importFileInput.value = "";
            }
        });

        previewFrame?.addEventListener("load", () => {
            state.previewReady = true;
            if (previewStatusEl) {
                previewStatusEl.textContent = "Preview ready";
                previewStatusEl.dataset.state = "ready";
            }
            flushPreviewUpdate();
        });

        window.addEventListener("message", (event) => {
            if (!event.data) return;
            if (event.data.type === "cyoa-data-update-result") {
                if (event.data.success) {
                    state.lastPreviewError = null;
                    if (previewStatusEl) {
                        previewStatusEl.textContent = "Preview up to date";
                        previewStatusEl.dataset.state = "success";
                    }
                } else {
                    state.lastPreviewError = event.data.error || "Unknown error";
                    if (previewStatusEl) {
                        previewStatusEl.textContent = `Preview error: ${state.lastPreviewError}`;
                        previewStatusEl.dataset.state = "error";
                    }
                }
            }
        });
    }

    setupEventListeners();
    loadInitialData();
})();
