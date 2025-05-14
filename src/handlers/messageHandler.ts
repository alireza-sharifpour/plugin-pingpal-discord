import type {
  IAgentRuntime,
  Memory,
  MessagePayload, // This is the type for message.content
  MemoryMetadata, // We will define a specific metadata for our processed logs
  Room,
  Content, // Base Room type from ElizaOS core
} from "@elizaos/core";
import { logger, ModelType, parseJSONObjectFromText } from "@elizaos/core";
import { sendPrivateNotification } from "./notificationHandler";

// --- Interface Definitions based on provided logs ---

// Interface for the structure of content within an incoming Discord message Memory object
interface DiscordMessageContent extends Content {
  source: "discord";
  url?: string; // e.g., https://discord.com/channels/{guildId}/{channelId}/{messageId}
  attachments?: any[];
  inReplyTo?: any;
}

// Interface for an incoming Discord message as a Memory object
interface IncomingDiscordMemory extends Memory {
  content: DiscordMessageContent;
  // `metadata` field from the incoming message from @elizaos/plugin-discord
  // is not expected to contain `sourceId` or other specific Discord details
  // based on the provided logs.
}

// Interface for the structure of the room object fetched by runtime.getRoom() for Discord
interface DiscordRoomData extends Room {
  // Extends base Room
  channelId?: string; // Actual Discord Channel Snowflake ID
  serverId?: string; // Actual Discord Server/Guild Snowflake ID
  worldId?: `${string}-${string}-${string}-${string}-${string}`;
  // `name` for the channel might be on the base Room type or often missing for Discord rooms if not explicitly set.
  // `metadata` on the Room object might contain more Discord-specific names if populated by the plugin.
}

// --- Placeholder for Notification Handler ---
// async function sendPrivateNotificationViaTelegram(
//   runtime: IAgentRuntime,
//   originalDiscordMessageData: {
//     text: string | undefined;
//     senderName: string;
//     serverName: string;
//     channelName: string;
//     messageLink: string;
//     originalDiscordMessageId: string;
//   },
//   analysisReason: string
// ): Promise<void> {
//   logger.info(
//     "[PingPal Discord] Placeholder: sendPrivateNotificationViaTelegram called.",
//     {
//       details:
//         "This function needs to be implemented in a separate notificationHandler.ts",
//       reason: analysisReason,
//       context: originalDiscordMessageData,
//       targetTelegramUserId: runtime.getSetting(
//         "pingpal_discord.targetTelegramUserId"
//       ),
//     }
//   );
//   return Promise.resolve();
// }
// --- End Placeholder for Notification Handler ---
const PINGPAL_TARGET_DISCORD_USERID = process.env.PINGPAL_TARGET_DISCORD_USERID;
// Helper function to parse IDs from Discord message URL
function parseDiscordUrl(url?: string): {
  guildId?: string;
  channelId?: string;
  messageId?: string;
} {
  if (!url) return {};
  try {
    // Regex to capture guildId, channelId, and messageId from a standard Discord message URL
    const parts = url.match(/channels\/(\d+)\/(\d+)\/(\d+)/);
    if (parts && parts.length === 4) {
      return {
        guildId: parts[1],
        channelId: parts[2],
        messageId: parts[3],
      };
    }
  } catch (e) {
    logger.warn(
      { error: e, url },
      "[PingPal Discord] Failed to parse Discord URL"
    );
  }
  return {};
}

