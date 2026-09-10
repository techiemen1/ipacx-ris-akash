/**
 * Radiology Terminology & Dictation Normalization Engine
 * Specialized for professional radiology reporting, anatomical terms, measurements, & voice macros.
 */

export function normalizeRadiologyDictation(rawText) {
  if (!rawText) return "";

  let text = rawText;

  // 1. Spoken Punctuation & Formatting Commands
  text = text
    .replace(/\b(period|full stop)\b/gi, ".")
    .replace(/\b(comma)\b/gi, ",")
    .replace(/\b(colon)\b/gi, ":")
    .replace(/\b(semi colon|semicolon)\b/gi, ";")
    .replace(/\b(open parenthesis|open bracket)\b/gi, "(")
    .replace(/\b(close parenthesis|close bracket)\b/gi, ")")
    .replace(/\b(new paragraph|next paragraph)\b/gi, "<p><br></p>")
    .replace(/\b(new line|next line)\b/gi, "<br/>");

  // 2. Dot Macro Voice Triggers (e.g., "dot normal", "dot chest")
  text = text
    .replace(/\bdot normal\b/gi, ".normal")
    .replace(/\bdot chest\b/gi, ".chest")
    .replace(/\bdot stroke\b/gi, ".stroke")
    .replace(/\bdot ctpa\b/gi, ".ctpa")
    .replace(/\bdot birads1\b/gi, ".birads1")
    .replace(/\bdot fetal\b/gi, ".fetal")
    .replace(/\bdot dvt\b/gi, ".dvt");

  // 3. Radiology Measurements & Numeric Formatting
  const numMap = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
  };

  text = text
    .replace(/\b(\d+)\s*(millimeters?|mms?)\b/gi, "$1 mm")
    .replace(/\b(\d+)\s*(centimeters?|cms?)\b/gi, "$1 cm")
    .replace(/\b(five|ten|one|two|three|four|six|seven|eight|nine)\s*(millimeters?|mms?)\b/gi, (m, p1) => {
      const val = numMap[p1.toLowerCase()] || p1;
      return `${val} mm`;
    })
    .replace(/\b(five|ten|one|two|three|four|six|seven|eight|nine)\s*(centimeters?|cms?)\b/gi, (m, p1) => {
      const val = numMap[p1.toLowerCase()] || p1;
      return `${val} cm`;
    })
    .replace(/\bhounsfield units?\b/gi, "HU")
    .replace(/\bh u\b/gi, "HU")
    .replace(/\bbirads\s*([0-6])\b/gi, "BI-RADS $1")
    .replace(/\bbi rads\s*([0-6])\b/gi, "BI-RADS $1")
    .replace(/\bt 1 weighted\b/gi, "T1-weighted")
    .replace(/\bt1 weighted\b/gi, "T1-weighted")
    .replace(/\bt 2 weighted\b/gi, "T2-weighted")
    .replace(/\bt2 weighted\b/gi, "T2-weighted")
    .replace(/\bt 2 flair\b/gi, "T2/FLAIR")
    .replace(/\bt2 flair\b/gi, "T2/FLAIR")
    .replace(/\bcontrast enhanced\b/gi, "contrast-enhanced")
    .replace(/\bnon contrast\b/gi, "non-contrast")
    .replace(/\bhigh resolution ct\b/gi, "HRCT")
    .replace(/\bct pulmonary angiogram\b/gi, "CTPA")
    .replace(/\bpost gadolinium\b/gi, "post-gadolinium")
    .replace(/\bpost contrast\b/gi, "post-contrast");

  // 4. Clinical Heading Auto-formatting
  text = text
    .replace(/\b(findings|imaging findings)\s*:/gi, "<strong>FINDINGS:</strong> ")
    .replace(/\b(impression|clinical impression)\s*:/gi, "<strong>IMPRESSION:</strong> ")
    .replace(/\b(recommendation|recommendations)\s*:/gi, "<strong>RECOMMENDATION:</strong> ");

  // 5. Clean up extra spaces around punctuation
  text = text
    .replace(/\s+([.,;:?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");

  return text;
}

/**
 * Creates and configures a Web Speech API SpeechRecognition instance with Radiology Grammar tuning
 */
export function createRadiologySpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) return null;

  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  // Attach Radiology Grammar List if supported by browser
  const SpeechGrammarList = window.SpeechGrammarList || window.webkitSpeechGrammarList;
  if (SpeechGrammarList) {
    try {
      const grammarList = new SpeechGrammarList();
      const radiologyJsgf = `#JSGF V1.0; grammar radiology; public <term> = nodule | lesion | consolidation | effusion | pneumothorax | hemorrhage | infarction | fracture | BI-RADS | T1-weighted | T2-weighted | FLAIR | Hounsfield | HU | cm | mm | HRCT | CTPA | dot normal | dot chest | dot stroke;`;
      grammarList.addFromString(radiologyJsgf, 1);
      recognition.grammars = grammarList;
    } catch (e) {
      // Browser grammar list notice fallback
    }
  }

  return recognition;
}
