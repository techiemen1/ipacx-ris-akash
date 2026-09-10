import { CLINICAL_MACROS } from "../../utils/macroEngine";

export const VOICE_COMMANDS = {
  NAVIGATE_FINDINGS: ["go to findings", "navigate to findings", "jump to findings"],
  NAVIGATE_IMPRESSION: ["go to impression", "navigate to impression", "jump to impression", "go to conclusion"],
  CLEAR_FINDINGS: ["clear findings", "delete findings", "erase findings"],
  UNDO_LAST: ["scratch that", "undo last sentence", "erase last sentence"],
  INSERT_CHEST_TEMPLATE: ["insert normal chest template", "insert chest xray template", "normal chest xray"],
  INSERT_BRAIN_TEMPLATE: ["insert ct brain normal template", "insert brain ct template", "normal head ct"]
};

/**
 * Evaluates dictation text for actionable voice navigation or editing commands.
 * @param {string} text Raw or normalized dictation string
 * @returns {object} { isCommand: boolean, commandType: string|null, payload: any }
 */
export function parseVoiceCommand(text) {
  if (!text) return { isCommand: false, commandType: null };

  const clean = text.trim().toLowerCase();

  // 1. Navigation Commands
  if (VOICE_COMMANDS.NAVIGATE_FINDINGS.some(cmd => clean.includes(cmd))) {
    return { isCommand: true, commandType: "NAVIGATE", targetField: "findings" };
  }
  if (VOICE_COMMANDS.NAVIGATE_IMPRESSION.some(cmd => clean.includes(cmd))) {
    return { isCommand: true, commandType: "NAVIGATE", targetField: "conclusion" };
  }

  // 2. Clear / Undo Commands
  if (VOICE_COMMANDS.CLEAR_FINDINGS.some(cmd => clean.includes(cmd))) {
    return { isCommand: true, commandType: "CLEAR_FIELD", targetField: "findings" };
  }
  if (VOICE_COMMANDS.UNDO_LAST.some(cmd => clean.includes(cmd))) {
    return { isCommand: true, commandType: "UNDO" };
  }

  // 3. Template Triggers
  if (VOICE_COMMANDS.INSERT_CHEST_TEMPLATE.some(cmd => clean.includes(cmd))) {
    return { isCommand: true, commandType: "INSERT_TEMPLATE", templateHtml: CLINICAL_MACROS[".chest"] };
  }
  if (VOICE_COMMANDS.INSERT_BRAIN_TEMPLATE.some(cmd => clean.includes(cmd))) {
    return { isCommand: true, commandType: "INSERT_TEMPLATE", templateHtml: CLINICAL_MACROS[".cthead"] };
  }

  return { isCommand: false, commandType: null };
}
