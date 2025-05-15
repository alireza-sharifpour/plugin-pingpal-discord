# PingPal Discord-to-Telegram Monitor Plugin (`plugin-pingpal-discord`)

This ElizaOS plugin, `plugin-pingpal-discord`, monitors specified Discord servers for mentions of a designated target user. It analyzes the importance of these mentions using a Language Model (LLM) and delivers notifications for critical messages as private messages via a Telegram Bot.

This project is designed as a **standalone ElizaOS agent** dedicated to this monitoring task. It helps users manage notification overload from Discord by filtering unimportant mentions and ensuring timely awareness of critical messages on their preferred platform, Telegram.

## Key Features

- **Discord Mention Monitoring:** Listens to Discord channels (where the bot is a member) for mentions of a specific target Discord User ID.
- **LLM-Powered Importance Analysis:** Utilizes an LLM (via `runtime.useModel`) to analyze the content of the Discord message where the mention occurred to determine its importance.
- **Telegram Notifications:** Sends private Telegram messages for Discord mentions deemed important by the LLM.
- **Deduplication:** Prevents duplicate notifications for the exact same Discord message mention using ElizaOS memories.
- **Configurable:** Setup involves environment variables for API keys/tokens and character settings within your ElizaOS agent configuration.
- **Standalone Agent Focus:** Designed to run as a separate, dedicated ElizaOS agent.

## How It Works

1.  **Discord Connection:** The agent, using `@elizaos/plugin-discord`, connects to Discord with the provided bot token.
2.  **Message Reception:** The `plugin-pingpal-discord` listens for incoming messages from Discord channels the bot has access to.
3.  **Mention Detection:** It checks each message for a mention of the configured `targetDiscordUserId` (e.g., `<@123456789012345678>`).
4.  **Deduplication Check:** If a mention is detected, the plugin queries its internal memory (via `@elizaos/plugin-sql`, using a table like `pingpal_discord_processed`) to see if this specific Discord message (by its unique ID) has already been processed.
5.  **Importance Analysis (LLM Call):**
    - If it's a new, relevant mention, the plugin constructs a prompt with the Discord message text, sender, server, and channel information.
    - It calls an LLM (e.g., OpenAI, Anthropic) via `runtime.useModel` to assess if the message is important for the target user.
    - The LLM is expected to return a JSON object like `{"important": boolean, "reason": "string"}`.
6.  **Log Processed Mention:** The plugin logs the original Discord message ID and the analysis outcome to its memory to prevent future duplicate processing.
7.  **Telegram Notification:**
    - If the LLM analysis indicates `important: true`, the plugin formats a notification message.
    - This notification includes details like the original sender, Discord server/channel, the message text, the LLM's reason for importance, and a direct link to the Discord message.
    - It then uses the `@elizaos/plugin-telegram` service to send this notification as a private message to the configured `targetTelegramUserId`.

## Setup and Configuration

### Prerequisites

- Node.js (version specified in ElizaOS documentation, e.g., 23.3.0+) or Bun.
- ElizaOS CLI installed (`npm install -g @elizaos/cli` or `bun install -g @elizaos/cli`).
- Ensure you have installed the core ElizaOS plugins that this project depends on: `@elizaos/plugin-discord` and `@elizaos/plugin-telegram`. You can typically install them in your ElizaOS project using `bun install @elizaos/plugin-discord @elizaos/plugin-telegram`.
- An existing ElizaOS project or create a new one (`npx elizaos create`).

### 1. Environment Variables

Create or update a `.env` file in your ElizaOS project root:

```env
# Discord Bot (for listening to Discord servers)
DISCORD_BOT_TOKEN="your_discord_bot_token_here"
DISCORD_APPLICATION_ID="your_discord_application_id_here"
DISCORD_API_TOKEN="your_discord_api_token_here"
# Telegram Bot (for sending notifications TO your Telegram account)
# The target user (PINGPAL_TARGET_TELEGRAM_USERID) MUST /start a chat with this bot once.
TELEGRAM_BOT_TOKEN="your_telegram_bot_token_for_sending_notifications"

# LLM Provider API Key (e.g., OpenAI)
OPENAI_API_KEY="your_llm_api_key_here" # Or ANTHROPIC_API_KEY, etc.

# PingPal Discord Plugin Specific User IDs (can also be set in character.settings)
# It's often convenient to manage these here if they are static.
PINGPAL_TARGET_DISCORD_USERID="the_discord_user_id_to_monitor_for_mentions"

PINGPAL_TARGET_TELEGRAM_USERID="your_numerical_telegram_user_id_to_receive_notifications"
```

