import medicalLexicon from "./medicalLexiconDictionary.json";

const numberWordMap = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20
};

const spineMap = {
  c: "C", t: "T", l: "L", s: "S"
};

/**
 * Normalizes raw spoken medical dictation into clean clinical text.
 * @param {string} rawText Raw transcript string
 * @returns {string} Standardized medical text
 */
export function normalizeMedicalText(rawText) {
  if (!rawText) return "";

  let text = String(rawText);

  // 1. Spoken Punctuation & Formatting Commands
  text = text
    .replace(/\b(period|full stop)\b/gi, ".")
    .replace(/\b(comma)\b/gi, ",")
    .replace(/\b(colon)\b/gi, ":")
    .replace(/\b(semi colon|semicolon)\b/gi, ";")
    .replace(/\b(open parenthesis|open bracket)\b/gi, "(")
    .replace(/\b(close parenthesis|close bracket)\b/gi, ")")
    .replace(/\b(bullet point|bullet)\b/gi, "• ")
    .replace(/\b(new paragraph|next paragraph)\b/gi, "\n\n")
    .replace(/\b(new line|next line)\b/gi, "\n");

  // 2. Spine Levels Normalization (e.g. "l four l five" -> "L4-L5", "c five c six" -> "C5-C6")
  text = text.replace(
    /\b(c|t|l|s)\s*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)\s*(to|-)?\s*(c|t|l|s)?\s*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|\d+)?\b/gi,
    (match, p1, p2, sep, p3, p4) => {
      const s1 = spineMap[p1.toLowerCase()] || p1.toUpperCase();
      const n1 = numberWordMap[p2.toLowerCase()] !== undefined ? numberWordMap[p2.toLowerCase()] : p2;
      
      if (!p4) {
        return `${s1}${n1}`;
      }
      
      const s2 = p3 ? (spineMap[p3.toLowerCase()] || p3.toUpperCase()) : s1;
      const n2 = numberWordMap[p4.toLowerCase()] !== undefined ? numberWordMap[p4.toLowerCase()] : p4;
      
      return `${s1}${n1}-${s2}${n2}`;
    }
  );

  // 3. Spoken Measurements & Units
  text = text
    .replace(/\b(\d+)\s*(millimeters?|mms?)\b/gi, "$1 mm")
    .replace(/\b(\d+)\s*(centimeters?|cms?)\b/gi, "$1 cm")
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*(millimeters?|mms?)\b/gi, (m, p1) => `${numberWordMap[p1.toLowerCase()]} mm`)
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*(centimeters?|cms?)\b/gi, (m, p1) => `${numberWordMap[p1.toLowerCase()]} cm`)
    .replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\s*point\s*(zero|one|two|three|four|five|six|seven|eight|nine)\s*(millimeters?|mms?|centimeters?|cms?)\b/gi, (m, p1, p2, u) => {
      const unit = u.toLowerCase().includes("cm") ? "cm" : "mm";
      return `${numberWordMap[p1.toLowerCase()]}.${numberWordMap[p2.toLowerCase()]} ${unit}`;
    })
    .replace(/\bhounsfield units?\b/gi, "HU")
    .replace(/\b(\d+)\s*h u\b/gi, "$1 HU")
    .replace(/\b(\d+)\s*hu\b/gi, "$1 HU");

  // 4. Radiology Classifications & Modality Sequences
  text = text
    .replace(/\bbirads\s*([0-6][ab]?)\b/gi, "BI-RADS $1")
    .replace(/\bbi rads\s*([0-6][ab]?)\b/gi, "BI-RADS $1")
    .replace(/\blirads\s*([1-5m]|nc|tiv)\b/gi, "LI-RADS $1")
    .replace(/\bpirads\s*([1-5])\b/gi, "PI-RADS $1")
    .replace(/\bcadrads\s*([0-5][ab]?|n)\b/gi, "CAD-RADS $1")
    .replace(/\blungrads\s*([1-4][abx]?)\b/gi, "Lung-RADS $1")
    .replace(/\bt\s*1\s*weighted\b/gi, "T1-weighted")
    .replace(/\bt\s*2\s*weighted\b/gi, "T2-weighted")
    .replace(/\bt\s*2\s*flair\b/gi, "T2/FLAIR")
    .replace(/\bcontrast\s*enhanced\b/gi, "contrast-enhanced")
    .replace(/\bnon\s*contrast\b/gi, "non-contrast")
    .replace(/\bpost\s*gadolinium\b/gi, "post-gadolinium")
    .replace(/\bhigh\s*resolution\s*ct\b/gi, "HRCT")
    .replace(/\bct\s*pulmonary\s*angiogram\b/gi, "CTPA");

  // 5. Section Heading Formatting
  text = text
    .replace(/\b(findings|imaging findings)\s*:/gi, "FINDINGS:")
    .replace(/\b(impression|clinical impression)\s*:/gi, "IMPRESSION:")
    .replace(/\b(recommendations?)\s*:/gi, "RECOMMENDATION:");

  // 6. Formatting space cleanups around punctuation
  text = text
    .replace(/\s+([.,;:?])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");

  return text;
}

export { medicalLexicon };
