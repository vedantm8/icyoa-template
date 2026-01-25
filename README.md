# ICYOA Template

An open-source **Interactive Choose Your Own Adventure (ICYOA)** template. Build, visualize, and share interactive stories entirely in your browser.

---

## Quick Start

1. **Install Node.js:** Download it from [nodejs.org](https://nodejs.org/) if you don't have it.
2. **Download & Run:**
   ```bash
   node server.js
   ```
3. **Explore:**
   - **Main App:** [http://localhost:3000](http://localhost:3000) (What your players see)
   - **Visual Editor:** [http://localhost:3000/editor.html](http://localhost:3000/editor.html) (Where you build)

---

## How to Create Your Own CYOA

Follow these simple steps to go from a template to your own unique adventure.

### 1. Set Up Your Project
* **Fork this repo:** Click the **Fork** button at the top right of this page to save a copy to your own GitHub account.
* **Clone it:** Download your fork to your computer.
* **Open in VS Code:** (Or your favorite code editor).

### 2. Use the Visual Editor (Easiest Way)
The Visual Editor lets you build and manage your CYOAs without touching code.

1. Run `node server.js` in your terminal.
2. Open **[localhost:3000/editor.html](http://localhost:3000/editor.html)**.
3. **Manage your projects:**
   - Click **Select CYOA** to switch between different adventures.
   - **Create New:** Enter a title and click "Create New" to start a fresh adventure.
   - **Delete:** Click the trash icon next to a CYOA to move it to the trash (found in `CYOAs/.trash/`).
4. **Build your world:**
   - Add **Categories** (like "Background", "Powers", or "Equipment").
   - Add **Options** inside categories. Give them names, descriptions, and costs.
   - Set **Starting Points** (e.g., "100 Gold").
5. The file will automatically be saved to the `CYOAs` directory. You may modify or delete it directly if you prefer.

### 3. Logic & Requirements
Want one choice to depend on another?
* **Prerequisites:** In the editor, you can set an "ID" for an option (e.g., `super_strength`). Another option can then require `super_strength` to be selected.
* **Conflicts:** Stop players from picking two incompatible things (e.g., `Fire_Magic` and `Ice_Magic`).

### 4. Publish Your Creation
Sharing your CYOA is free and easy with GitHub Pages:

1. **Commit & Push:** Save your changes (`git commit -am "My CYOA"`) and push them to GitHub (`git push`).
2. **Update Manifest:** Run `node generate-manifest.js` to refresh the list of available adventures. This ensures your new CYOA is correctly indexed and visible on the live site.
3. **Enable Pages:**
   - Go to your repo settings on GitHub.
   - Click **Pages** in the left sidebar.
   - Under "Build and deployment", select the **main** branch and click **Save**.
4. **Done!** Your site will be live at `https://your-username.github.io/your-repo-name/`.

---

## Project Structure

For those curious about how it works under the hood:

```text
icyoa-template/
├── CYOAs/               # All CYOA configuration files (.json)
├── index.html           # The main player interface
├── editor.html          # The visual creator tool
├── input.json           # Your CYOA's "brain" (where data lives)
├── script.js            # Logic for the player interface
├── editor.js            # Logic for the visual tool
├── style.css            # Look and feel for the player interface
└── server.js            # Simple server to help you edit locally
```

---

## Advanced Customization

* **Colors & Fonts:** Open `style.css` to change the appearance of your CYOA.
* **Point Systems:** You can have multiple types of points (e.g., Health, Mana, Gold) by editing the `points` section in the editor.

---

## License

This project is open-source and available under the MIT License. Feel free to use, modify, and share!
