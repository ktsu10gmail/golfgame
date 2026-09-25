export function replaceDraftMessage(messages, message) {
  if (!Array.isArray(messages)) throw new TypeError("messages must be an array");
  if (!message || typeof message !== "object" || !message.draftKey) {
    throw new TypeError("draft message must include a draftKey");
  }
  return [
    ...messages.filter(existing => existing?.draftKey !== message.draftKey),
    { ...message }
  ];
}