async function performDiscordMentionAnalysis(
  runtime: IAgentRuntime,
  discordMessage: IncomingDiscordMemory
): Promise<void> {
  const messageUrl = discordMessage.content?.url;

  if (!messageUrl) {
    logger.error(
      { agentId: runtime.agentId, elizaMessageId: discordMessage.id },
      "[PingPal Discord] Message URL is missing in content. Cannot perform analysis."
    );
    return;
  }

  const {
    guildId: guildIdFromUrl,
    channelId: channelIdFromUrl,
    messageId: originalDiscordMessageIdFromUrl, // This is the primary source for original message ID
  } = parseDiscordUrl(messageUrl);

  if (!originalDiscordMessageIdFromUrl) {
    // Message ID from URL is critical
    logger.error(
      {
        agentId: runtime.agentId,
        elizaMessageId: discordMessage.id,
        url: messageUrl,
      },
      "[PingPal Discord] Could not parse Original Discord Message ID from URL. Aborting analysis."
    );
    return;
  }

  let guildIdForContext: string | undefined = guildIdFromUrl;
  let channelIdForContext: string | undefined = channelIdFromUrl; // Actual Discord Channel Snowflake ID
  let serverName = "Unknown Server";

  // Attempt to get more precise context from runtime.getRoom()
  try {
    const room = (await runtime.getRoom(
      discordMessage.roomId
    )) as DiscordRoomData | null;
    console.log("MyRoom", room);
    if (room) {
      logger.debug(
        { roomDetails: room },
        "[PingPal Discord] Fetched room details."
      );
      // Prioritize IDs from the room object if available, as they might be more canonical from Eliza's perspective
      if (room.serverId) guildIdForContext = room.serverId;
      if (room.channelId) channelIdForContext = room.channelId;

      // Attempt to get human-readable names
      // channelName = await getChannelName(runtime, room);
      console.log("channelName", channelIdForContext);
      // Attempt to get server name from World if worldId is available
      if (room.worldId) {
        try {
          const world = await runtime.getWorld(room.worldId);
          console.log("myWorld", world);
          if (world && world.name) {
            serverName = world.name;
            logger.debug(
              { serverNameFromWorld: world.name },
              "[PingPal Discord] Fetched server name from world."
            );
          } else {
            // Fallback to metadata if world or world.name is not found
            serverName =
              (room.metadata as any)?.discord?.guildName ||
              (room.metadata as any)?.guildName ||
              serverName;
          }
        } catch (worldError) {
          logger.warn(
            {
              error: worldError,
              agentId: runtime.agentId,
              elizaRoomId: discordMessage.roomId,
              worldId: room.worldId,
            },
            "[PingPal Discord] Could not fetch world details for server name. Using fallbacks."
          );
          // Ensure fallback to existing metadata logic if world fetch fails
          serverName =
            (room.metadata as any)?.discord?.guildName ||
            (room.metadata as any)?.guildName ||
            serverName;
        }
      } else {
        // If no worldId, use existing metadata logic for server name
        serverName =
          (room.metadata as any)?.discord?.guildName ||
          (room.metadata as any)?.guildName ||
          serverName;
      }
    }
  } catch (e) {
    logger.warn(
      {
        error: e,
        agentId: runtime.agentId,
        elizaRoomId: discordMessage.roomId,
      },
      "[PingPal Discord] Could not fetch room details for richer context. Using URL-parsed IDs and default names."
    );
  }

  // Ensure we have guild and channel IDs for context, falling back to URL if room query failed or lacked them
  if (!guildIdForContext && guildIdFromUrl) guildIdForContext = guildIdFromUrl;
  if (!channelIdForContext && channelIdFromUrl)
    channelIdForContext = channelIdFromUrl;

  if (!guildIdForContext || !channelIdForContext) {
    logger.error(
      {
        agentId: runtime.agentId,
        elizaMessageId: discordMessage.id,
        url: messageUrl,
        guildIdForContext,
        channelIdForContext,
      },
      "[PingPal Discord] Critical context IDs (guild or channel) are still missing after room fetch and URL parse. Aborting analysis."
    );
    return;
  }

  logger.info(
    {
      agentId: runtime.agentId,
      elizaInternalRoomId: discordMessage.roomId,
      discordChannelId: channelIdForContext,
      discordGuildId: guildIdForContext,
      elizaMessageId: discordMessage.id,
      originalDiscordMessageId: originalDiscordMessageIdFromUrl,
    },
    "[PingPal Discord] Performing mention analysis for Discord message..."
  );

  const messageText = discordMessage.content?.text || "";
  const targetDiscordUserId =
    runtime.getSetting("pingpal_discord.targetDiscordUserId") ||
    process.env.PINGPAL_TARGET_DISCORD_USERID;
  const targetUsernameOrIdForPrompt = targetDiscordUserId
    ? `(@${targetDiscordUserId})`
    : "the target user";

  let senderName = "Unknown User";
  try {
    const senderEntity = await runtime.getEntityById(discordMessage.entityId);
    senderName =
      senderEntity?.names?.[0] ||
      senderEntity?.metadata?.discord?.username ||
      senderName;
  } catch (e) {
    logger.warn(
      {
        error: e,
        agentId: runtime.agentId,
        senderElizaEntityId: discordMessage.entityId,
      },
      "[PingPal Discord] Could not fetch sender entity details."
    );
  }

  const llmPrompt = `You are an assistant helping filter Discord server messages. Analyze the following message sent by '${senderName}' in the channel '#${channelIdForContext}' on server '${serverName}'. Determine if this message requires the urgent attention or action of the user mentioned ('${targetUsernameOrIdForPrompt}'). Consider keywords like 'urgent', 'action needed', 'deadline', 'blocker', 'ping', 'help', direct questions, or tasks assigned.

Respond ONLY with a JSON object matching this schema:
{
  "type": "object",
  "properties": {
    "important": { "type": "boolean", "description": "True if the message requires urgent attention or action by the target user, false otherwise." },
    "reason": { "type": "string", "description": "A brief justification for the importance classification (1-2 sentences)." }
  },
  "required": ["important", "reason"]
}

Message Text:
"${messageText}"`;

  const outputSchema = {
    type: "object",
    properties: {
      important: { type: "boolean" },
      reason: { type: "string" },
    },
    required: ["important", "reason"],
  };

  let analysisResult: { important: boolean; reason: string } | null = null;
  try {
    logger.debug(
      { agentId: runtime.agentId, promptLength: llmPrompt.length },
      "[PingPal Discord] Calling LLM for analysis..."
    );
    const rawResponse = await runtime.useModel(ModelType.OBJECT_SMALL, {
      prompt: llmPrompt,
      schema: outputSchema,
    });

    if (
      typeof rawResponse === "object" &&
      rawResponse !== null &&
      typeof (rawResponse as any).important === "boolean" &&
      typeof (rawResponse as any).reason === "string"
    ) {
      analysisResult = rawResponse as { important: boolean; reason: string };
    } else if (typeof rawResponse === "string") {
      logger.warn(
        "[PingPal Discord] LLM returned a string, attempting to parse JSON."
      );
      const parsed = parseJSONObjectFromText(rawResponse);
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as any).important === "boolean" &&
        typeof (parsed as any).reason === "string"
      ) {
        analysisResult = parsed as { important: boolean; reason: string };
      } else {
        throw new Error(
          `Parsed JSON from string did not match expected format. Parsed: ${JSON.stringify(parsed)}`
        );
      }
    }
    if (
      !analysisResult ||
      typeof analysisResult.important === "undefined" ||
      typeof analysisResult.reason === "undefined"
    ) {
      throw new Error(
        `LLM response was not in the expected format. Raw response: ${JSON.stringify(rawResponse)}`
      );
    }
    logger.info(
      { analysisResult, agentId: runtime.agentId },
      "[PingPal Discord] LLM Analysis successful."
    );
  } catch (llmError) {
    logger.error(
      { error: llmError, agentId: runtime.agentId },
      "[PingPal Discord] LLM analysis failed."
    );
    analysisResult = { important: false, reason: "LLM analysis failed." };
  }

  logger.debug(
    {
      analysisResult,
      originalDiscordMessageId: originalDiscordMessageIdFromUrl,
    },
    "[PingPal Discord] Analysis complete. Logging processing status."
  );

  const notifiedViaTelegramStatus = analysisResult?.important || false;
  const processedDiscordMentionLog: Omit<Memory, "id" | "updatedAt"> = {
    entityId: runtime.agentId,
    roomId: discordMessage.roomId,
    agentId: runtime.agentId,
    createdAt: Date.now(),
    content: {
      text: `[PingPal Discord] Processed mention from Discord message ${originalDiscordMessageIdFromUrl}. Important: ${notifiedViaTelegramStatus}. Reason: ${analysisResult?.reason}`,
    },
    metadata: {
      type: "pingpal_discord_processed",
      originalDiscordMessageId: originalDiscordMessageIdFromUrl,
      notifiedViaTelegram: notifiedViaTelegramStatus,
      analysisResult: analysisResult?.reason,
      sourceContext: {
        // Storing the definitive guild and channel IDs used for context
        guildId: guildIdForContext,
        channelId: channelIdForContext,
      },
      originalSenderId: discordMessage.entityId,
      originalTimestamp: discordMessage.createdAt,
    } as MemoryMetadata,
  };
  console.log("processedDiscordMentionLog", processedDiscordMentionLog);
  try {
    await runtime.createMemory(
      processedDiscordMentionLog as Memory,
      "pingpal_discord_processed"
    );
    logger.info(
      {
        originalDiscordMessageId: originalDiscordMessageIdFromUrl,
        notified: notifiedViaTelegramStatus,
        agentId: runtime.agentId,
        roomId: discordMessage.roomId,
      },
      "[PingPal Discord] Logged processed Discord mention status successfully."
    );
  } catch (dbError) {
    logger.error(
      {
        error: dbError,
        originalDiscordMessageId: originalDiscordMessageIdFromUrl,
        agentId: runtime.agentId,
        roomId: discordMessage.roomId,
      },
      "[PingPal Discord] Failed to log processed Discord mention status."
    );
  }

  if (analysisResult && analysisResult.important === true) {
    logger.info(
      {
        originalDiscordMessageId: originalDiscordMessageIdFromUrl,
        agentId: runtime.agentId,
        reason: analysisResult.reason,
      },
      "[PingPal Discord] Important Discord mention identified, triggering notification placeholder."
    );
    const notificationData = {
      text: messageText,
      senderName,
      serverName,
      messageLink: messageUrl, // The direct URL to the Discord message
      originalDiscordMessageId: originalDiscordMessageIdFromUrl,
    };
    await sendPrivateNotification(
      runtime,
      notificationData,
      analysisResult.reason
    );
  } else {
    logger.info(
      {
        originalDiscordMessageId: originalDiscordMessageIdFromUrl,
        agentId: runtime.agentId,
        important: analysisResult?.important,
      },
      "[PingPal Discord] Discord mention processed, notification to Telegram not required."
    );
  }
}

