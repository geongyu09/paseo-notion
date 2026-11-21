Browse your Notion pages from the Explorer and read or edit them in a workspace tab, drawn with Paseo's own components and theme instead of an embedded web page. Its labels and messages follow the Paseo app language in English or Korean, and other app languages show English.

The Explorer panel lists every page and database shared with your Notion internal integration as a tree, with search by title. Selecting a page opens the Notion page tab in the center, which shows the page icon, title, database properties, and blocks such as headings, lists, to-dos, toggles, callouts, quotes, code, tables, columns, images, and links. Links to other Notion pages open inside the same tab with back navigation and breadcrumbs. The external link button opens the page in your browser.

Press the text of a paragraph, heading, list item, to-do, toggle, quote, callout, or code block to edit it in place. While editing, formatting shows as Markdown that you can change: `**bold**`, `*italic*`, `~~strike~~`, `` `code` ``, `[text](url)`, and `@[name]` for a mention. Code blocks edit as plain text, where Enter breaks the line. Leaving the text or pressing Escape saves it to Notion, Enter adds a block below, Backspace in an empty block deletes it, and Shift+Enter breaks the line. To-do checkboxes and the page title are editable too.

Notion's editor shortcuts work while a block is being edited:

| Keys | What happens |
| --- | --- |
| Ctrl+B, Cmd+I, Ctrl+E, Cmd+Shift+S, Ctrl+K | Bold, italic, inline code, strikethrough, and link around the selection (written as the Markdown markers) |
| `# ` to `#### `, `- `, `1. `, `[] `, `> `, `" `, ``` at the start | Turns the block into a heading, bullet, numbered item, to-do, toggle, quote, or code block |
| Cmd+Option+0 to 8 | Text, heading 1 to 3, to-do, bullet, numbered item, toggle, code |
| Tab, Shift+Tab | Indents under the block above, or back out (in a code block Tab types a tab) |
| Option+Shift+Up/Down, Ctrl+Shift+Up/Down | Moves the block |
| Cmd+D | Duplicates the block |
| Cmd+Enter | Checks or unchecks a to-do |
| Up at the start, Down at the end | Edits the block above or below |
| Enter in an empty list item | Ends the list with a text block |

Typing `/` opens a menu of block types, filtered by English or Korean block names (`/todo`, `/heading2`, `/제목2`); Up, Down, and Enter or a press choose one. In an empty block the choice changes that block, and after text it adds a block below.

Edits show on the page at once and reach Notion one after another in the background, so a burst of new lines takes a few seconds to arrive; reloading the page before then drops what has not been sent.

Paseo takes Cmd+B, Cmd+E, Cmd+K, and Cmd+Shift+Up/Down for its own commands before a plugin sees them, so those use Ctrl here. Notion's API cannot move a block or change its type, so both make a new block and delete the old one: comments on the block are lost, and a block that has child blocks stays as it is.

Setup: create an internal integration in Notion, share the pages you want with it, and save its token under Settings, Plugins, Notion. Editing needs the integration's update and insert content capabilities. Add one token per Notion workspace and switch between them above the tree. The daemon calls the Notion API with that token, keeps each workspace's page tree in `~/.cache/paseo-notion/`, and rebuilds it every ten minutes or when you press refresh. The first tree build can take tens of seconds for large workspaces.

Limits: edits are saved without conflict checks, so the last save wins, and other people's changes appear after a refresh. Blocks cannot be reordered or change type, underline and color cannot be added, and tables and database properties are read only. Databases show as one table with every property as a column and rows ordered by last edit, 50 at a time; Notion's saved views, filters, and board or calendar layouts are not available through the API version in use. Synced block copies, table of contents, and breadcrumb blocks are not drawn.
