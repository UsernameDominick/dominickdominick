
// Any settings row of the vault (used to keep it out of backups and safe through a restore).
export const isHiddenNotesKey = (key) => typeof key === "string" && key.startsWith("hidden_note");




