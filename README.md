# ❄️ ICYOA Template

An open-source **Interactive Choose Your Own Adventure (ICYOA)** template designed to let creators build, visualize, and share fully interactive CYOA experiences.  
The system runs entirely in the browser using **HTML**, **CSS**, and **JavaScript**, loading all configuration data from a single `input.json` file.

## Disclaimer

This project was created as a test to explore how OpenAI Codex / ChatGPT handles dynamic logic and discount functionality within a Choose Your Own Adventure (CYOA) builder system. The implementation is experimental and intended for educational and demonstration purposes only. Functionality, code structure, and features may change as part of ongoing testing.

---

## 📂 Project Structure

```
icyoa-template/
├── index.html       # Main UI template
├── style.css        # Visual styling and layout
├── script.js        # Core logic
├── logicExpr.js     # Logical expression parsing
├── input.json       # Configuration
├── LICENSE          # Open-source license
└── README.md        # Documentation
```

---

## 🚀 Getting Started

### 1. Run the Template

You need to use a local server to run the template (opening `index.html` directly may not work due to browser security restrictions).

If you have [live-server](https://www.npmjs.com/package/live-server) installed, run:

```sh
live-server --no-browser
```

Then open the provided local URL (usually `http://127.0.0.1:8080/`) in your browser.

You’ll see:
- The **title and description** from `input.json`
- A collapsible list of **categories and subcategories**
- Selectable **options** with descriptions, costs, and prerequisites
- A live **points tracker** fixed to the bottom of the screen
- **Import/Export/Reset** buttons to manage your choices

---

### 2. Edit `input.json`

This file defines all game logic and content. It controls:
- Starting points  
- Categories and subcategories  
- Option details, descriptions, costs, prerequisites, conflicts, and discounts  
- Story blocks or narrative text  

Example:

```json
{
  "name": "Naruto - Jumpchain",
  "description": "Choose your abilities, perks, and drawbacks for your journey.",
  "points": { "CP": 1000 },
  "categories": [
    {
      "name": "Perks",
      "subcategories": [
        {
          "name": "General Perks",
          "options": [
            {
              "id": "chakraControl",
              "label": "Chakra Control",
              "description": "Gain perfect mastery over your chakra.",
              "cost": { "CP": 200 },
              "maxSelections": 1
            }
          ]
        }
      ]
    }
  ]
}
```

---

## 🧠 Core Concepts

### ⚙️ Categories and Subcategories
Each category groups related options (e.g., *Perks*, *Drawbacks*).  
Subcategories allow further organization (e.g., *Elemental Perks*, *Bloodline Perks*).

### 💰 Points System
- Defined in the `points` object.
- Supports multiple point types (`CP`, `JP`, `IP`, etc.).
- The points tracker updates in real time as users make selections.

### 🧩 Options
Each option is an interactive choice with logic-driven behavior:

| Field | Description |
|--------|-------------|
| `id` | Unique internal name |
| `label` | Display name |
| `description` | What it does |
| `cost` | Point deduction or refund |
| `maxSelections` | Limits how many times it can be picked |
| `prerequisites` | IDs required before unlocking |
| `conflictsWith` | IDs that cannot coexist |
| `discounts` | Apply reduced cost based on other selections |

### 🪄 Discounts
You can grant cost reductions or free options when certain conditions are met.

```json
"discounts": [
  {
    "id": "backgroundMedic",
    "cost": { "CP": 200 }
  }
]
```

If multiple discounts overlap, the **strongest discount** applies automatically.

---

## 🧮 Logical Expressions

The `logicExpr.js` file enables complex prerequisite or conflict logic using simple boolean syntax:
- `A && B` – requires both A and B
- `A || B` – requires A or B
- `!A` – requires that A is *not* selected

This lets you write flexible conditions in `input.json` such as:

```json
"prerequisites": "bloodlineUchiha && (perkSharingan || perkMangekyo)"
```

---

## 🖥 Interface Features

- ✅ **Collapsible categories** with dynamic rendering  
- 💾 **Import/Export system** using JSON strings  
- 🔁 **Reset all selections** to start over  
- 📉 **Dynamic point tracking** for each point type  
- 🧾 **Modal system** for import/export  

---

## 🎨 Styling

All visual design is handled through `style.css`.  
You can freely modify colors, spacing, or typography without breaking the logic system.

Key UI components:
- `.accordion` for collapsible sections  
- `.option-wrapper` for each CYOA choice  
- `.points-tracker` fixed at the bottom for live updates  
- `.story-block` for long narrative text or flavor content  

---

## 🧰 Developer Notes

- `script.js` serves as the **rendering and interaction engine**.  
- `logicExpr.js` parses conditional expressions and handles dependency logic.  
- `input.json` is meant to be edited by CYOA creators; it can define everything without touching JavaScript.  
- All dependencies are local — no external servers or frameworks required.

---

## 📦 Exporting and Hosting

You can host your CYOA anywhere that supports static files, such as:
- [GitHub Pages](https://pages.github.com)
- [Neocities](https://neocities.org)
- [Netlify](https://www.netlify.com)

To publish:
1. Upload the entire `icyoa-template` folder.
2. Ensure `index.html` is in the root directory.
3. Access it directly through your hosting service URL.

---

## 📜 License

This project is licensed under the terms specified in the included `LICENSE` file.

---

## 🧊 Summary

| File | Purpose |
|------|----------|
| `index.html` | The main user interface |
| `style.css` | Controls layout and appearance |
| `script.js` | Handles rendering, points, logic, and validation |
| `logicExpr.js` | Adds support for logical expressions in prerequisites |
| `input.json` | Defines all categories, subcategories, and options |
| `LICENSE` | Open-source license for reuse and modification |
| `README.md` | This guide |


---

## 🏗️ How to Create Your Own CYOA Using This Template

This template is designed so that **anyone can create a complete interactive CYOA** without writing any JavaScript.  
All you need to do is edit `input.json` and optionally change visuals in `style.css` and text in `index.html`.

Below is a complete step-by-step guide to building your own story, system, or RPG adventure using this framework.

---

### 🪞 Step 1: Duplicate the Template

1. Fork the `icyoa-template` folder.  
2. Rename it to your desired project name, e.g., `my-cyoa-project`.
3. Open the folder in your preferred text editor (VS Code, Sublime, etc.).

---

### 🧱 Step 2: Define CYOA Metadata

At the top of your `input.json`, define your story name, description, and starting points:

```json
{
  "name": "My Adventure",
  "description": "A tale of choices and consequences in a magical world.",
  "points": {
    "CP": 1000,
    "MP": 500
  },
  "categories": []
}
```

**Explanation:**
- `name`: Title of your adventure.
- `description`: Short description shown below the title.
- `points`: Define all currencies or point types (e.g., CP for Choice Points, MP for Mana Points).

---

### 🗂 Step 3: Add Categories

Each **category** is a major section of your adventure — for example, *Backgrounds*, *Perks*, *Items*, *Allies*, or *Drawbacks*.

```json
{
  "name": "Perks",
  "subcategories": []
}
```

---

### 🧩 Step 4: Create Subcategories

Subcategories help structure your CYOA into organized sections under each category.

Example:

```json
{
  "name": "Perks",
  "subcategories": [
    {
      "name": "Combat Perks",
      "options": []
    },
    {
      "name": "Support Perks",
      "options": []
    }
  ]
}
```

---

### 🪄 Step 5: Add Options

An option is a single choice the user can select. It may cost points, have conditions, or interact with other choices.

Example:

```json
{
  "id": "perkSuperStrength",
  "label": "Super Strength",
  "description": "You possess immense physical strength beyond human limits.",
  "cost": { "CP": 200 },
  "maxSelections": 1,
  "prerequisites": null,
  "conflictsWith": null
}
```

**Key Fields:**
| Field | Description |
|-------|--------------|
| `id` | Unique identifier (used for logic). |
| `label` | Display name in the UI. |
| `description` | Visible description or story text. |
| `cost` | Points required or refunded. |
| `maxSelections` | How many times this can be picked. |
| `prerequisites` | Other IDs required before unlocking. |
| `conflictsWith` | IDs that cannot coexist. |
| `discounts` | Optional price reductions if another option is selected. |

---

### ⚙️ Step 6: Add Logic (Prerequisites, Conflicts, Discounts)

This template supports conditional logic to make your choices interactive and meaningful.

#### Example 1: Prerequisite
```json
"prerequisites": "perkTraining && !drawbackLazy"
```

This means you must have `perkTraining` and not have `drawbackLazy` selected.

#### Example 2: Conflicts
```json
"conflictsWith": ["perkInvisibility", "perkInvincibility"]
```

#### Example 3: Discounts
```json
"discounts": [
  { "id": "perkMartialArts", "cost": { "CP": 100 } }
]
```

If you already have `perkMartialArts`, this option becomes cheaper.

---

### 🎨 Step 7: Customize Appearance

Edit `style.css` to adjust visual aspects like colors, fonts, or layout.  
For example, you can change the background color:

```css
body {
  background-color: #20232a;
  color: #ffffff;
}
```

You can also replace or add a **header image** in `index.html` by adding an `<img>` element inside:

```html
<div id="headerImageContainer" class="header-image-container">
  <img src="header.jpg" alt="Adventure Banner" />
</div>
```

---

### 💾 Step 8: Test Your CYOA

1. Open `index.html` in your browser.  
2. Verify that the CYOA title, points, and options render correctly.  
3. Check interactions — prerequisites, discounts, and conflicts should work automatically.  
4. Use the **Export** button to save your choices, then **Import** them later to reload your progress.

---

### 🌍 Step 9: Publish Your CYOA

Once satisfied with your setup, you can make your CYOA public.  
Host it as a static site on any of these platforms:

| Platform | Instructions |
|-----------|---------------|
| **GitHub Pages** | Push your project to a GitHub repo → Settings → Pages → Deploy from `/ (root)` |
| **Neocities** | Drag and drop your folder into the site dashboard |
| **Netlify / Vercel** | Connect your GitHub repo and deploy automatically |

After deployment, share your link! Others will be able to play your CYOA instantly.

---

### 🧠 Optional Enhancements

- Add **story-only sections** using `"type": "storyBlock"`.
- Introduce **attribute sliders or dynamic values** using extended JSON logic.
- Use **multiple point types** for layered systems (e.g., CP + JP).
- Experiment with **discount chains** and **advanced prerequisites** using `logicExpr.js` syntax.

---

### ✅ Summary of the Workflow

| Step | Action | File |
|------|--------|------|
| 1 | Copy template | — |
| 2 | Set name, description, and points | `input.json` |
| 3 | Add categories | `input.json` |
| 4 | Add subcategories | `input.json` |
| 5 | Add options | `input.json` |
| 6 | Configure logic | `input.json` |
| 7 | Customize visuals | `style.css`, `index.html` |
| 8 | Test locally | Open `index.html` |
| 9 | Publish online | GitHub Pages / Netlify / Neocities |

---

With these steps, you can go from a blank template to a fully functional, shareable, interactive CYOA experience