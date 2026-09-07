/**
 * Dynamic Clinical Radiology Macro & Dot Command Expansion Engine
 * Expands shorthand dot commands (e.g. .chest, .normal, .stroke, .birads1) into structured findings.
 */

export const CLINICAL_MACROS = {
  ".normal": `<p><b>FINDINGS:</b> All visualized structures demonstrate normal anatomical morphology, signal intensity, and alignment within physiological limits. No focal pathological lesion, acute ischemia, hemorrhage, or space-occupying mass identified.</p>`,
  
  ".chest": `<p><b>TECHNIQUE:</b> Standard posterior-anterior (PA) chest radiograph in upright maximal inspiration.</p>
<p><b>LUNGS & PLEURA:</b> Both lung fields are clear without focal consolidation, parenchymal nodule, reticulation, or active infiltration. No pleural effusion or pneumothorax.</p>
<p><b>HEART & MEDIASTINUM:</b> Cardiothoracic ratio (CTR) is normal (&lt;50%). Mediastinal contours, aortic arch, and hilum within normal limits.</p>
<p><b>DIAPHRAGM & BONES:</b> Both costophrenic and cardiophrenic angles are sharp. Diaphragmatic domes intact. Ribs and shoulder girdle intact.</p>`,

  ".cxr": `<p><b>LUNGS & PLEURA:</b> Clear lung fields bilaterally. No focal consolidation, pneumothorax, or pleural effusion.</p><p><b>CARDIOVASCULAR:</b> Normal cardiac size and mediastinal silhouette.</p>`,

  ".cthead": `<p><b>TECHNIQUE:</b> Non-contrast axial CT scan of the brain from skull base to vertex.</p>
<p><b>BRAIN PARENCHYMA:</b> Cerebral hemispheres show normal grey-white matter differentiation. No focal parenchymal attenuation abnormality or acute ischemic infarct identified. No intra-axial or extra-axial hematoma.</p>
<p><b>VENTRICLES & CISTERNS:</b> Lateral, third, and fourth ventricles are normal in size, shape, and midline alignment. Basal cisterns clear.</p>`,

  ".stroke": `<p><b>DWI & INFARCT EVALUATION:</b> No focal area of restricted diffusion on DWI with corresponding ADC signal drop. No acute territorial ischemic stroke or cytotoxic edema.</p><p><b>HEMORRHAGE EVALUATION:</b> No intra-axial hematoma, subdural, or subarachnoid hemorrhage.</p>`,

  ".ctpa": `<p><b>PULMONARY ARTERIES:</b> Contrast opacification achieved in main, right, and left pulmonary trunks. No filling defect seen in main trunk, lobar, segmental, or subsegmental branches bilaterally. No acute pulmonary embolism.</p><p><b>RIGHT HEART STRAIN:</b> RV/LV diameter ratio = 0.8 (Normal &lt; 1.0). Interventricular septum is central.</p>`,

  ".cadrads": `<p><b>CORONARY ARTERY CALCIUM SCORE:</b> Agatston score = 0 (Zero calcium).</p><p><b>CORONARY TREE:</b> Left Main (LM), Left Anterior Descending (LAD), Left Circumflex (LCx), and Right Coronary Artery (RCA) show patent lumens without luminal stenosis.</p><p><b>CAD-RADS CATEGORY:</b> CAD-RADS 0 (No CAD).</p>`,

  ".mribrain": `<p><b>BRAIN PARENCHYMA:</b> Cerebral and cerebellar hemispheres show normal T1, T2, and FLAIR signal intensity. No focal hyperintensity, demyelination, or mass effect.</p><p><b>VENTRICLES & CISTERNS:</b> Normal ventricular caliber and midline alignment.</p>`,

  ".mrispine": `<p><b>VERTEBRAE & ALIGNMENT:</b> Normal spinal lordosis. Vertebral body heights and marrow signal intensity maintained. STIR shows no bone marrow edema.</p><p><b>DISC LEVELS:</b> Mild L4-L5 disc protrusion without spinal canal stenosis. Remaining intervertebral disc spaces intact.</p>`,

  ".birads1": `<p><b>BREAST DENSITY:</b> Category B - Scattered fibroglandular density.</p><p><b>FINDINGS:</b> Symmetrical glandular parenchyma bilaterally. No focal mass, spiculated lesion, architectural distortion, or suspicious microcalcifications.</p><p><b>IMPRESSION: BI-RADS 1 (Negative).</b> Routine annual screening recommended.</p>`,

  ".birads2": `<p><b>FINDINGS:</b> Well-circumscribed benign intramammary calcified fibroadenoma / cyst. No spiculated mass or malignant microcalcifications.</p><p><b>IMPRESSION: BI-RADS 2 (Benign Finding).</b></p>`,

  ".abdusg": `<p><b>LIVER:</b> Normal size (13.5 cm), smooth margin, and uniform echotexture. No focal lesion.</p><p><b>GALLBLADDER & BILIARY TREE:</b> Gallbladder thin-walled, lumen clear without calculus. CBD 3.8 mm.</p><p><b>KIDNEYS:</b> Bilateral kidneys normal size, cortical thickness, and CMD. No calculus or hydronephrosis.</p><p><b>BLADDER & PELVIS:</b> Bladder well filled with smooth wall. No ascites or free fluid.</p>`,

  ".fetal": `<p><b>FETAL BIOMETRY (Single Live Intrauterine Pregnancy):</b> BPD = 48 mm, HC = 176 mm, AC = 152 mm, FL = 32 mm. Corresponding to ~20W gestation.</p><p><b>ANATOMICAL SURVEY:</b> Skull, 4-chamber heart, stomach, kidneys, and spine demonstrate normal morphology.</p><p><b>PLACENTA & LIQUOR:</b> Placenta anterior Grade I clear of os. AFI = 14 cm (Normal).</p>`,

  ".dvt": `<p><b>DEEP VENOUS SYSTEM:</b> Common Femoral (CFV), Femoral (FV), Popliteal (PV), and Posterior Tibial (PTV) veins demonstrate complete compressibility under probe pressure bilaterally. Color flow fill complete without intraluminal thrombus.</p><p><b>IMPRESSION: Negative for Deep Vein Thrombosis (DVT).</b></p>`,

  ".carotid": `<p><b>CAROTID ARTERIES:</b> Bilateral CCA, ICA, and ECA show smooth intima-media thickness (IMT = 0.65 mm). Normal ICA low-resistance velocity spectrum (PSV = 68 cm/s). No stenosis.</p>`,

  ".echo": `<p><b>LV FUNCTION:</b> Preserved LV global systolic function with LVEF = 63%. No regional wall motion abnormality (RWMA).</p><p><b>VALVES & PRESSURES:</b> Mitral, Aortic, and Tricuspid valves normal. Estimated PASP = 22 mmHg (Normal).</p>`
};

/**
 * Expands macro dot shorthands in HTML string
 * @param {string} text 
 * @returns {string} Expanded text
 */
export function expandClinicalMacros(text) {
  if (!text) return "";
  let result = String(text);

  Object.entries(CLINICAL_MACROS).forEach(([cmd, expansion]) => {
    // Match command followed by space or breaking tag or end of string
    const regex = new RegExp(`${cmd.replace('.', '\\.')}(?=\\s|&nbsp;|<br>|<p>|</p>|$)`, 'gi');
    if (regex.test(result)) {
      result = result.replace(regex, expansion);
    }
  });

  return result;
}
