import type {
  IAgentRuntime,
  Memory,
  MessagePayload,
  MemoryMetadata,
} from "@elizaos/core";
import { logger, ModelType, parseJSONObjectFromText } from "@elizaos/core"; // Use Eliza's logger, ADDED ModelType, parseJSONObjectFromText

// Define performMentionAnalysis stub here
// We'll pass the full message object to it.
export async function handleDiscordMessage(
  payload: MessagePayload
): Promise<void> {
  const { runtime, message } = payload;

  logger.debug(
    {
      agentId: runtime.agentId,
      roomId: message.roomId,
      messageId: message.id, // This is Eliza's internal message ID
    },
    `[PingPal] Received message: ${message.content?.text}`
  );

  // Retrieve the configured target username from settings
  const targetUsernameSetting = runtime.getSetting("pingpal.targetUsername");
  // Using hardcoded value for now based on previous context
  const targetUsername = targetUsernameSetting || "alireza7612";

  logger.debug(
    {
      agentId: runtime.agentId,
      targetUsername: targetUsername,
    },
    `[PingPal] Target username configured as: ${targetUsername}`
  );

  // Retrieve the message text safely
  const messageText = message.content?.text || "";
  console.log("messageText", messageText);
  // Check for the mention of the target username (case-insensitive)
  const mentionDetected = targetUsername
    ? messageText.toLowerCase().includes(targetUsername.toLowerCase())
    : false;

  // Log if a mention is detected
  if (mentionDetected) {
    // --- WORKAROUND ---
    // Ideally, we'd use message.metadata.sourceId to get the original Telegram message ID
    // for robust deduplication. However, it appears the current version of @elizaos/plugin-telegram
    // is not populating this field (or the metadata field itself) in the Memory object it creates.
    // As a fallback, we'll use Eliza's internal Memory ID (message.id) for deduplication.
    // Limitation: This only prevents processing the *exact same Memory object* multiple times.
    // It might not prevent reprocessing the same *original Telegram message* if the event fires
    // multiple times (e.g., after a restart).
    const elizaMessageId = message.id; // Use Eliza's internal unique ID for this memory object

    logger.info(
      {
        agentId: runtime.agentId,
        roomId: message.roomId,
        elizaMessageId: elizaMessageId, // Log the ID being used
        mentionDetected: mentionDetected,
        messageText: messageText,
      },
      "[PingPal] Mention detected for target user."
    );

    // Check if the elizaMessageId exists (it always should for a valid Memory object)
    if (!elizaMessageId) {
      // This would be very unusual if 'message' is a valid Memory object
      logger.error(
        {
          agentId: runtime.agentId,
          roomId: message.roomId,
          messageObject: message, // Log the whole object for debugging
        },
        "[PingPal] Could not find internal Eliza message ID (message.id). This is unexpected."
      );
      return;
    }

    // Query the database to check if this Eliza message ID has already been processed
    try {
      // Fetch recent processed mention logs for this room/agent
      const existing = await runtime.getMemories({
        tableName: "pingpal_processed_mentions", // The table where *we* store processing logs
        agentId: runtime.agentId, // Ensure we only check logs for this agent
        roomId: message.roomId, // Scope check to the room
        count: 50, // Fetch a reasonable number of recent logs to filter manually
      });

      // Filter the results manually. We need to check the custom metadata field
      // where *we will store* the Eliza ID in persistence logic.
      const isDuplicate = existing.some((mem) => {
        // Check if it's our specific log type AND if our custom ID field matches
        return (
          mem.metadata?.type === "pingpal_processed_mention" &&
          (mem.metadata as any)?.processedElizaMessageId === elizaMessageId
        );
      });

      if (isDuplicate) {
        logger.info(
          { elizaMessageId, agentId: runtime.agentId, roomId: message.roomId },
          "[PingPal] Duplicate mention detected based on processed logs (using Eliza ID). Skipping processing."
        );
        return; // Stop processing if already handled
      }

      // If check passes (no duplicate found), log that this is a new mention
      logger.info(
        { elizaMessageId, agentId: runtime.agentId, roomId: message.roomId },
        "[PingPal] New mention detected (using Eliza ID). Proceeding to analysis."
      );

      // Call the analysis function for new mentions, passing the original message object
    } catch (dbError) {
      logger.error(
        {
          error: dbError,
          elizaMessageId,
          agentId: runtime.agentId,
          roomId: message.roomId,
        },
        "[PingPal] Error checking for duplicate mentions (using Eliza ID)."
      );
      // Stop on DB error for MVP
      return;
    }
  } else {
    logger.debug(
      {
        agentId: runtime.agentId,
        roomId: message.roomId,
        messageId: message.id,
        messageText: messageText.substring(0, 50) + "...", // Log snippet for context
      },
      "[PingPal] Message received, but no mention of target user found."
    );
  }
}
