import type { IAgentRuntime, Memory } from "@elizaos/core";
import { logger } from "@elizaos/core";

/**
 * Escapes characters for Telegram MarkdownV2 format.
 * See: [Telegram Bot API - MarkdownV2 Style](https://core.telegram.org/bots/api#markdownv2-style)
 */
function escapeMarkdownV2(text: string): string {
  // Escape characters: _ * [ ] ( ) ~ ` > # + - = | { } . !
  // Note: Characters must be escaped with a preceding '\\'.
  return text.replace(/([_*[\]()~`>#+\-=|{}.!])/g, "\\$1");
}

// Define the structure for the notification data coming from the Discord message handler
interface DiscordNotificationData {
  text: string | undefined; // Message content
  senderName: string; // Sender's name
  serverName: string; // Discord server name
  messageLink: string; // Direct URL to the Discord message
  originalDiscordMessageId: string; // ID of the original Discord message
}

/**
 * Sends a private notification message via Telegram.
 *
 * @param runtime - The agent runtime instance.
 * @param notificationDetails - The details of the Discord message that triggered the notification.
 * @param reason - The reason why the message was deemed important by the LLM.
 */
export async function sendPrivateNotification(
  runtime: IAgentRuntime,
  notificationDetails: DiscordNotificationData,
  reason: string
): Promise<void> {
  const originalDiscordMessageId = notificationDetails.originalDiscordMessageId;
  logger.info(
    {
      agentId: runtime.agentId,
      originalDiscordMessageId: originalDiscordMessageId,
      reason: reason,
      // Log the received server and channel names for debugging
      receivedServerName: notificationDetails.serverName,
    },
    "[PingPal Discord] Preparing to send private notification via Telegram. Received details logged."
  );

  try {
    // 1. Get Telegram Service
    const telegramService = runtime.getService("telegram");

    if (!telegramService) {
      logger.error(
        {
          agentId: runtime.agentId,
          originalDiscordMessageId: originalDiscordMessageId,
        },
        "[PingPal Discord] Telegram service not found. Cannot send notification."
      );
      return;
    }

    // 2. Get Target User ID (from a general PingPal setting, not Discord specific)
    const targetUserId =
      runtime.getSetting("pingpal.targetTelegramUserId") ||
      process.env.PINGPAL_TARGET_TELEGRAM_USERID; // Ensure you have a fallback or clear config for this
    if (!targetUserId) {
      logger.error(
        {
          agentId: runtime.agentId,
          originalDiscordMessageId: originalDiscordMessageId,
        },
        "[PingPal Discord] Target Telegram User ID not configured. Cannot send notification."
      );
      return;
    }

    // 3. Extract and Format Context from notificationDetails
    const senderName = escapeMarkdownV2(
      notificationDetails.senderName || "Unknown User"
    );
    const serverName = escapeMarkdownV2(
      notificationDetails.serverName || "Unknown Server"
    );
    const originalText = escapeMarkdownV2(
      notificationDetails.text || "No message content"
    );
    const messageLink = notificationDetails.messageLink; // No need to escape URLs for Markdown links usually
    const escapedReason = escapeMarkdownV2(reason);

    // 4. Format Notification Message (MarkdownV2)
    // Using a clear, structured format for the notification.
    // [Link Text](URL) is the MarkdownV2 format for links.
    const notificationText = `*🔔 PingPal Alert: Important Discord Mention*\n\n*From:* ${senderName}\n*Server:* ${serverName}\n\n*Reason:* ${escapedReason}\n\n*Original Message:*\n\`\`\`\n${originalText}\n\`\`\`\n\n[Link to Discord Message](${messageLink})`;

    // 5. Send Message
    logger.debug(
      {
        agentId: runtime.agentId,
        targetUserId: targetUserId,
        originalDiscordMessageId: originalDiscordMessageId,
        messageLength: notificationText.length,
      },
      "[PingPal Discord] Attempting to send notification via Telegram service."
    );

    if (
      telegramService &&
      (telegramService as any).bot?.telegram?.sendMessage
    ) {
      await (telegramService as any).bot.telegram.sendMessage(
        targetUserId,
        notificationText,
        { parse_mode: "MarkdownV2" } // Specify MarkdownV2 for formatting
      );
    } else {
      logger.error(
        {
          agentId: runtime.agentId,
          serviceObjectKeys: telegramService
            ? Object.keys(telegramService)
            : "null",
        },
        "[PingPal Discord] Could not find nested bot.telegram.sendMessage function on Telegram service instance."
      );
      throw new Error("Telegram service structure unexpected.");
    }

    logger.info(
      {
        agentId: runtime.agentId,
        targetUserId: targetUserId,
        originalDiscordMessageId: originalDiscordMessageId,
      },
      "[PingPal Discord] Private notification sent successfully."
    );
  } catch (sendError) {
    // It's good practice to log the error object itself for more details
    logger.error(
      {
        error:
          sendError instanceof Error
            ? {
                message: sendError.message,
                stack: sendError.stack,
                name: sendError.name,
              }
            : sendError,
        agentId: runtime.agentId,
        targetUserId:
          runtime.getSetting("pingpal.targetTelegramUserId") ||
          process.env.PINGPAL_TARGET_TELEGRAM_USERID,
        originalDiscordMessageId: originalDiscordMessageId,
      },
      "[PingPal Discord] Failed to send private notification." // Maintained console.error for immediate visibility if needed
    );
    // console.error("Send Error Details:", sendError); // Keep if helpful during dev
  }
}
