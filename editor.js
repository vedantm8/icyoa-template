(function () {
    const CORE_TYPES_ORDER = ["title", "description", "headerImage", "points"];
    const BASE_OPTION_KEYS = new Set(["id", "label", "description", "image", "inputType", "inputLabel", "cost", "maxSelections", "prerequisites", "conflictsWith", "discounts", "discountGrants"]);

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
    const optionOpenState = new WeakMap();

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

                const optEls = subEl.querySelectorAll(".option-item");
                (subcat.options || []).forEach((opt, optIdx) => {
                    const optEl = optEls[optIdx];
                    if (!optEl) return;
                    optionOpenState.set(opt, optEl.open);
                });
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

    function scrollPreviewToExample(selector) {
        if (!previewFrame?.contentWindow || !previewFrame.contentDocument) return;
        try {
            const doc = previewFrame.contentDocument;
            const target = doc.querySelector(selector);
            if (!target) return;
            target.scrollIntoView({
                behavior: "smooth",
                block: "center"
            });
        } catch (err) {
            // Ignore cross-origin or access errors.
        }
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

    function ensureEntry(type, factory, options = {}) {
        let index = state.data.findIndex(entry => entry.type === type);
        let entry;
        if (index !== -1) {
            entry = state.data[index];
            if (options.mergeDefaults) {
                const defaults = typeof factory === "function" ? factory() : factory;
                Object.entries(defaults).forEach(([key, val]) => {
                    if (!Object.prototype.hasOwnProperty.call(entry, key)) {
                        entry[key] = val;
                    }
                });
            }
            return {
                entry,
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

    function normalizeIdList(value) {
        if (!value) return [];
        const raw = Array.isArray(value) ? value : String(value).split(/[,\n]/g);
        return Array.from(new Set(raw.map(id => String(id || "").trim()).filter(Boolean)));
    }

    const RESERVED_EXPR_IDENTIFIERS = new Set([
        "true", "false", "null", "undefined", "if", "else", "return", "let", "var", "const",
        "function", "while", "for", "do", "switch", "case", "break", "continue", "default",
        "new", "this", "typeof", "instanceof", "void", "delete", "in", "of", "with", "try",
        "catch", "finally", "throw", "class", "extends", "super", "import", "export", "from",
        "as", "await", "async", "yield"
    ]);

    function formatPrerequisiteValue(value) {
        if (value == null || value === "") return "";
        if (typeof value === "string") return value;
        if (Array.isArray(value)) return value.join(", ");
        if (typeof value === "object") return JSON.stringify(value);
        return String(value);
    }

    function parsePrerequisiteValue(raw) {
        const text = String(raw || "").trim();
        if (!text) return { value: null, error: null };

        if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
            try {
                return { value: JSON.parse(text), error: null };
            } catch (err) {
                return { value: null, error: `Prerequisite JSON is invalid: ${err.message}` };
            }
        }

        if (/[()!&|]/.test(text)) {
            return { value: text, error: null };
        }

        const ids = normalizeIdList(text);
        if (!ids.length) return { value: null, error: null };
        return { value: ids.length === 1 ? ids[0] : ids, error: null };
    }

    function extractReferencedIds(value) {
        const ids = new Set();
        if (!value) return ids;

        if (typeof value === "string") {
            const tokens = value.match(/!?[A-Za-z_][A-Za-z0-9_]*(?:__\d+)?/g) || [];
            tokens.forEach(token => {
                const core = token.startsWith("!") ? token.slice(1) : token;
                const [id] = core.split("__");
                if (id && !RESERVED_EXPR_IDENTIFIERS.has(id)) ids.add(id);
            });
            return ids;
        }

        if (Array.isArray(value)) {
            normalizeIdList(value).forEach(id => {
                const [base] = String(id).split("__");
                if (base) ids.add(base);
            });
            return ids;
        }

        if (typeof value === "object") {
            const fromAnd = normalizeIdList(value.and || []);
            const fromOr = normalizeIdList(value.or || []);
            [...fromAnd, ...fromOr].forEach(id => {
                const [base] = String(id).split("__");
                if (base) ids.add(base);
            });
        }

        return ids;
    }

    function getOptionValidationWarnings(option) {
        const warnings = [];
        const allIds = collectOptionIds();
        const selfId = String(option?.id || "").trim();

        const prereqIds = Array.from(extractReferencedIds(option?.prerequisites));
        prereqIds.forEach(id => {
            if (id === selfId && selfId) warnings.push("Prerequisite references this option itself.");
            if (!allIds.has(id)) warnings.push(`Prerequisite references unknown option ID "${id}".`);
        });

        const rawConflicts = Array.isArray(option?.conflictsWith) ? option.conflictsWith : [];
        const conflicts = normalizeIdList(rawConflicts);
        if (rawConflicts.length !== conflicts.length) {
            warnings.push("Incompatible option list contains duplicates or blank IDs.");
        }
        conflicts.forEach(id => {
            if (id === selfId && selfId) warnings.push("Incompatible option list contains this option itself.");
            if (!allIds.has(id)) warnings.push(`Incompatible option ID "${id}" does not exist.`);
        });

        const rules = Array.isArray(option?.discounts) ? option.discounts : [];
        rules.forEach((rule, index) => {
            const ruleNo = index + 1;
            const ids = normalizeIdList(rule?.idsAny || rule?.ids || (rule?.id ? [rule.id] : []));
            if (!ids.length) warnings.push(`Rule ${ruleNo}: add at least one trigger option ID.`);
            ids.forEach(id => {
                if (id === selfId && selfId) warnings.push(`Rule ${ruleNo}: trigger list includes this option itself.`);
                if (!allIds.has(id)) warnings.push(`Rule ${ruleNo}: trigger ID "${id}" does not exist.`);
            });
            if (Array.isArray(rule?.idsAny)) {
                const min = Math.max(1, Number(rule?.minSelected) || 1);
                if (min > ids.length && ids.length > 0) {
                    warnings.push(`Rule ${ruleNo}: "Min selected" (${min}) is greater than trigger IDs (${ids.length}).`);
                }
            }
            if (!rule?.cost || !Object.keys(rule.cost).length) {
                warnings.push(`Rule ${ruleNo}: discounted cost map is empty.`);
            }
        });

        const grantRules = Array.isArray(option?.discountGrants) ? option.discountGrants : [];
        grantRules.forEach((rule, index) => {
            const ruleNo = index + 1;
            const targets = normalizeIdList(rule?.targetIds || rule?.targets || (rule?.targetId ? [rule.targetId] : []));
            if (!targets.length) {
                warnings.push(`Grant rule ${ruleNo}: add at least one target option ID.`);
            }
            targets.forEach(id => {
                if (id === selfId && selfId) warnings.push(`Grant rule ${ruleNo}: target list includes this option itself.`);
                if (!allIds.has(id)) warnings.push(`Grant rule ${ruleNo}: target option ID "${id}" does not exist.`);
            });
            const slots = Number(rule?.slots) || 0;
            if (slots < 1) {
                warnings.push(`Grant rule ${ruleNo}: slots must be at least 1.`);
            }
        });

        return Array.from(new Set(warnings));
    }

    function getSortedOptionIds(excludeIds = []) {
        const exclude = new Set(normalizeIdList(excludeIds));
        return Array.from(collectOptionIds())
            .filter(id => id && !exclude.has(id))
            .sort((a, b) => a.localeCompare(b));
    }

    let optionDatalistCounter = 0;

    function mountIdListEditor(container, {
        ids = [],
        excludeIds = [],
        emptyText = "No option IDs selected yet.",
        onChange
    } = {}) {
        if (!container) return;
        const normalized = normalizeIdList(ids);
        container.innerHTML = "";

        const list = document.createElement("div");
        list.className = "list-stack";
        if (!normalized.length) {
            const empty = document.createElement("div");
            empty.className = "empty-state";
            empty.textContent = emptyText;
            list.appendChild(empty);
        } else {
            normalized.forEach(id => {
                const row = document.createElement("div");
                row.className = "option-rule-row";

                const input = document.createElement("input");
                input.type = "text";
                input.value = id;
                input.readOnly = true;

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "button-icon danger";
                removeBtn.title = "Remove";
                removeBtn.textContent = "✕";
                removeBtn.addEventListener("click", () => {
                    const next = normalized.filter(entry => entry !== id);
                    onChange?.(next);
                });

                row.appendChild(input);
                row.appendChild(removeBtn);
                list.appendChild(row);
            });
        }
        container.appendChild(list);

        const addRow = document.createElement("div");
        addRow.className = "option-rule-row";

        const input = document.createElement("input");
        input.type = "text";
        input.placeholder = "Add option ID";

        const datalist = document.createElement("datalist");
        const datalistId = `option-id-list-${++optionDatalistCounter}`;
        datalist.id = datalistId;
        getSortedOptionIds([...excludeIds, ...normalized]).forEach(id => {
            const opt = document.createElement("option");
            opt.value = id;
            datalist.appendChild(opt);
        });
        input.setAttribute("list", datalistId);

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add";
        const commit = () => {
            const nextId = input.value.trim();
            if (!nextId) return;
            if (normalized.includes(nextId)) {
                showEditorMessage(`"${nextId}" is already in this list.`, "warning", 3000);
                return;
            }
            if (excludeIds.includes(nextId)) {
                showEditorMessage(`"${nextId}" is not allowed here.`, "warning", 3000);
                return;
            }
            onChange?.([...normalized, nextId]);
        };
        addBtn.addEventListener("click", commit);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                event.preventDefault();
                commit();
            }
        });

        addRow.appendChild(input);
        addRow.appendChild(addBtn);
        container.appendChild(addRow);
        container.appendChild(datalist);
    }

    function slugifyLabel(label) {
        if (typeof label !== "string") return "";
        // Split by transitions between lowercase and uppercase, and match all alphanumeric groups
        const words = label.replace(/([a-z])([A-Z])/g, "$1 $2").match(/[A-Za-z0-9]+/g);
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

    function shouldAutoManageId(option, path = []) {
        if (!option) return false;
        if (!option.id) return true;
        if (/^option/i.test(option.id)) return true;

        // Check if current ID matches what generateOptionId would produce (without uniqueness attempt)
        const fullParts = [...path, option.label || ""].filter(Boolean);
        const expectedBase = fullParts.map((p, i) => {
            const s = slugifyLabel(p);
            return i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
        }).join("");

        const normalized = normalizeIdBase(expectedBase);
        // It's auto-managed if it matches the pattern or any number-suffixed version of the pattern (case-insensitive)
        const regex = new RegExp(`^${normalized}\\d*$`, "i");
        return regex.test(option.id);
    }

    function generateOptionId(label = "option", {
        path = [],
        skipOption = null
    } = {}) {
        const used = collectOptionIds();
        if (skipOption && skipOption.id) {
            used.delete(skipOption.id);
        }

        // Combine path parts and label
        const fullParts = [...path, label].filter(Boolean);
        const base = fullParts.map((p, i) => {
            const s = slugifyLabel(p);
            // Capitalize first letter of subsequent parts for camelCase
            return i === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1);
        }).join("");

        const normalized = normalizeIdBase(base);
        let candidate = normalized;
        let attempt = 1;
        while (used.has(candidate)) {
            candidate = `${normalized}${attempt}`;
            attempt += 1;
        }
        return candidate;
    }

    function syncOptionIds(path, options = []) {
        if (!Array.isArray(options)) return;
        options.forEach(opt => {
            if (optionIdAutoMap.get(opt) || shouldAutoManageId(opt, path)) {
                optionIdAutoMap.set(opt, true);
                opt.id = generateOptionId(opt.label, { path, skipOption: opt });
            }
        });
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

    function slugifyKey(str) {
        return String(str || "").replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\-]/g, '');
    }

    function buildSubcategoryKey(catIndex, catName, subIndex, subName) {
        const catPart = `${catIndex}-${slugifyKey(catName || `Category${catIndex}`)}`;
        const subPart = `${subIndex}-${slugifyKey(subName || `Sub${subIndex}`)}`;
        return `${catPart}__${subPart}`;
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

    function createDefaultOption(categoryName = "", subcategoryName = "") {
        const option = {
            label: "New Option",
            description: "",
            cost: {}
        };
        const path = [];
        if (categoryName) path.push(categoryName);
        if (subcategoryName) path.push(subcategoryName);

        option.id = generateOptionId(option.label, { path });
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

        // Prevent upscaling toggle
        const preventField = document.createElement("div");
        preventField.className = "field";
        const preventInput = document.createElement("input");
        preventInput.type = "checkbox";
        preventInput.id = "preventUpscaleCheckbox";
        preventInput.checked = !!headerImageEntry.preventUpscale;
        preventInput.addEventListener("change", () => {
            headerImageEntry.preventUpscale = preventInput.checked;
            if (!headerImageEntry.preventUpscale) delete headerImageEntry.preventUpscale;
            schedulePreviewUpdate();
        });
        const preventLabel = document.createElement("label");
        preventLabel.htmlFor = preventInput.id;
        preventLabel.textContent = "Prevent upscaling (don't stretch small images)";
        preventField.appendChild(preventInput);
        preventField.appendChild(preventLabel);
        headerSection.body.appendChild(preventField);

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

        const backpackEntry = ensureEntry("backpack", () => ({
            type: "backpack",
            enabled: false
        })).entry;
        fragment.appendChild(renderBackpackSection(backpackEntry));

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
            "shadow-color": "rgba(0,0,0,0.1)",
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
        }), {
            mergeDefaults: true
        }).entry;
        fragment.appendChild(renderThemeSection(themeEntry));
        fragment.appendChild(renderTypographySection(themeEntry));

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

    function renderBackpackSection(backpackEntry) {
        const {
            container,
            body
        } = createSectionContainer("Backpack Feature", {
            defaultOpen: false
        });

        const field = document.createElement("div");
        field.className = "field-inline";

        const label = document.createElement("label");
        label.textContent = "Enable Backpack";

        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = backpackEntry.enabled || false;
        checkbox.addEventListener("change", () => {
            backpackEntry.enabled = checkbox.checked;
            schedulePreviewUpdate();
        });

        field.appendChild(checkbox);
        field.appendChild(label);
        body.appendChild(field);

        const description = document.createElement("p");
        description.style.fontSize = "12px";
        description.style.color = "var(--text-muted)";
        description.innerHTML = "When enabled, shows a button at the bottom of the page that displays all selected choices in a modal that can be downloaded as an image.";
        body.appendChild(description);

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

    function renderTypographySection(themeEntry) {
        const {
            container,
            body
        } = createSectionContainer("Typography Settings", {
            defaultOpen: false
        });

        const previewTargets = {
            "font-base": ".container",
            "font-title": "#cyoaTitle",
            "font-description": "#cyoaDescription",
            "font-tab": ".tab-navigation .tab-button",
            "font-accordion": ".accordion-header",
            "font-subcategory": ".subcategory-content-title",
            "font-option-title": ".option-content strong",
            "font-option-req": ".option-requirements",
            "font-option-desc": ".option-description",
            "font-story": ".story-block",
            "font-story-input": ".story-input-wrapper input",
            "font-points": "#pointsTracker",
            "font-points-value": "#pointsDisplay span",
            "font-prereq-help": ".prereq-help",
            "font-label": ".story-input-wrapper label, .dynamic-choice-wrapper label, .slider-wrapper label"
        };

        const typography = {
            "font-base": "Base Text",
            "font-title": "Title",
            "font-description": "Description",
            "font-tab": "Tab Label",
            "font-accordion": "Category Header",
            "font-subcategory": "Subcategory Header",
            "font-option-title": "Option Title",
            "font-option-req": "Option Requirements",
            "font-option-desc": "Option Description",
            "font-story": "Story Block",
            "font-story-input": "Story Input",
            "font-points": "Points Tracker",
            "font-points-value": "Points Values",
            "font-prereq-help": "Prereq Help Badge",
            "font-label": "Labels"
        };

        const grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = "1fr 1fr";
        grid.style.gap = "12px";

        Object.entries(typography).forEach(([key, labelText]) => {
            const field = document.createElement("div");
            field.className = "field";

            const label = document.createElement("label");
            label.textContent = `${labelText} (px)`;

            const inputRow = document.createElement("div");
            inputRow.className = "field-inline";

            const previewBtn = document.createElement("button");
            previewBtn.type = "button";
            previewBtn.className = "button-subtle";
            previewBtn.textContent = "Preview";
            previewBtn.title = "Jump to an example in the preview";
            previewBtn.addEventListener("click", () => {
                const selector = previewTargets[key];
                if (selector) scrollPreviewToExample(selector);
            });

            const input = document.createElement("input");
            input.type = "number";
            input.min = "8";
            input.step = "1";

            const defaults = {
                "font-base": 16,
                "font-title": 28,
                "font-description": 16,
                "font-tab": 15,
                "font-accordion": 16,
                "font-subcategory": 16,
                "font-option-title": 15,
                "font-option-req": 13,
                "font-option-desc": 13,
                "font-story": 15,
                "font-story-input": 14,
                "font-points": 14,
                "font-points-value": 14,
                "font-prereq-help": 12,
                "font-label": 14
            };

            const raw = themeEntry[key];
            const numeric = typeof raw === "string" ? parseFloat(raw) : (typeof raw === "number" ? raw : NaN);
            const initialVal = Number.isFinite(numeric) ? numeric : (defaults[key] || 16);
            input.value = initialVal;
            input.placeholder = `e.g. ${defaults[key] || 16}`;

            const range = document.createElement("input");
            range.type = "range";
            range.min = "8";
            range.max = "60";
            range.step = "1";
            range.value = initialVal;

            const applyValue = (value) => {
                if (value === "") {
                    delete themeEntry[key];
                } else {
                    themeEntry[key] = `${Number(value) || 0}px`;
                }
                schedulePreviewUpdate();
            };

            input.addEventListener("input", () => {
                const value = input.value.trim();
                if (value !== "") range.value = value;
                applyValue(value);
            });

            range.addEventListener("input", () => {
                input.value = range.value;
                applyValue(range.value);
            });

            inputRow.appendChild(previewBtn);
            inputRow.appendChild(range);
            inputRow.appendChild(input);
            field.appendChild(label);
            field.appendChild(inputRow);
            grid.appendChild(field);
        });

        body.appendChild(grid);
        return container;
    }

    function getPointTypeNames() {
        const pointsEntry = state.data.find(entry => entry.type === "points");
        const names = Object.keys(pointsEntry?.values || {});
        return names.length ? names : ["Points"];
    }

    function renderPointTypeAmountControls(parent, {
        labelPrefix,
        getMap,
        setMap,
        placeholder = "e.g. 1"
    }) {
        const container = document.createElement("div");
        container.className = "point-type-amount-controls";
        parent.appendChild(container);

        const render = () => {
            container.innerHTML = "";
            const map = getMap() || {};
            const allTypes = getPointTypeNames();
            const activeTypes = Object.keys(map);

            if (activeTypes.length === 0) {
                const empty = document.createElement("div");
                empty.className = "field-note";
                empty.textContent = "No point types configured.";
                container.appendChild(empty);
            }

            activeTypes.forEach(type => {
                const row = document.createElement("div");
                row.className = "field-inline";

                const label = document.createElement("label");
                label.textContent = `${labelPrefix} (${type})`;

                const input = document.createElement("input");
                input.type = "number";
                input.value = (typeof map[type] === "number") ? map[type] : "";
                input.placeholder = placeholder;
                input.addEventListener("input", () => {
                    const value = input.value.trim();
                    let nextMap = getMap() || {};
                    if (value === "") {
                        delete nextMap[type];
                        if (Object.keys(nextMap).length === 0) {
                            setMap(null);
                        } else {
                            setMap(nextMap);
                        }
                    } else {
                        nextMap[type] = Number(value) || 0;
                        setMap(nextMap);
                    }
                    render();
                    schedulePreviewUpdate();
                });

                const removeBtn = document.createElement("button");
                removeBtn.type = "button";
                removeBtn.className = "button-icon danger";
                removeBtn.textContent = "✕";
                removeBtn.title = `Remove ${type}`;
                removeBtn.addEventListener("click", () => {
                    const nextMap = getMap() || {};
                    delete nextMap[type];
                    if (Object.keys(nextMap).length === 0) {
                        setMap(null);
                    } else {
                        setMap(nextMap);
                    }
                    render();
                    schedulePreviewUpdate();
                });

                row.appendChild(label);
                row.appendChild(input);
                row.appendChild(removeBtn);
                container.appendChild(row);
            });

            const addRow = document.createElement("div");
            addRow.className = "field-inline";

            const addLabel = document.createElement("label");
            addLabel.textContent = `Add ${labelPrefix} type`;

            const select = document.createElement("select");
            const available = allTypes.filter(type => !activeTypes.includes(type));
            const placeholderOption = document.createElement("option");
            placeholderOption.value = "";
            placeholderOption.textContent = available.length ? "Select type" : "No more types";
            select.appendChild(placeholderOption);
            available.forEach(type => {
                const opt = document.createElement("option");
                opt.value = type;
                opt.textContent = type;
                select.appendChild(opt);
            });

            const addBtn = document.createElement("button");
            addBtn.type = "button";
            addBtn.className = "button-subtle";
            addBtn.textContent = "Add";
            addBtn.disabled = available.length === 0;
            addBtn.addEventListener("click", () => {
                const selected = select.value;
                if (!selected) return;
                const nextMap = getMap() || {};
                if (!Object.prototype.hasOwnProperty.call(nextMap, selected)) {
                    nextMap[selected] = 0;
                }
                setMap(nextMap);
                render();
                schedulePreviewUpdate();
            });

            addRow.appendChild(addLabel);
            addRow.appendChild(select);
            addRow.appendChild(addBtn);
            container.appendChild(addRow);
        };

        render();
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

                // Sync all options in this category
                (category.subcategories || []).forEach(sub => {
                    syncOptionIds([category.name, sub.name], sub.options);
                });

                schedulePreviewUpdate();
            });
            nameField.appendChild(nameLabel);
            nameField.appendChild(nameInput);
            body.appendChild(nameField);

            const requiresField = document.createElement("div");
            requiresField.className = "field";
            const requiresLabel = document.createElement("label");
            requiresLabel.textContent = "Requires Option (Optional)";
            const requiresInput = document.createElement("input");
            requiresInput.type = "text";
            requiresInput.value = category.requiresOption || "";
            requiresInput.placeholder = "e.g. some_id && !another_id";
            requiresInput.addEventListener("input", () => {
                if (requiresInput.value.trim()) {
                    category.requiresOption = requiresInput.value.trim();
                } else {
                    delete category.requiresOption;
                }
                schedulePreviewUpdate();
            });
            requiresField.appendChild(requiresLabel);
            requiresField.appendChild(requiresInput);
            body.appendChild(requiresField);

            const categoryMaxRow = document.createElement("div");
            categoryMaxRow.className = "field-inline";
            const categoryMaxLabel = document.createElement("label");
            categoryMaxLabel.textContent = "Max selections (category)";
            const categoryMaxInput = document.createElement("input");
            categoryMaxInput.type = "number";
            categoryMaxInput.min = "1";
            const initialCategoryMax = category.maxSelections ?? (category.singleSelectionOnly === true ? 1 : "");
            categoryMaxInput.value = initialCategoryMax;
            categoryMaxInput.placeholder = "Leave blank for unlimited";
            categoryMaxInput.addEventListener("input", () => {
                const value = categoryMaxInput.value.trim();
                const num = Number(value);
                if (value === "") {
                    delete category.maxSelections;
                    delete category.singleSelectionOnly;
                } else if (!Number.isFinite(num) || num < 1) {
                    category.maxSelections = 1;
                    delete category.singleSelectionOnly;
                    categoryMaxInput.value = "1";
                } else {
                    category.maxSelections = Math.floor(num);
                    delete category.singleSelectionOnly;
                }
                schedulePreviewUpdate();
            });
            categoryMaxRow.appendChild(categoryMaxLabel);
            categoryMaxRow.appendChild(categoryMaxInput);
            body.appendChild(categoryMaxRow);

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

                    // Sync all options in this subcategory
                    syncOptionIds([category.name, subcat.name], subcat.options);

                    schedulePreviewUpdate();
                });
                subNameField.appendChild(subNameLabel);
                subNameField.appendChild(subNameInput);
                subBody.appendChild(subNameField);

                const subRequiresField = document.createElement("div");
                subRequiresField.className = "field";
                const subRequiresLabel = document.createElement("label");
                subRequiresLabel.textContent = "Requires Option (Optional)";
                const subRequiresInput = document.createElement("input");
                subRequiresInput.type = "text";
                subRequiresInput.value = subcat.requiresOption || "";
                subRequiresInput.placeholder = "e.g. some_id && !another_id";
                subRequiresInput.addEventListener("input", () => {
                    if (subRequiresInput.value.trim()) {
                        subcat.requiresOption = subRequiresInput.value.trim();
                    } else {
                        delete subcat.requiresOption;
                    }
                    schedulePreviewUpdate();
                });
                subRequiresField.appendChild(subRequiresLabel);
                subRequiresField.appendChild(subRequiresInput);
                subBody.appendChild(subRequiresField);

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

                // Discount controls
                const discountRow = document.createElement("div");
                discountRow.className = "field-inline";

                const discountFirstLabel = document.createElement("label");
                discountFirstLabel.textContent = "Discount: first N";
                const discountFirstInput = document.createElement("input");
                discountFirstInput.type = "number";
                discountFirstInput.value = subcat.discountFirstN ?? "";
                discountFirstInput.placeholder = "e.g. 1";


                discountFirstInput.addEventListener("input", () => {
                    const value = discountFirstInput.value.trim();
                    if (value === "") {
                        delete subcat.discountFirstN;
                    } else {
                        subcat.discountFirstN = Number(value) || 0;
                    }
                    schedulePreviewUpdate();
                });

                discountRow.appendChild(discountFirstLabel);
                discountRow.appendChild(discountFirstInput);
                subBody.appendChild(discountRow);

                renderPointTypeAmountControls(subBody, {
                    labelPrefix: "Discount Amount",
                    getMap: () => subcat.discountAmount,
                    setMap: (next) => {
                        if (next) {
                            subcat.discountAmount = next;
                        } else {
                            delete subcat.discountAmount;
                        }
                    }
                });

                // Default cost (subcategory) controls
                renderPointTypeAmountControls(subBody, {
                    labelPrefix: "Default cost",
                    getMap: () => subcat.defaultCost,
                    setMap: (next) => {
                        if (next) {
                            subcat.defaultCost = next;
                        } else {
                            delete subcat.defaultCost;
                        }
                    }
                });

                const columnsRow = document.createElement("div");
                columnsRow.className = "field-inline";




                const columnsLabel = document.createElement("label");
                columnsLabel.textContent = "Columns per row";
                const columnsInput = document.createElement("input");
                columnsInput.type = "number";
                columnsInput.min = "1";
                columnsInput.value = subcat.columnsPerRow ?? 2;
                columnsInput.placeholder = "2";
                columnsInput.addEventListener("input", () => {
                    const value = columnsInput.value.trim();
                    const num = Number(value);
                    if (value === "" || num < 1) {
                        subcat.columnsPerRow = 2;
                        columnsInput.value = 2;
                    } else {
                        subcat.columnsPerRow = num;
                    }
                    schedulePreviewUpdate();
                });

                columnsRow.appendChild(columnsLabel);
                columnsRow.appendChild(columnsInput);
                subBody.appendChild(columnsRow);

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
                    subcat.options.push(createDefaultOption(category.name, subcat.name));
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

            const storedOpen = optionOpenState.has(option) ? optionOpenState.get(option) : optionIndex < 2;
            if (storedOpen) {
                details.open = true;
            }
            details.addEventListener("toggle", () => {
                optionOpenState.set(option, details.open);
            });

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
                const baseId = option.id ? `${option.id}_copy` : (option.label || "option");
                copy.id = generateOptionId(baseId, {
                    path: [category.name, subcategory.name]
                });
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

            const validationBox = document.createElement("div");
            validationBox.className = "inline-warning-list";
            const refreshOptionWarnings = (extraWarnings = []) => {
                const warnings = [...extraWarnings, ...getOptionValidationWarnings(option)];
                validationBox.innerHTML = "";
                if (!warnings.length) {
                    validationBox.style.display = "none";
                    return;
                }
                validationBox.style.display = "block";
                warnings.forEach(text => {
                    const row = document.createElement("div");
                    row.className = "inline-warning";
                    row.textContent = `⚠ ${text}`;
                    validationBox.appendChild(row);
                });
            };
            body.appendChild(validationBox);

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
                refreshOptionWarnings();
                schedulePreviewUpdate();
            });
            idInput.addEventListener("blur", () => {
                const trimmed = idInput.value.trim();
                const path = [category.name, subcategory.name];
                if (!trimmed) {
                    optionIdAutoMap.set(option, true);
                    const autoId = generateOptionId(option.label || "option", {
                        path,
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
                refreshOptionWarnings();
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
                    const newId = generateOptionId(option.label, {
                        path: [category.name, subcategory.name],
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

            const optionLimitField = document.createElement("div");
            optionLimitField.className = "field-inline";
            const optionLimitLabel = document.createElement("label");
            optionLimitLabel.textContent = "Max selections";
            const optionLimitInput = document.createElement("input");
            optionLimitInput.type = "number";
            optionLimitInput.min = "1";
            optionLimitInput.value = option.maxSelections ?? "";
            optionLimitInput.placeholder = "Default: 1";
            optionLimitInput.addEventListener("input", () => {
                const raw = optionLimitInput.value.trim();
                if (!raw) {
                    delete option.maxSelections;
                } else {
                    const parsed = Math.max(1, Number(raw) || 1);
                    option.maxSelections = parsed;
                    optionLimitInput.value = String(parsed);
                }
                schedulePreviewUpdate();
            });
            optionLimitField.appendChild(optionLimitLabel);
            optionLimitField.appendChild(optionLimitInput);
            body.appendChild(optionLimitField);

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

            const prereqSection = document.createElement("div");
            prereqSection.className = "field";
            const prereqLabel = document.createElement("label");
            prereqLabel.textContent = "Prerequisites (optional)";
            const prereqHint = document.createElement("div");
            prereqHint.className = "field-help";
            prereqHint.textContent = "Use comma-separated IDs, expression syntax (&&, ||, !), or JSON (array/object).";
            const prereqInput = document.createElement("textarea");
            prereqInput.value = formatPrerequisiteValue(option.prerequisites);
            prereqInput.placeholder = "e.g. powerCore, focusTraining OR powerCore && !villainPath";
            let prereqParseError = null;
            const syncPrereqFromInput = () => {
                const parsed = parsePrerequisiteValue(prereqInput.value);
                prereqParseError = parsed.error;
                if (parsed.error) {
                    prereqInput.classList.add("field-error");
                } else {
                    prereqInput.classList.remove("field-error");
                    if (parsed.value == null) {
                        delete option.prerequisites;
                    } else {
                        option.prerequisites = parsed.value;
                    }
                }
                refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                schedulePreviewUpdate();
            };
            prereqInput.addEventListener("input", syncPrereqFromInput);
            prereqInput.addEventListener("blur", syncPrereqFromInput);
            prereqSection.appendChild(prereqLabel);
            prereqSection.appendChild(prereqHint);
            prereqSection.appendChild(prereqInput);
            body.appendChild(prereqSection);

            const conflictSection = document.createElement("div");
            conflictSection.className = "field";
            const conflictLabel = document.createElement("label");
            conflictLabel.textContent = "Incompatible with options";
            const conflictHint = document.createElement("div");
            conflictHint.className = "field-help";
            conflictHint.textContent = "If any selected option appears here, this option becomes unavailable (and vice versa).";
            const conflictContainer = document.createElement("div");
            const updateConflicts = (next) => {
                if (next.length) {
                    option.conflictsWith = next;
                } else {
                    delete option.conflictsWith;
                }
                mountIdListEditor(conflictContainer, {
                    ids: option.conflictsWith || [],
                    excludeIds: [option.id || ""],
                    emptyText: "No incompatible options set.",
                    onChange: updateConflicts
                });
                refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                schedulePreviewUpdate();
            };
            mountIdListEditor(conflictContainer, {
                ids: option.conflictsWith || [],
                excludeIds: [option.id || ""],
                emptyText: "No incompatible options set.",
                onChange: updateConflicts
            });
            conflictSection.appendChild(conflictLabel);
            conflictSection.appendChild(conflictHint);
            conflictSection.appendChild(conflictContainer);
            body.appendChild(conflictSection);

            const discountSection = document.createElement("div");
            discountSection.className = "field";
            const discountLabel = document.createElement("label");
            discountLabel.textContent = "Conditional discounts";
            const discountHint = document.createElement("div");
            discountHint.className = "field-help";
            discountHint.textContent = "Create rules that change this option's cost when required option IDs are selected.";
            const discountContainer = document.createElement("div");
            discountContainer.className = "list-stack";

            function renderDiscountRulesEditor() {
                discountContainer.innerHTML = "";
                const rules = Array.isArray(option.discounts) ? option.discounts : [];
                if (!rules.length) {
                    const empty = document.createElement("div");
                    empty.className = "empty-state";
                    empty.textContent = "No conditional discount rules yet.";
                    discountContainer.appendChild(empty);
                }

                rules.forEach((rule, ruleIndex) => {
                    const ruleCard = document.createElement("div");
                    ruleCard.className = "discount-rule-card";

                    const header = document.createElement("div");
                    header.className = "discount-rule-header";
                    const title = document.createElement("strong");
                    title.textContent = `Rule ${ruleIndex + 1}`;
                    const removeBtn = document.createElement("button");
                    removeBtn.type = "button";
                    removeBtn.className = "button-icon danger";
                    removeBtn.textContent = "✕";
                    removeBtn.title = "Delete rule";
                    removeBtn.addEventListener("click", () => {
                        rules.splice(ruleIndex, 1);
                        if (rules.length) {
                            option.discounts = rules;
                        } else {
                            delete option.discounts;
                        }
                        renderDiscountRulesEditor();
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });
                    header.appendChild(title);
                    header.appendChild(removeBtn);
                    ruleCard.appendChild(header);

                    const modeRow = document.createElement("div");
                    modeRow.className = "field-inline field-inline-three";
                    const modeLabel = document.createElement("label");
                    modeLabel.textContent = "Trigger mode";
                    const modeInput = document.createElement("select");
                    const modeAll = document.createElement("option");
                    modeAll.value = "all";
                    modeAll.textContent = "Require all listed IDs";
                    const modeAny = document.createElement("option");
                    modeAny.value = "any";
                    modeAny.textContent = "Require at least N IDs";
                    modeInput.appendChild(modeAll);
                    modeInput.appendChild(modeAny);

                    const isAnyMode = Array.isArray(rule.idsAny) && rule.idsAny.length > 0;
                    modeInput.value = isAnyMode ? "any" : "all";

                    const minLabel = document.createElement("label");
                    minLabel.textContent = "Min selected";
                    const minInput = document.createElement("input");
                    minInput.type = "number";
                    minInput.min = "1";
                    minInput.value = Number.isFinite(rule.minSelected) && rule.minSelected > 0 ? String(rule.minSelected) : "1";
                    minInput.disabled = modeInput.value !== "any";

                    modeInput.addEventListener("change", () => {
                        const triggerIds = normalizeIdList(modeInput.value === "any"
                            ? rule.idsAny
                            : (Array.isArray(rule.ids) ? rule.ids : (rule.id ? [rule.id] : [])));
                        if (modeInput.value === "any") {
                            rule.idsAny = triggerIds;
                            rule.minSelected = Math.max(1, Number(rule.minSelected) || 1);
                            delete rule.ids;
                            delete rule.id;
                        } else {
                            rule.ids = triggerIds;
                            delete rule.idsAny;
                            delete rule.minSelected;
                            delete rule.id;
                        }
                        minInput.disabled = modeInput.value !== "any";
                        renderDiscountRulesEditor();
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });

                    minInput.addEventListener("input", () => {
                        const parsed = Math.max(1, Number(minInput.value) || 1);
                        rule.minSelected = parsed;
                        minInput.value = String(parsed);
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });

                    modeRow.appendChild(modeLabel);
                    modeRow.appendChild(modeInput);
                    modeRow.appendChild(minLabel);
                    modeRow.appendChild(minInput);
                    ruleCard.appendChild(modeRow);

                    const idsField = document.createElement("div");
                    idsField.className = "field";
                    const idsLabel = document.createElement("label");
                    idsLabel.textContent = "Trigger option IDs";
                    const idsContainer = document.createElement("div");
                    const setTriggerIds = (nextIds) => {
                        if (modeInput.value === "any") {
                            rule.idsAny = nextIds;
                            rule.minSelected = Math.max(1, Number(rule.minSelected) || 1);
                            delete rule.ids;
                            delete rule.id;
                        } else {
                            rule.ids = nextIds;
                            delete rule.idsAny;
                            delete rule.minSelected;
                            delete rule.id;
                        }
                        mountIdListEditor(idsContainer, {
                            ids: modeInput.value === "any" ? rule.idsAny : rule.ids,
                            emptyText: "No trigger IDs added yet.",
                            onChange: setTriggerIds
                        });
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    };
                    mountIdListEditor(idsContainer, {
                        ids: modeInput.value === "any" ? rule.idsAny : rule.ids,
                        emptyText: "No trigger IDs added yet.",
                        onChange: setTriggerIds
                    });
                    idsField.appendChild(idsLabel);
                    idsField.appendChild(idsContainer);
                    ruleCard.appendChild(idsField);

                    const ruleCostField = document.createElement("div");
                    ruleCostField.className = "field";
                    const ruleCostLabel = document.createElement("label");
                    ruleCostLabel.textContent = "Discounted cost when triggered";
                    const ruleCostContainer = document.createElement("div");
                    ruleCostContainer.className = "cost-list";
                    renderPointMapEditor(ruleCostContainer, rule.cost || {}, (nextCost) => {
                        if (nextCost) {
                            rule.cost = nextCost;
                        } else {
                            delete rule.cost;
                        }
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });
                    ruleCostField.appendChild(ruleCostLabel);
                    ruleCostField.appendChild(ruleCostContainer);
                    ruleCard.appendChild(ruleCostField);

                    discountContainer.appendChild(ruleCard);
                });

                const addRuleBtn = document.createElement("button");
                addRuleBtn.type = "button";
                addRuleBtn.className = "button-subtle";
                addRuleBtn.textContent = "Add discount rule";
                addRuleBtn.addEventListener("click", () => {
                    const nextRule = {
                        ids: [],
                        cost: {}
                    };
                    if (!Array.isArray(option.discounts)) {
                        option.discounts = [];
                    }
                    option.discounts.push(nextRule);
                    renderDiscountRulesEditor();
                    refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                    schedulePreviewUpdate();
                });
                discountContainer.appendChild(addRuleBtn);
            }

            renderDiscountRulesEditor();
            discountSection.appendChild(discountLabel);
            discountSection.appendChild(discountHint);
            discountSection.appendChild(discountContainer);
            body.appendChild(discountSection);

            const grantsSection = document.createElement("div");
            grantsSection.className = "field";
            const grantsLabel = document.createElement("label");
            grantsLabel.textContent = "Grants discounts (x of y)";
            const grantsHint = document.createElement("div");
            grantsHint.className = "field-help";
            grantsHint.textContent = "When this option is selected, grant discount slots that can be assigned across target options.";
            const grantsContainer = document.createElement("div");
            grantsContainer.className = "list-stack";

            function renderGrantRulesEditor() {
                grantsContainer.innerHTML = "";
                const grantRules = Array.isArray(option.discountGrants) ? option.discountGrants : [];
                if (!grantRules.length) {
                    const empty = document.createElement("div");
                    empty.className = "empty-state";
                    empty.textContent = "No grant rules yet.";
                    grantsContainer.appendChild(empty);
                }

                grantRules.forEach((rule, ruleIndex) => {
                    const card = document.createElement("div");
                    card.className = "discount-rule-card";

                    const header = document.createElement("div");
                    header.className = "discount-rule-header";
                    const title = document.createElement("strong");
                    title.textContent = `Grant Rule ${ruleIndex + 1}`;
                    const removeBtn = document.createElement("button");
                    removeBtn.type = "button";
                    removeBtn.className = "button-icon danger";
                    removeBtn.textContent = "✕";
                    removeBtn.title = "Delete grant rule";
                    removeBtn.addEventListener("click", () => {
                        grantRules.splice(ruleIndex, 1);
                        if (grantRules.length) {
                            option.discountGrants = grantRules;
                        } else {
                            delete option.discountGrants;
                        }
                        renderGrantRulesEditor();
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });
                    header.appendChild(title);
                    header.appendChild(removeBtn);
                    card.appendChild(header);

                    const settingsRow = document.createElement("div");
                    settingsRow.className = "field-inline field-inline-three";
                    const slotsLabel = document.createElement("label");
                    slotsLabel.textContent = "Slots (x)";
                    const slotsInput = document.createElement("input");
                    slotsInput.type = "number";
                    slotsInput.min = "1";
                    slotsInput.value = String(Math.max(1, Number(rule.slots) || 1));
                    const modeLabel = document.createElement("label");
                    modeLabel.textContent = "Discount mode";
                    const modeInput = document.createElement("select");
                    const halfMode = document.createElement("option");
                    halfMode.value = "half";
                    halfMode.textContent = "Half cost";
                    const freeMode = document.createElement("option");
                    freeMode.value = "free";
                    freeMode.textContent = "Free";
                    modeInput.appendChild(halfMode);
                    modeInput.appendChild(freeMode);
                    modeInput.value = rule.mode === "free" ? "free" : "half";

                    slotsInput.addEventListener("input", () => {
                        const parsed = Math.max(1, Number(slotsInput.value) || 1);
                        rule.slots = parsed;
                        slotsInput.value = String(parsed);
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });
                    modeInput.addEventListener("change", () => {
                        rule.mode = modeInput.value === "free" ? "free" : "half";
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    });

                    settingsRow.appendChild(slotsLabel);
                    settingsRow.appendChild(slotsInput);
                    settingsRow.appendChild(modeLabel);
                    settingsRow.appendChild(modeInput);
                    card.appendChild(settingsRow);

                    const targetsField = document.createElement("div");
                    targetsField.className = "field";
                    const targetsLabel = document.createElement("label");
                    targetsLabel.textContent = "Target option IDs (y)";
                    const targetsContainer = document.createElement("div");
                    const setTargets = (nextIds) => {
                        rule.targetIds = nextIds;
                        delete rule.targets;
                        delete rule.targetId;
                        mountIdListEditor(targetsContainer, {
                            ids: rule.targetIds,
                            excludeIds: [option.id || ""],
                            emptyText: "No target IDs set.",
                            onChange: setTargets
                        });
                        refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                        schedulePreviewUpdate();
                    };
                    const initialTargets = normalizeIdList(rule.targetIds || rule.targets || (rule.targetId ? [rule.targetId] : []));
                    rule.targetIds = initialTargets;
                    delete rule.targets;
                    delete rule.targetId;
                    mountIdListEditor(targetsContainer, {
                        ids: rule.targetIds,
                        excludeIds: [option.id || ""],
                        emptyText: "No target IDs set.",
                        onChange: setTargets
                    });
                    targetsField.appendChild(targetsLabel);
                    targetsField.appendChild(targetsContainer);
                    card.appendChild(targetsField);

                    grantsContainer.appendChild(card);
                });

                const addGrantBtn = document.createElement("button");
                addGrantBtn.type = "button";
                addGrantBtn.className = "button-subtle";
                addGrantBtn.textContent = "Add grant rule";
                addGrantBtn.addEventListener("click", () => {
                    const nextRule = {
                        slots: 1,
                        mode: "half",
                        targetIds: []
                    };
                    if (!Array.isArray(option.discountGrants)) {
                        option.discountGrants = [];
                    }
                    option.discountGrants.push(nextRule);
                    renderGrantRulesEditor();
                    refreshOptionWarnings(prereqParseError ? [prereqParseError] : []);
                    schedulePreviewUpdate();
                });
                grantsContainer.appendChild(addGrantBtn);
            }

            renderGrantRulesEditor();
            grantsSection.appendChild(grantsLabel);
            grantsSection.appendChild(grantsHint);
            grantsSection.appendChild(grantsContainer);
            body.appendChild(grantsSection);
            refreshOptionWarnings();

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

    function renderPointMapEditor(container, map, onChange) {
        container.innerHTML = "";
        const valueMap = map && typeof map === "object" ? { ...map } : {};

        Object.entries(valueMap).forEach(([pointType, amount]) => {
            const row = document.createElement("div");
            row.className = "cost-row";

            const nameInput = document.createElement("input");
            nameInput.type = "text";
            nameInput.value = pointType;
            nameInput.placeholder = "Point type";

            const valueInput = document.createElement("input");
            valueInput.type = "number";
            valueInput.value = typeof amount === "number" ? amount : Number(amount) || 0;

            const removeBtn = document.createElement("button");
            removeBtn.type = "button";
            removeBtn.className = "button-icon danger";
            removeBtn.textContent = "✕";
            removeBtn.title = "Remove entry";

            valueInput.addEventListener("input", () => {
                valueMap[pointType] = Number(valueInput.value) || 0;
                onChange(Object.keys(valueMap).length ? { ...valueMap } : null);
            });

            nameInput.addEventListener("blur", () => {
                const newName = nameInput.value.trim();
                if (!newName || newName === pointType) {
                    nameInput.value = pointType;
                    return;
                }
                if (Object.prototype.hasOwnProperty.call(valueMap, newName)) {
                    showEditorMessage(`Duplicate key "${newName}"`, "warning", 4000);
                    nameInput.value = pointType;
                    return;
                }
                const existingValue = valueMap[pointType];
                delete valueMap[pointType];
                valueMap[newName] = existingValue;
                onChange(Object.keys(valueMap).length ? { ...valueMap } : null);
                renderPointMapEditor(container, valueMap, onChange);
            });

            removeBtn.addEventListener("click", () => {
                delete valueMap[pointType];
                onChange(Object.keys(valueMap).length ? { ...valueMap } : null);
                renderPointMapEditor(container, valueMap, onChange);
            });

            row.appendChild(nameInput);
            row.appendChild(valueInput);
            row.appendChild(removeBtn);
            container.appendChild(row);
        });

        const addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "button-subtle";
        addBtn.textContent = "Add point type";
        addBtn.addEventListener("click", () => {
            let candidate = "Point";
            let suffix = 1;
            while (Object.prototype.hasOwnProperty.call(valueMap, candidate)) {
                suffix += 1;
                candidate = `Point ${suffix}`;
            }
            valueMap[candidate] = 0;
            onChange({ ...valueMap });
            renderPointMapEditor(container, valueMap, onChange);
        });
        container.appendChild(addBtn);
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