### 2. Discord Bot Setup

1.  **Create a Discord Application & Bot:**
    - Go to the [Discord Developer Portal](https://discord.com/developers/applications).
    - Create a "New Application".
    - Go to the "Bot" tab.
    - Click "Add Bot" and confirm.
2.  **Get Bot Token:**
    - Under the "Bot" tab, click "Reset Token" (or "View Token") and copy the token. This is your `DISCORD_BOT_TOKEN`. **Keep it secret!**
3.  **Enable Privileged Gateway Intents:**
    - Still under the "Bot" tab, scroll down to "Privileged Gateway Intents".
    - Enable the **"MESSAGE CONTENT INTENT"**. This is crucial for the bot to read message content.
4.  **Invite Bot to Servers:**
    - Go to the "OAuth2" -> "URL Generator" tab.
    - Select the `bot` scope.
    - Under "Bot Permissions", select `Read Messages/View Channels` (and potentially `Send Messages` if it ever needs to respond, though not for this plugin's core function). A minimal set is often best.
    - Copy the generated URL and open it in your browser to invite the bot to your desired Discord server(s). You need administrator privileges on those servers.

### 3. Telegram Bot Setup (for Sending Notifications)

1.  **Create a Telegram Bot:**
    - Open Telegram and search for "BotFather".
    - Start a chat with BotFather and send the `/newbot` command.
    - Follow the prompts to choose a name and username for your bot.
    - BotFather will provide you with an API token. This is your `TELEGRAM_BOT_TOKEN`. **Keep it secret!**
2.  **Allow Bot to Send PMs:**
    - The user who will receive the notifications (identified by `PINGPAL_TARGET_TELEGRAM_USERID`) **must** find your newly created Telegram bot and send it a `/start` message (or any message). This action authorizes the bot to send private messages to that user.

### 4. Obtaining User IDs

- **Target Discord User ID (`PINGPAL_TARGET_DISCORD_USERID`):**
  1.  In Discord, go to User Settings -> Advanced.
  2.  Enable "Developer Mode".
  3.  Right-click on the target user's name (this could be yourself or another user you want to monitor mentions for) in a server or chat.
  4.  Select "Copy User ID".
- **Target Telegram User ID (`PINGPAL_TARGET_TELEGRAM_USERID`):**
  1.  In Telegram, search for a bot like `@userinfobot`.
  2.  Start a chat with it and send any message (e.g., `/start`).
  3.  It will reply with your user information, including your numerical "Id". This is your `PINGPAL_TARGET_TELEGRAM_USERID`.

### 5. ElizaOS Agent Character Configuration

In your agent's main configuration file (e.g., `src/index.ts` for a new project, or the relevant character file if adding to an existing setup):

```typescript
import type {
  Character,
  IAgentRuntime,
  Project,
  ProjectAgent,
} from "@elizaos/core";

// Import this plugin (adjust path if necessary, e.g., if it's a local package)
import pluginPingPalDiscord from "plugin-pingpal-discord"; // Or the name you've published/linked it as

export const character: Character = {
  name: "PingPal Discord Monitor Agent", // Give your agent a descriptive name
  bio: [
    "This agent monitors specific Discord servers for mentions of a target user.",
    "It analyzes these mentions for importance and sends alerts via Telegram for critical items.",
  ],
  plugins: [
    "@elizaos/plugin-discord", // For listening to Discord
    "@elizaos/plugin-telegram", // For sending notifications via Telegram
    "@elizaos/plugin-sql", // For storing processed message IDs (deduplication)
    "plugin-pingpal-discord", // This plugin!
  ],
  settings: {
    // Secrets allow ElizaOS to securely manage API keys from .env
    secrets: {
      DISCORD_BOT_TOKEN: process.env.DISCORD_BOT_TOKEN,
      TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY, // Or ANTHROPIC_API_KEY, etc.
    },
    // Plugin-specific settings
    pingpal: {
      // You can set these here or use the environment variables PINGPAL_TARGET_DISCORD_USERID
      // and PINGPAL_TARGET_TELEGRAM_USERID. Settings here override .env if both are present.
      targetDiscordUserId:
        process.env.PINGPAL_TARGET_DISCORD_USERID ||
        "YOUR_DISCORD_USER_ID_FALLBACK",
      targetTelegramUserId:
        process.env.PINGPAL_TARGET_TELEGRAM_USERID ||
        "YOUR_TELEGRAM_USER_ID_FALLBACK",
    },
    // Optional: Configure the LLM model if you don't want the default
    // modelProvider: "openai", // or "anthropic", etc.
    // model: "gpt-4-turbo-preview", // or "claude-3-sonnet-20240229", etc.
  },
  // style, other properties as needed
};

// Create a ProjectAgent that includes the character and this plugin's instance
export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => {
    console.log("Initializing PingPal Discord Monitor Agent:", character.name);
    // You can add any agent-specific initialization logic here
  },
  plugins: [pluginPingPalDiscord], // Add the plugin instance here
  tests: [],
};

// Export the full project with this agent
const project: Project = {
  agents: [projectAgent],
};

export default project;
```

**Note:** Ensure the `plugin-pingpal-discord` is correctly referenced. If you are developing it locally within the `packages/` directory of a monorepo, the import path might be different or handled by your build system (e.g., `import pluginPingPalDiscord from '../../plugin-pingpal-discord';` if your agent is in `packages/my-agent/src` and the plugin is `packages/plugin-pingpal-discord`). If installed as an npm package, `import pluginPingPalDiscord from "plugin-pingpal-discord";` should work.

## Running the Agent

Once your `.env` file is configured and your agent's `src/index.ts` (or equivalent character file) is set up:

1.  **Install Dependencies:**
    If you haven't already, or if you've made changes to `package.json`:
    ```bash
    npm install
    # or
    bun install
    ```
2.  **Start the ElizaOS Agent:**
    ```bash
    npx elizaos start
    ```
    Or, if `elizaos` is a dev dependency in your project's `package.json`:
    ```bash
    npm run elizaos -- start
    # or
    bun run elizaos start
    ```

Your agent should now connect to Discord, listen for mentions, and send notifications to your Telegram account for important messages. Check the console logs for initialization status and any errors.

## Development

If you are actively developing this plugin:

```bash
# Ensure dependencies are installed (if in a monorepo, potentially from the root)
# bun install

# Start development with hot-reloading (usually run from the plugin's directory)
npm run dev
# or
bun run dev

# Build the plugin
npm run build
# or
bun run build

# Test the plugin (if tests are configured)
npm run test
# or
bun run test
```

## Agent Configuration (package.json)

The `agentConfig` section in this plugin's `package.json` can define parameters for discovery in the ElizaOS plugin registry. For this plugin, the core configurable items are primarily handled through agent `settings` and `secrets`.

Example relevant settings that a user might configure for this plugin's behavior (which are read via `runtime.getSetting("pingpal.targetDiscordUserId")` etc.):

```json
"agentConfig": {
  "pluginType": "elizaos:plugin:1.0.0",
  "pluginParameters": {
    "pingpal_discord.targetDiscordUserId": {
      "type": "string",
      "description": "The Discord User ID to monitor for mentions (e.g., '123456789012345678')."
    },
    "pingpal_discord.targetTelegramUserId": {
      "type": "string",
      "description": "The numerical Telegram User ID to send notifications to."
    }
    // Note: DISCORD_BOT_TOKEN, TELEGRAM_BOT_TOKEN, and LLM API keys are
    // typically configured as agent-level secrets, not directly as pluginParameters here.
  }
}
```

This helps users understand what specific settings under the `pingpal_discord` key in their character configuration are used by this plugin.

## Publishing

Before publishing your plugin to the ElizaOS registry, ensure you meet these requirements:

1. **GitHub Repository**

   - Create a public GitHub repository for this plugin
   - Add the 'elizaos-plugins' topic to the repository
   - Use 'main' as the default branch

2. **Required Assets**

   - Add images to the `images/` directory:
     - `logo.jpg` (400x400px square, <500KB)
     - `banner.jpg` (1280x640px, <1MB)

3. **Publishing Process**

   ```bash
   # Check if your plugin meets all registry requirements
   npx elizaos plugin publish --test

   # Publish to the registry
   npx elizaos plugin publish
   ```

After publishing, your plugin will be submitted as a pull request to the ElizaOS registry for review.

## Configuration

The `agentConfig` section in `package.json` defines the parameters your plugin requires:

```json
"agentConfig": {
  "pluginType": "elizaos:plugin:1.0.0",
  "pluginParameters": {
    "API_KEY": {
      "type": "string",
      "description": "API key for the service"
    }
  }
}
```

Customize this section to match your plugin's requirements.

## Documentation

Provide clear documentation about:

- What your plugin does
- How to use it
- Required API keys or credentials
- Example usage
