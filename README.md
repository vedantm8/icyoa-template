# ICYOA Template

An open-source **Interactive Choose Your Own Adventure (ICYOA)** template designed to let creators build, visualize, and share fully interactive CYOA experiences. The system runs entirely in the browser using HTML, CSS, and JavaScript, loading all configuration data from a single `input.json` file.

## Disclaimer

This project was created to explore how dynamic logic handles discount functionality within a Choose Your Own Adventure (CYOA) builder system. The implementation is experimental and intended for educational and demonstration purposes. Functionality, code structure, and features may change.

## Project Structure

```text
icyoa-template/
├── index.html       # Main UI template
├── editor.html      # Visual editor entry point
├── style.css        # Visual styling and layout
├── editor.css       # Editor page styling
├── script.js        # Core logic
├── editor.js        # Visual editor logic
├── logicExpr.js     # Logical expression parsing
├── input.json       # Configuration
├── LICENSE          # Open-source license
└── README.md        # Documentation
```

## Getting Started

### Prerequisites

*   Node.js (for the local development server)

### 1. Run the Template

Start the bundled development server to serve the site and enable the editor's live features:

```bash
node server.js
```

Open the links printed in the terminal:
*   `http://localhost:3000/` – Character Builder (`index.html`)
*   `http://localhost:3000/editor.html` – Visual Editor with live preview

The application features:
*   Title and description loaded from `input.json`
*   Collapsible list of categories and subcategories
*   Selectable options with descriptions, costs, and prerequisites
*   Live points tracker
*   Import/Export/Reset functionality

### 2. Visual Editor Workflow

The visual editor (`editor.html`) allows you to modify the configuration in a GUI while seeing live updates.

*   **Setup**: Run `node server.js` to enable saving to `temp-input.json`.
*   **Workflow**:
    *   Open `editor.html` alongside `index.html`.
    *   Use the editor panel to add categories, change point formulas, or edit options.
    *   Changes are saved to `temp-input.json`. The main implementation reads `input.json`, keeping your live environment stable until you are ready to publish.
    *   **Export**: When satisfied, export the JSON and overwrite your main `input.json`.

## Tutorial: How to Build Your Own CYOA

This guide walks you through creating a unique CYOA from this template.

### Step 1: Setup
1.  **Fork** this repository on GitHub to your own account.
2.  **Clone** your forked repository to your local machine.
3.  Open the folder in your code editor (e.g., VS Code).

### Step 2: Clean Slate
Open `input.json`. This file contains the "Naruto Jumpchain" example.
Delete everything inside the array to start fresh, or keep the structure as a reference. Use this minimal starter template:

```json
[
  { "type": "title", "text": "My New CYOA" },
  { "type": "description", "text": "A brief introduction." },
  {
    "type": "points",
    "values": { "Points": 100 },
    "allowNegative": []
  },
  {
    "name": "First Category",
    "subcategories": []
  }
]
```

### Step 3: Define Your Points
In the `points` block (see above), define the currencies for your game.
*   **values**: The starting amount for each currency.
*   **allowNegative**: List point types that can go below zero (useful for "Drawbacks" that give you points).

### Step 4: Add Content
Add objects to the `subcategories` array. A "Row" of options is a subcategory.

```json
{
  "name": "General Perks",
  "options": [
    {
      "id": "perkStrong",
      "label": "Super Strength",
      "description": "You are very strong.",
      "cost": { "Points": 10 },
      "image": "https://example.com/strength.jpg" // Optional
    }
  ]
}
```

### Step 5: Advanced Logic (Optional)
*   **Prerequisites**: Add `"prerequisites": "perkStrong"` to an option so it can only be selected if "Super Strength" is already active.
*   **Conflicts**: Add `"conflictsWith": ["perkWeak"]` to prevent incompatible choices.
*   **Formulas**: Use the `formulas` block (see Configuration below) to create derived stats.

### Step 6: Publish
1.  Commit your changes: `git commit -am "My first CYOA"`
2.  Push to GitHub: `git push`
3.  Go to your GitHub repo settings -> **Pages** -> Deploy from `main` branch.
4.  Your CYOA is now live!

### 3. Configuration (input.json)

The `input.json` file is the core of the application. It defines the entire structure of the CYOA.
**Important**: The file must contain a **JSON Array** of objects, not a single object.

#### Top-Level Structure
The array contains configuration blocks (identified by `type`) and category blocks (identified by `name`).

```json
[
  {
    "type": "title",
    "text": "My Adventure"
  },
  {
    "type": "description",
    "text": "Description of the adventure."
  },
  {
    "type": "headerImage",
    "url": "https://example.com/banner.jpg"
  },
  {
    "type": "points",
    "values": { "CP": 1000, "SP": 0 },
    "allowNegative": ["SP"]
  },
  {
    "name": "Perks",
    "subcategories": []
  }
]
```

#### Formulas
You can define derived point values calculated from other points using JavaScript expressions.

```json
{
  "type": "formulas",
  "values": {
    "TotalScore": { "formula": "points.CP + points.Bonus" },
    "DangerLevel": { "formula": "points.Drawbacks * 1.5" }
  }
}
```

*   `values`: An object where keys are the new point names.
*   `formula`: A string containing a JavaScript expression. The variable `points` is available to access current totals (e.g., `points.CP`).

#### Categories and Subcategories
Any object in the main array that has a `name` property (and no special `type`) is treated as a Category.

```json
{
  "name": "Perks",
  "subcategories": [
    {
      "name": "General Perks",
      "options": []
    },
    {
      "type": "storyBlock",
      "name": "Prologue",
      "text": "Narrative text here..."
    }
  ]
}
```

#### Options
Each option represents a user choice within a subcategory.

```json
{
  "id": "uniqueId",
  "label": "Option Name",
  "description": "Description text.",
  "cost": { "CP": 100 },
  "maxSelections": 1,
  "prerequisites": "anotherId",
  "conflictsWith": ["conflictingId"],
  "discounts": []
}
```

| Field | Description |
|---|---|
| `id` | Unique internal identifier used for logic. |
| `label` | Display name. |
| `description` | Text displayed to the user. |
| `cost` | Points deducted (or added if negative). |
| `maxSelections` | Maximum number of times the option can be selected. |
| `prerequisites` | Logical expression required to unlock the option. |
| `conflictsWith` | Array of IDs that are mutually exclusive with this option. |
| `discounts` | Array of discount objects conditioning other options. |

### Logic System

The system (`logicExpr.js`) supports boolean logic for prerequisites.

*   `&&` (AND): `idA && idB`
*   `||` (OR): `idA || idB`
*   `!` (NOT): `!idA`
*   grouping: `(idA || idB) && !idC`

### Customization

*   **Styling**: Modify `style.css` to change the visual theme (colors, fonts, layout).

## Deployment

The project is a static site and can be hosted on any static file server (GitHub Pages, Netlify, etc.).

1.  Upload the `icyoa-template` directory.
2.  Ensure `index.html` is the entry point.
3.  Access the URL.

## License

This project is licensed under the terms specified in the included `LICENSE` file.
