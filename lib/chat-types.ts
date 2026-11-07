export type ChatTurn = {
  role: "system" | "user" | "assistant";
  content: string;
};
