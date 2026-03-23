# Xray — DOM Inspector Extension

Xray is a Chrome extension that lets you inspect any element on a page instantly. Click any element to see its DOM properties, computed styles, layout, box model, and more — right inside an in-page sidebar.

![Xray](icons/icon128.png)

---

## Features

- **Element inspection** — click any element to capture its identity, classes, ID, and selector
- **Computed styles** — color, background, font, opacity, border radius, and box shadow
- **Layout details** — display, position, size, z-index, overflow, flex and grid alignment
- **Parent layout** — see how the parent flex or grid container affects the element
- **Box model diagram** — visual margin, border, padding, and content breakdown
- **State detection** — disabled, required, readonly, checked, hidden, pointer-events
- **Useful attributes** — ARIA roles, labels, and data attributes
- **CSS snippet** — copy ready-to-use CSS for the inspected element
- **Image download** — download any inspected image with one click
- **DevTools panel** — continue inspection inside Chrome DevTools
- **Sidebar resize & position** — drag to resize, dock left or right
- **Persistent preferences** — sidebar width, position, and DevTools state are remembered

---

## Installation

> Xray is not yet on the Chrome Web Store. Install it manually in a few steps.

1. **Download** this repo — click **Code → Download ZIP** and unzip it
2. Open Chrome and go to `chrome://extensions`
3. Enable **Developer Mode** using the toggle in the top right
4. Click **Load unpacked**
5. Select the `xray/` folder
6. Xray appears in your Chrome toolbar — pin it for easy access

---

## How to Use

1. Navigate to any webpage
2. Click the **Xray icon** in the toolbar to open the sidebar
3. Click any element on the page to inspect it
4. Use the **Home** tab to view inspection results
5. Use the **Settings** tab to toggle capture, DevTools integration, sidebar width, and position
6. Press **ESC** or close the sidebar to turn Xray off

### DevTools Integration

1. Turn on **DevTools** from the Xray Settings tab
2. Open Chrome DevTools (`F12`)
3. Go to the **Xray** tab inside DevTools
4. Select any element in the Elements panel — Xray updates automatically
5. Or use **Use Last Overlay Capture** to bring in what you inspected from the page

---

## Permissions

| Permission | Why it's needed |
|---|---|
| `activeTab` | Activate Xray on the tab you click |
| `scripting` | Inject the inspector into the active tab |
| `storage` | Save your preferences and inspection state locally |
| `downloads` | Download inspected images when you request it |

Xray does not send any data to external servers.

---

## Privacy

See [PRIVACY_POLICY.md](PRIVACY_POLICY.md) for full details.

---

## Contributing

Issues and pull requests are welcome. If you find a bug or have a feature idea, open an issue.

---

## License

MIT