// Main handler for incoming Discord messages, registered with EventType.MESSAGE_RECEIVED
export async function handleDiscordMessage(eventPayload: {
  runtime: IAgentRuntime;
  message: IncomingDiscordMemory;
}): Promise<void> {
  const { runtime, message: discordMessage } = eventPayload;

  logger.debug(
    {
      agentId: runtime.agentId,
      elizaInternalRoomId: discordMessage.roomId,
      elizaMessageId: discordMessage.id,
      messageContentUrl: discordMessage.content?.url,
      messageTextPreview:
        discordMessage.content?.text?.substring(0, 70) + "...",
    },
    `[PingPal Discord] Received message from Discord plugin.`
  );

  const targetDiscordUserId =
    runtime.getSetting("pingpal_discord.targetDiscordUserId") ||
    PINGPAL_TARGET_DISCORD_USERID;
  if (!targetDiscordUserId) {
    logger.warn(
      { agentId: runtime.agentId },
      "[PingPal Discord] targetDiscordUserId not configured. Cannot detect mentions."
    );
    return;
  }

  const messageText = discordMessage.content?.text || "";
  const mentionPattern = `(@${targetDiscordUserId})`; // Discord mentions are <@USER_ID>
  console.log("mentionPattern", mentionPattern);
  const mentionDetected = messageText.includes(mentionPattern);
  console.log("mentionDetected", mentionDetected);
  if (mentionDetected) {
    const messageUrl = discordMessage.content?.url;
    if (!messageUrl) {
      logger.error(
        { agentId: runtime.agentId, elizaMessageId: discordMessage.id },
        "[PingPal Discord] Mention detected, but message URL is missing. Cannot process."
      );
      return;
    }

    // Parse IDs for deduplication check
    const {
      messageId: originalDiscordMessageIdFromUrl,
      guildId: guildIdFromUrl, // Used for context in deduplication check
      channelId: channelIdFromUrl, // Used for context in deduplication check
    } = parseDiscordUrl(messageUrl);

    if (
      !originalDiscordMessageIdFromUrl ||
      !guildIdFromUrl ||
      !channelIdFromUrl
    ) {
      logger.error(
        {
          agentId: runtime.agentId,
          elizaMessageId: discordMessage.id,
          url: messageUrl,
        },
        "[PingPal Discord] Mention detected, but failed to parse essential IDs from URL for deduplication. Cannot process."
      );
      return;
    }

    logger.info(
      {
        agentId: runtime.agentId,
        elizaInternalRoomId: discordMessage.roomId,
        discordChannelIdFromUrl: channelIdFromUrl,
        discordGuildIdFromUrl: guildIdFromUrl,
        elizaMessageId: discordMessage.id,
        originalDiscordMessageId: originalDiscordMessageIdFromUrl,
      },
      "[PingPal Discord] Mention detected for target Discord user."
    );

    try {
      const existingLogs = await runtime.getMemories({
        tableName: "pingpal_discord_processed",
        agentId: runtime.agentId,
        roomId: discordMessage.roomId, // Query by Eliza's room ID to narrow down
        count: 50,
      });

      logger.info(
        {
          originalDiscordMessageId: originalDiscordMessageIdFromUrl,
          agentId: runtime.agentId,
          elizaInternalRoomId: discordMessage.roomId,
        },
        "[PingPal Discord] New Discord mention detected. Proceeding to analysis."
      );

      await performDiscordMentionAnalysis(runtime, discordMessage);
    } catch (dbError) {
      logger.error(
        {
          error: dbError,
          originalDiscordMessageId: originalDiscordMessageIdFromUrl,
          agentId: runtime.agentId,
          elizaInternalRoomId: discordMessage.roomId,
        },
        "[PingPal Discord] Error checking for duplicate Discord mentions."
      );
      return;
    }
  } else {
    logger.debug(
      {
        agentId: runtime.agentId,
        elizaInternalRoomId: discordMessage.roomId,
        elizaMessageId: discordMessage.id,
        messageTextPreview: messageText.substring(0, 70) + "...",
      },
      "[PingPal Discord] Message received, but no mention of target Discord user found."
    );
  }
}
