# ChatGPT Branch Tree

A browser extension that visualizes ChatGPT conversation branches as an interactive tree.

## Features

- **Visual Tree View**: See your conversation structure as a clean, navigable tree
- **Branch Tracking**: Automatically tracks when you create branches using "Branch in new chat"
- **Quick Navigation**: Click any node to scroll to that message or open branched conversations
- **Hover Details**: Hover over any node to see the full message content
- **Auto-refresh**: Tree updates automatically as you chat

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open your browser's extension page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Brave: `brave://extensions`
3. Enable "Developer mode"
4. Click "Load unpacked" and select the extension folder

## Usage

1. Navigate to [ChatGPT](https://chatgpt.com) or [chat.openai.com](https://chat.openai.com)
2. Click the floating toggle button (bottom-right) to open the tree panel
3. Your conversation tree will load automatically
4. Click on any message to scroll to it
5. When you use "Branch in new chat", the extension tracks the relationship

## Permissions

- `tabs`: query the active ChatGPT tab and open/focus conversations
- `storage`: save branch metadata and settings locally
- `scripting`: inject the content script when the action button is clicked
- Host access to `https://chatgpt.com/*` and `https://chat.openai.com/*`

## How It Works

The extension:
1. Fetches conversation data from ChatGPT's API
2. Builds a tree structure showing user messages and branch points
3. Stores branch relationships locally to track conversation history
4. Displays everything in a clean, dark-themed panel

## Development

1. Install dependencies: `npm install`
2. Lint JavaScript: `npm run lint`
3. Format Markdown/HTML/JSON: `npm run prettier`
4. Load the folder in `chrome://extensions` (Developer Mode → Load unpacked) to
   test in your browser

## Manual QA Checklist

- Toggle the panel on a ChatGPT conversation; tree appears and stays in sync
- Click nodes to scroll to messages; branches open the correct conversations
- Use “Branch in new chat”; the new chat appears as a child with the first user
  message as its preview
- Hover nodes to see the full message content in the tooltip
- Clearing data resets the tree, pending branch cache, and local titles

## Files

- `manifest.json` - Extension configuration
- `content.js` - Injected into ChatGPT pages, handles data and DOM interaction
- `panel.html` - Panel UI markup and styles
- `panel.js` - Panel rendering logic
- `background.js` - Service worker for cross-tab communication

## Browser Compatibility

Works with all Chromium-based browsers:
- Google Chrome
- Microsoft Edge
- Brave
- Opera
- Vivaldi

## Privacy

- All data is stored locally in your browser
- No external servers or tracking
- Only communicates with ChatGPT's own API

## License

MIT
