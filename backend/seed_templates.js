require("dotenv").config();
const pool = require("./db");

const templates = [
  // CT TEMPLATES
  {
    template_name: "CT Head / Brain (Plain & Acute Stroke)",
    modality: "CT",
    body_part: "Head",
    template_type: "normal",
    content: {
      history: "Acute neurological deficit / cephalea.",
      findings: "<p><b>TECHNIQUE:</b> Non-contrast axial CT scan of the brain from skull base to vertex with 5mm thin reconstructed slices.</p><p><b>BRAIN PARENCHYMA:</b> Cerebral hemispheres show normal grey-white matter differentiation. No focal parenchymal attenuation abnormality or acute ischemic infarct identified. No intra-axial or extra-axial hematoma, subdural, or epidural fluid collection.</p><p><b>VENTRICLES & CISTERNS:</b> Lateral, third, and fourth ventricles are normal in size, shape, and midline alignment. Basal cisterns and cortical sulci are clear.</p><p><b>POSTERIOR FOSSA:</b> Cerebellar hemispheres and brainstem demonstrate normal attenuation. No mass effect.</p><p><b>BONY CALVARIUM:</b> Calvarium and skull base intact without fracture line.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal non-contrast CT brain study. No acute intracranial hemorrhage, mass effect, or territorial infarct.</p>"
    }
  },
  {
    template_name: "CT Coronary Angiography (CTCA - CAD-RADS)",
    modality: "CT",
    body_part: "Heart",
    template_type: "contrast",
    content: {
      history: "Atypical chest pain / Coronary CAD screening.",
      findings: "<p><b>TECHNIQUE:</b> ECG-gated multiphase contrast-enhanced CT Coronary Angiography acquired during breath-hold.</p><p><b>CORONARY ARTERY CALCIUM SCORE:</b> Agatston score = 0 (Zero calcium).</p><p><b>LEFT MAIN (LM):</b> Normal origin and course. No luminal stenosis or calcified plaque.</p><p><b>LEFT ANTERIOR DESCENDING (LAD):</b> Patent lumen with no hemodynamically significant stenosis. Diagonal branches normal.</p><p><b>LEFT CIRCUMFLEX (LCx):</b> Patent lumen. No significant stenosis. Marginal branches patent.</p><p><b>RIGHT CORONARY ARTERY (RCA):</b> Dominant RCA with smooth vessel wall. No stenosis.</p><p><b>CARDIAC CHAMBERS & MYOCARDIUM:</b> Normal LV wall thickness. Pericardial space clear.</p>",
      conclusion: "<p><b>IMPRESSION:</b> CAD-RADS 0 (No CAD): Normal coronary arteries with zero calcium score and no luminal stenosis.</p>"
    }
  },
  {
    template_name: "CT Pulmonary Angiography (CTPA - PE Protocol)",
    modality: "CT",
    body_part: "Chest",
    template_type: "contrast",
    content: {
      history: "Acute dyspnea / Elevated D-Dimer.",
      findings: "<p><b>TECHNIQUE:</b> High-flow contrast-enhanced CT pulmonary angiography in dedicated arterial phase.</p><p><b>PULMONARY ARTERIES:</b> Contrast opacification achieved in main, right, and left pulmonary trunks. No filling defect seen in main trunk, lobar, segmental, or subsegmental branches bilaterally. No acute pulmonary embolism.</p><p><b>RIGHT HEART STRAIN PARAMETERS:</b> RV/LV diameter ratio = 0.8 (Normal &lt; 1.0). Interventricular septum is central. IVC is non-dilated.</p><p><b>LUNG PARENCHYMA & PLEURA:</b> Clear pulmonary parenchyma. No wedge-shaped pulmonary infarction. No pleural effusion.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Negative for acute pulmonary thromboembolism. Normal right ventricular dimensions.</p>"
    }
  },
  {
    template_name: "HRCT Chest (Lungs & Interstitial Parenchyma)",
    modality: "CT",
    body_part: "Chest",
    template_type: "normal",
    content: {
      history: "Dyspnea and chronic dry cough.",
      findings: "<p><b>TECHNIQUE:</b> High-resolution thin-section CT scan of thorax in inspiratory breath-hold with prone/supine reconstructions.</p><p><b>LUNG PARENCHYMA:</b> Both lung fields demonstrate normal parenchymal attenuation. No ground-glass opacities, consolidation, subpleural reticulation, architectural distortion, or honeycombing.</p><p><b>TRACHEOBRONCHIAL TREE:</b> Trachea and major bronchi are patent with normal lumen caliber.</p><p><b>PLEURA & MEDIASTINUM:</b> No pleural effusion or pneumothorax. Mediastinal and hilar lymph nodes within normal limits.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal High-Resolution CT (HRCT) thorax study. No active ILD, fibrosis, or infectious consolidation.</p>"
    }
  },
  {
    template_name: "CT Abdomen & Pelvis (CECT Triple Phase)",
    modality: "CT",
    body_part: "Abdomen",
    template_type: "contrast",
    content: {
      history: "Abdominal pain evaluation.",
      findings: "<p><b>TECHNIQUE:</b> Contrast-enhanced CT scan of abdomen and pelvis with arterial, portal venous, and delayed phase imaging.</p><p><b>LIVER:</b> Normal size, smooth contour, and homogeneous arterial/venous enhancement. No focal hypervascular lesion or cyst.</p><p><b>GALLBLADDER & BILIARY TREE:</b> Gallbladder distended with thin non-edematous wall. CBD non-dilated (4mm).</p><p><b>PANCREAS & SPLEEN:</b> Pancreas demonstrates normal lobulated contour and enhancement. Spleen normal size.</p><p><b>KIDNEYS & ADRENALS:</b> Bilateral symmetric nephrogram and excretion. No calculus, renal mass, or hydronephrosis.</p><p><b>BOWEL & MESENTERY:</b> Normal caliber and enhancement of bowel loops. No free fluid, ascites, or pneumoperitoneum.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Unremarkable multiphase CECT scan of abdomen and pelvis.</p>"
    }
  },
  {
    template_name: "CT KUB (Non-Contrast Urolithiasis Protocol)",
    modality: "CT",
    body_part: "KUB",
    template_type: "plain",
    content: {
      history: "Acute flank pain / Renal colic.",
      findings: "<p><b>TECHNIQUE:</b> Non-contrast CT scan from upper renal poles to pubic symphysis.</p><p><b>RIGHT KIDNEY:</b> Normal size (11.2 cm), orientation, and cortical thickness. No hyperdense calculus or perinephric fat stranding.</p><p><b>LEFT KIDNEY:</b> Normal size (11.0 cm) and parenchymal attenuation. No calculus or hydronephrosis.</p><p><b>URETERS:</b> Bilateral ureters are non-dilated with no impacted radiopaque ureteric calculus.</p><p><b>URINARY BLADDER:</b> Well filled with uniform attenuation. No vesical calculus or bladder wall thickening.</p>",
      conclusion: "<p><b>IMPRESSION:</b> No urinary tract calculus or obstructive uropathy bilaterally.</p>"
    }
  },
  {
    template_name: "CT Paranasal Sinuses (PNS Plain)",
    modality: "CT",
    body_part: "PNS",
    template_type: "plain",
    content: {
      history: "Chronic sinusitis / Facial congestion.",
      findings: "<p><b>FINDINGS:</b> Coronal and axial views demonstrate complete air pneumatization of bilateral maxillary, frontal, anterior/posterior ethmoid, and sphenoid sinuses.</p><p>Mucosal lining is non-thickened without air-fluid level or polypoid soft tissue lesion.</p><p>Bilateral osteomeatal complexes and sphenoethmoidal recesses are patent. Nasal septum is midline.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal CT study of paranasal sinuses. Clear sinuses and patent osteomeatal units bilaterally.</p>"
    }
  },

  // MRI TEMPLATES
  {
    template_name: "MRI Brain (Neuro / Stroke & DWI Diffusion)",
    modality: "MRI",
    body_part: "Head",
    template_type: "normal",
    content: {
      history: "Vertigo / Dizziness / Rule out ischemic lesion.",
      findings: "<p><b>TECHNIQUE:</b> Multiplanar multi-sequence MRI of brain including T1, T2, FLAIR, DWI, ADC, and SWI sequences.</p><p><b>DIFFUSION WEIGHTED IMAGING (DWI):</b> No focal area of hyperintensity on DWI with corresponding hypointensity on ADC map. No evidence of acute ischemic stroke or cytotoxic edema.</p><p><b>BRAIN PARENCHYMA:</b> Cerebral and cerebellar hemispheres show normal signal intensity. No focal T2/FLAIR hyperintensity or mass effect. SWI shows no microhemorrhage or calcification.</p><p><b>VENTRICLES & CISTERNS:</b> Ventricular system and basal cisterns are normal in caliber and configuration.</p><p><b>VASCULAR FLOW VOIDS:</b> Major intracranial flow voids (ICA, MCA, ACA, PCA, Basilar artery) are preserved.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal MRI brain study. No acute ischemic infarct, hemorrhage, or space-occupying mass.</p>"
    }
  },
  {
    template_name: "MRI Cardiac (CMR Functional & Viability)",
    modality: "MRI",
    body_part: "Heart",
    template_type: "contrast",
    content: {
      history: "Cardiomyopathy / Myocarditis evaluation.",
      findings: "<p><b>TECHNIQUE:</b> Electrocardiographically gated Cine CMR (Short-axis, 2-chamber, 4-chamber), T2-mapping, and Late Gadolinium Enhancement (LGE).</p><p><b>LEFT VENTRICULAR FUNCTION:</b> EDV = 132 ml, ESV = 48 ml, SV = 84 ml. LVEF = 64% (Preserved). Normal myocardial mass.</p><p><b>REGIONAL WALL MOTION:</b> Normal circumferential contraction without hypokinesis or akinesis.</p><p><b>MYOCARDIAL INFLAMMATION & T2 MAPPING:</b> T2 signal intensity and T2 mapping show no myocardial edema.</p><p><b>LATE GADOLINIUM ENHANCEMENT (LGE):</b> No subendocardial, transmural, or mid-wall hyperenhancement. No scar or infarction.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal CMR study. Preserved LV systolic function (EF 64%) without myocardial scarring, edema, or myocarditis.</p>"
    }
  },
  {
    template_name: "MRI Lumbar Spine (Radiculopathy Protocol)",
    modality: "MRI",
    body_part: "Spine",
    template_type: "plain",
    content: {
      history: "Low back pain with right sciatica.",
      findings: "<p><b>TECHNIQUE:</b> Sagittal and axial T1W, T2W, and STIR sequences of lumbar spine.</p><p><b>VERTEBRAE & ALIGNMENT:</b> Normal lumbar lordosis. Vertebral height and marrow signal intensity maintained. STIR shows no bone marrow edema.</p><p><b>DISC LEVELS:</b></p><p>• <b>L3-L4:</b> Disc height and hydration preserved. No bulge.</p><p>• <b>L4-L5:</b> Mild disc T2 signal loss with posterior disc protrusion impinging upon anterior epidural fat. Bilateral neural foramina patent.</p><p>• <b>L5-S1:</b> Normal disc height. No protrusion.</p><p><b>CONUS MEDULLARIS:</b> Terminates normally at L1 level. Cauda equina nerve roots descend freely.</p>",
      conclusion: "<p><b>IMPRESSION:</b> L4-L5 degenerative disc protrusion without significant spinal canal or nerve root compression.</p>"
    }
  },
  {
    template_name: "MRI Knee Joint (MSK Ligament & Meniscus)",
    modality: "MRI",
    body_part: "Extremity",
    template_type: "plain",
    content: {
      history: "Knee injury following sports trauma.",
      findings: "<p><b>CRUCIATE LIGAMENTS:</b> Anterior Cruciate Ligament (ACL) and Posterior Cruciate Ligament (PCL) display low T1/T2 signal intensity and continuous fiber orientation. No tear.</p><p><b>MENISCI:</b> Medial and lateral menisci show normal triangular shape with uniform low signal. No grade III meniscal tear line reaching articular surface.</p><p><b>COLLATERAL LIGAMENTS:</b> MCL and LCL are intact with normal periligamentous soft tissue.</p><p><b>CARTILAGE & BONE MARROW:</b> Patellofemoral and femorotibial cartilage thickness maintained. No subchondral bone contusion.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal MRI knee joint. No internal derangement, meniscal tear, or ligamentous rupture.</p>"
    }
  },
  {
    template_name: "MRI Prostate (Multiparametric mpMRI - PI-RADS v2.1)",
    modality: "MRI",
    body_part: "Prostate",
    template_type: "contrast",
    content: {
      history: "Elevated PSA / Prostate screening.",
      findings: "<p><b>TECHNIQUE:</b> High-resolution multiparametric MRI (T2W, DWI/ADC, and Dynamic Contrast Enhancement - DCE).</p><p><b>PROSTATE VOLUME:</b> Dimensions 4.2 x 3.6 x 4.0 cm (Volume = 31 cc).</p><p><b>PERIPHERAL ZONE (PZ):</b> Homogeneous high signal intensity on T2W. No focal hypointense lesion with restricted diffusion. ADC map shows no signal drop.</p><p><b>TRANSITION ZONE (TZ):</b> Benign prostatic hyperplasia (BPH) nodular enlargement with intact capsule.</p><p><b>NEUROVASCULAR BUNDLES & SEMINAL VESICLES:</b> Intact bilaterally without extraprostatic extension.</p>",
      conclusion: "<p><b>IMPRESSION:</b> PI-RADS 2 (Very Low Risk): Benign prostatic hyperplasia (BPH) without focal suspicious lesion in peripheral or transition zones.</p>"
    }
  },

  // XA (X-RAY ANGIOGRAPHY & INTERVENTIONAL)
  {
    template_name: "XA Diagnostic Cerebral Angiography (Four-Vessel DSA)",
    modality: "XA",
    body_part: "Head",
    template_type: "contrast",
    content: {
      history: "Intracranial vascular evaluation / Rule out aneurysm.",
      findings: "<p><b>TECHNIQUE:</b> Selective catheterization of bilateral Internal Carotid Arteries (ICA) and Vertebral Arteries (VA) via transfemoral approach with Digital Subtraction Angiography (DSA).</p><p><b>RIGHT CAROTID CIRCULATION:</b> Right ICA cervical, petrous, cavernous, and supraclinoid segments are patent with normal caliber. Right MCA (M1/M2) and ACA (A1/A2) demonstrate smooth branching. No aneurysm, AVM, or occlusion.</p><p><b>LEFT CAROTID CIRCULATION:</b> Left ICA cervical and intracranial branches are patent with normal flow velocity. No stenosis.</p><p><b>VERTEBROBASILAR SYSTEM:</b> Bilateral vertebral arteries, basilar trunk, and Posterior Cerebral Arteries (PCA) show normal vascular architecture. Circle of Willis is complete.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal four-vessel digital subtraction cerebral angiography (DSA). No intracranial aneurysm, arteriovenous malformation (AVM), or arterial stenosis.</p>"
    }
  },
  {
    template_name: "XA Peripheral Angiography & Lower Limb DSA",
    modality: "XA",
    body_part: "Extremity",
    template_type: "contrast",
    content: {
      history: "Lower limb claudication / Peripheral vascular evaluation.",
      findings: "<p><b>TECHNIQUE:</b> Abdominal aortography and bilateral lower extremity runoff angiography using Digital Subtraction Angiography (DSA).</p><p><b>AORTA & ILIAC ARTERIES:</b> Infrarenal abdominal aorta, bilateral Common Iliac (CIA), and External Iliac (EIA) arteries show smooth lumen without calcified plaque or occlusion.</p><p><b>FEMORAL & POPLITEAL RUNOFF:</b> Bilateral Common Femoral (CFA), Superficial Femoral (SFA), and Popliteal (PA) arteries demonstrate prompt contrast opacification with triphasic flow pattern.</p><p><b>INFRAPOPLITEAL ARTERIES:</b> Anterior Tibial (ATA), Posterior Tibial (PTA), and Peroneal arteries provide continuous 3-vessel runoff to the feet bilaterally.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Unremarkable bilateral lower extremity angiogram. Intact 3-vessel distal runoff bilaterally without arterial occlusion or critical limb ischemia.</p>"
    }
  },
  {
    template_name: "XA Cardiac Catheterization & Coronary Angiography",
    modality: "XA",
    body_part: "Heart",
    template_type: "contrast",
    content: {
      history: "Angina pectoris / Coronary artery evaluation.",
      findings: "<p><b>TECHNIQUE:</b> Selective coronary angiography performed via right radial approach using 6F diagnostic catheters under fluoroscopic control.</p><p><b>LEFT MAIN (LM):</b> Normal vessel caliber without ostial or distal stenosis.</p><p><b>LEFT ANTERIOR DESCENDING (LAD):</b> Smooth vessel walls without hemodynamically significant lumen narrowing (&lt;30%). Diagonal branches patent.</p><p><b>LEFT CIRCUMFLEX (LCx):</b> Patent vessel with normal TIMI-3 flow. Obtuse marginal branches patent.</p><p><b>RIGHT CORONARY ARTERY (RCA):</b> Dominant RCA with smooth filling and TIMI-3 flow to posterior descending branch.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal coronary arteriogram. Normal coronary arteries with TIMI-3 flow and no significant stenosis.</p>"
    }
  },

  // PET / PT (POSITRON EMISSION TOMOGRAPHY / PET-CT)
  {
    template_name: "PET-CT 18F-FDG Whole Body Oncology Scan (SUVmax)",
    modality: "PT",
    body_part: "Whole Body",
    template_type: "contrast",
    content: {
      history: "Whole body oncological staging / Treatment response evaluation.",
      findings: "<p><b>TECHNIQUE:</b> Whole body PET scan acquired from skull vertex to mid-thigh 60 minutes after intravenous administration of 18F-FDG (350 MBQ) integrated with low-dose attenuation correction CT.</p><p><b>HEAD & NECK:</b> Physiological FDG uptake in cerebral cortex and extraocular muscles. Brain SUVmax = 12.4 (Normal). Salivary glands and thyroid normal.</p><p><b>CHEST & MEDIASTINUM:</b> Symmetrical physiological myocardial uptake. Lungs clear without FDG-avid parenchymal nodule or mass. Mediastinal and hilar lymph nodes show non-pathological baseline uptake (SUVmax &lt; 2.0).</p><p><b>ABDOMEN & PELVIS:</b> Physiological intense urinary excretion in kidneys and bladder. Normal hepatic parenchyma (Background SUVmean = 2.2). Stomach and intestinal loops show diffuse non-focal physiological excretion. No hypermetabolic intra-abdominal mass or peritoneal implant.</p><p><b>MUSCULOSKELETAL SYSTEM:</b> Symmetrical marrow distribution without focal lytic or sclerotic FDG-avid osseous lesion.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal 18F-FDG PET-CT whole body study. No evidence of FDG-avid hypermetabolic malignant tumor, distant metastasis, or pathological lymphadenopathy.</p>"
    }
  },
  {
    template_name: "PET-CT 68Ga-PSMA Prostate Cancer Staging",
    modality: "PT",
    body_part: "Prostate",
    template_type: "contrast",
    content: {
      history: "Prostate carcinoma staging / Biochemical recurrence.",
      findings: "<p><b>TECHNIQUE:</b> Whole-body PET-CT imaging performed 60 minutes after administration of 185 MBq 68Ga-PSMA-11 tracer.</p><p><b>PROSTATE GLAND:</b> Homogeneous low-grade tracer activity within prostate gland. No hypermetabolic focal lesion with abnormal PSMA overexpression (Prostate SUVmax = 3.1, Background SUVmean = 2.4).</p><p><b>LYMPH NODES:</b> No PSMA-avid obturator, internal/external iliac, or retroperitoneal lymph nodes.</p><p><b>OSSEOUS STRUCTURES:</b> Skeletal system shows no focal areas of abnormal 68Ga-PSMA uptake to suggest bone metastases.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Negative for PSMA-avid primary prostate malignancy or distant metastatic disease.</p>"
    }
  },
  {
    template_name: "PET-CT Brain Metabolic Scan (Dementia & Epilepsy)",
    modality: "PT",
    body_part: "Head",
    template_type: "normal",
    content: {
      history: "Memory impairment / Dementia evaluation.",
      findings: "<p><b>TECHNIQUE:</b> High-resolution PET-CT scan of brain acquired 45 minutes following IV administration of 185 MBq 18F-FDG under quiet dark-room conditions.</p><p><b>METABOLIC BRAIN MAP:</b> Symmetric FDG radiotracer uptake preserved throughout bilateral frontal, parietal, temporal, and occipital cerebral cortex.</p><p><b>SUBCORTICAL STRUCTURES:</b> Basal ganglia and thalami display expected high metabolic activity. Cerebellar metabolism is symmetric.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal cerebral glucose metabolism. No regional hypometabolism pattern to suggest Alzheimer's dementia or frontotemporal degeneration.</p>"
    }
  },

  // MAMMOGRAPHY TEMPLATES
  {
    template_name: "Digital Mammography Bilateral (BI-RADS Protocol)",
    modality: "MG",
    body_part: "Breast",
    template_type: "normal",
    content: {
      history: "Routine annual screening mammography.",
      findings: "<p><b>BREAST DENSITY (ACR Category):</b> Category B - Scattered areas of fibroglandular density.</p><p><b>RIGHT BREAST:</b> Cranio-caudal (CC) and Medio-lateral oblique (MLO) views demonstrate symmetrical fibroglandular parenchyma. No focal mass, spiculated lesion, architectural distortion, or suspicious microcalcifications. Skin and nipple-areolar complex are normal.</p><p><b>LEFT BREAST:</b> CC and MLO views show symmetrical tissue density. No solitary mass, microcalcifications, or architectural distortion. Nipple and skin contour intact.</p><p><b>AXILLARY REGIONS:</b> Normal oval fatty lymph nodes bilaterally. No pathological lymphadenopathy.</p>",
      conclusion: "<p><b>IMPRESSION:</b> BI-RADS 1 (Negative): Normal bilateral digital mammogram. No sign of malignancy.</p>"
    }
  },
  {
    template_name: "Diagnostic Mammography & Tomosynthesis (BI-RADS 2/3)",
    modality: "MG",
    body_part: "Breast",
    template_type: "plain",
    content: {
      history: "Palpable right breast lump evaluation.",
      findings: "<p><b>TECHNIQUE:</b> Bilateral 2D Digital Mammography supplemented with 3D Digital Breast Tomosynthesis (DBT) and spot compression views.</p><p><b>RIGHT BREAST:</b> Upper outer quadrant reveals a 12mm well-circumscribed circumscribed oval low-density mass. 3D Tomosynthesis confirms smooth margin without spiculation. No associated microcalcification or skin thickening.</p><p><b>LEFT BREAST:</b> Symmetrical glandular architecture without focal lesion.</p>",
      conclusion: "<p><b>IMPRESSION:</b> BI-RADS 2 (Benign Finding): Well-circumscribed benign intramammary lesion / cyst right upper outer quadrant.</p>"
    }
  },

  // ULTRASOUND & COLOR DOPPLER TEMPLATES
  {
    template_name: "USG Whole Abdomen & Pelvis (Complete)",
    modality: "US",
    body_part: "Abdomen",
    template_type: "normal",
    content: {
      history: "Abdominal discomfort screening.",
      findings: "<p><b>LIVER:</b> Normal in size (13.8 cm) with smooth margin and uniform echotexture. No focal echo lesion or fatty change.</p><p><b>GALLBLADDER & BILIARY TREE:</b> Gallbladder is well distended with thin non-edematous wall. Lumen is clear without calculus. CBD non-dilated (3.8 mm).</p><p><b>PANCREAS & SPLEEN:</b> Pancreas normal head, body, and tail echogenicity. Spleen normal length (10.2 cm).</p><p><b>KIDNEYS:</b> Right kidney (10.8 cm) and Left kidney (11.0 cm) demonstrate normal cortical thickness and CMD. No renal calculus or hydronephrosis.</p><p><b>URINARY BLADDER:</b> Well filled with smooth outline. No intraluminal calculus or growth.</p><p><b>PERITONEUM:</b> No free fluid, ascites, or lymphadenopathy in abdomen or pelvis.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Unremarkable ultrasound scan of whole abdomen and pelvis.</p>"
    }
  },
  {
    template_name: "Color Doppler Arterial Lower Limb",
    modality: "US",
    body_part: "Extremity",
    template_type: "plain",
    content: {
      history: "Intermittent claudication / Lower limb ischemia.",
      findings: "<p><b>RIGHT LOWER LIMB ARTERIES:</b> Common Femoral (CFA), Superficial Femoral (SFA), Popliteal (PA), Anterior Tibial (ATA), Posterior Tibial (PTA), and Dorsalis Pedis (DPA) arteries display normal lumen caliber, smooth wall, and high-resistance triphasic spectral flow waveforms. No stenosis or calcified plaque.</p><p><b>LEFT LOWER LIMB ARTERIES:</b> Triphasic flow velocity maintained throughout all arterial segments from CFA to DPA. Peak Systolic Velocity (PSV) within normal limits. No occlusion.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal arterial Color Doppler study of lower limbs. Bilateral triphasic flow without stenosis or peripheral arterial disease (PAD).</p>"
    }
  },
  {
    template_name: "Color Doppler Venous Lower Limb (DVT Protocol)",
    modality: "US",
    body_part: "Extremity",
    template_type: "plain",
    content: {
      history: "Unilateral leg swelling / Rule out DVT.",
      findings: "<p><b>RIGHT VENOUS SYSTEM:</b> Common Femoral Vein (CFV), Femoral Vein (FV), Deep Femoral Vein (DFV), Popliteal Vein (PV), and Posterior Tibial Veins (PTV) demonstrate full compressibility under transducer probe pressure. Color Doppler shows complete luminal fill with spontaneous phasic flow modulated by respiration.</p><p><b>LEFT VENOUS SYSTEM:</b> Complete compression achieved at all venous stations. Color flow fill complete without intraluminal thrombus or augmentation defect.</p><p><b>SUPERFICIAL VEINS:</b> Great Saphenous Veins (GSV) and Small Saphenous Veins (SSV) patent bilaterally without incompetence.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Negative for Deep Vein Thrombosis (DVT) or superficial venous thrombosis in lower extremities bilaterally.</p>"
    }
  },
  {
    template_name: "Carotid & Vertebral Color Doppler (Intima-Media)",
    modality: "US",
    body_part: "Neck",
    template_type: "plain",
    content: {
      history: "TIA / Stroke screening / Carotid evaluation.",
      findings: "<p><b>RIGHT CAROTID ARTERIES:</b> Common Carotid (CCA), Internal Carotid (ICA), and External Carotid (ECA) arteries show normal lumen diameter and smooth intima-media thickness (IMT = 0.65 mm). Spectral Doppler displays laminar low-resistance ICA waveform (PSV = 68 cm/s, EDV = 22 cm/s). No atheromatous plaque.</p><p><b>LEFT CAROTID ARTERIES:</b> Normal IMT (0.68 mm). ICA spectral velocities within normal limits (PSV = 72 cm/s). No luminal stenosis.</p><p><b>VERTEBRAL ARTERIES:</b> Antegrade low-resistance flow in bilateral vertebral arteries.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal Carotid & Vertebral Color Doppler study. Normal IMT without atherosclerotic plaque or carotid artery stenosis (&lt;50%).</p>"
    }
  },
  {
    template_name: "Obstetric USG (Fetal Anomaly & Biometry)",
    modality: "US",
    body_part: "Abdomen",
    template_type: "normal",
    content: {
      history: "Second trimester anomaly scan.",
      findings: "<p><b>FETAL BIOMETRY (Single Live Intrauterine Pregnancy):</b></p><p>• Biparietal Diameter (BPD): 48 mm (Corresponding to 20W 4D)</p><p>• Head Circumference (HC): 176 mm (Corresponding to 20W 2D)</p><p>• Abdominal Circumference (AC): 152 mm (Corresponding to 20W 3D)</p><p>• Femur Length (FL): 32 mm (Corresponding to 20W 1D)</p><p><b>ANATOMICAL EVALUATION:</b> Fetal skull, intracranial ventricles, spine, 4-chamber heart view, stomach bubble, bilateral kidneys, bladder, and 4-limb long bones show normal sonographic morphology.</p><p><b>PLACENTA & AMNIOTIC FLUID:</b> Placenta anterior Grade I, well clear of os. Amniotic fluid index (AFI) = 14.2 cm (Normal).</p>",
      conclusion: "<p><b>IMPRESSION:</b> Single live intrauterine gestation at ~20-21 weeks gestation with normal fetal biometry and anatomical anomaly evaluation.</p>"
    }
  },

  // CR / X-RAY TEMPLATES
  {
    template_name: "X-Ray Chest PA View (Screening & Cardiopulmonary)",
    modality: "CR",
    body_part: "Chest",
    template_type: "normal",
    content: {
      history: "Routine pre-employment screening / fever evaluation.",
      findings: "<p><b>TECHNIQUE:</b> Standard posterior-anterior (PA) chest radiograph in upright maximal inspiration.</p><p><b>LUNGS & PLEURA:</b> Both lung fields are clear without focal consolidation, parenchymal nodule, reticulation, or active infiltration. No pleural effusion or pneumothorax.</p><p><b>HEART & MEDIASTINUM:</b> Cardiothoracic ratio (CTR) is normal (&lt;50%). Mediastinal contours, aortic arch, and hilum within normal limits.</p><p><b>DIAPHRAGM & BONES:</b> Both costophrenic and cardiophrenic angles are sharp. Diaphragmatic domes intact. Ribs and shoulder girdle intact.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal chest radiograph (PA view). No acute cardiopulmonary lesion.</p>"
    }
  },
  {
    template_name: "X-Ray Lumbar Spine AP/Lateral",
    modality: "CR",
    body_part: "Spine",
    template_type: "plain",
    content: {
      history: "Back pain evaluation.",
      findings: "<p><b>FINDINGS:</b> Lumbar lordosis is preserved. Vertebral body heights, alignment, and pedicles are intact.</p><p>Intervertebral disc space heights maintained without significant narrowing.</p><p>Sacroiliac joints and posterior elements intact. No osteophytes or listhesis.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal radiograph of the lumbar spine.</p>"
    }
  },
  {
    template_name: "X-Ray Knee Joint AP/Lateral",
    modality: "CR",
    body_part: "Knee",
    template_type: "plain",
    content: {
      history: "Knee joint pain.",
      findings: "<p><b>FINDINGS:</b> Medial and lateral femorotibial joint spaces are preserved. Patellofemoral alignment normal.</p><p>No osteophyte formation, subchondral sclerosis, or bone erosion. No joint effusion or soft tissue swelling.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal radiograph of knee joint. No acute fracture or degenerative osteoarthritis.</p>"
    }
  },
  {
    template_name: "X-Ray KUB (Kidney, Ureter & Bladder - Plain AP)",
    modality: "CR",
    body_part: "Abdomen",
    template_type: "plain",
    content: {
      history: "Flank pain / Rule out urolithiasis.",
      findings: "<p><b>TECHNIQUE:</b> Standard anteroposterior (AP) plain radiograph of abdomen including renal areas down to pubic symphysis.</p><p><b>RENAL SHADOWS & PSOAS MARGINS:</b> Both renal outlines are normal in size, position, and orientation. Bilateral psoas shadow margins are clearly defined.</p><p><b>URINARY TRACT CALCULI:</b> No radiopaque calculus or abnormal calcification identified along the anatomical course of the kidneys, ureters, or urinary bladder region.</p><p><b>BOWEL GAS PATTERN:</b> Normal non-obstructive bowel gas distribution. No dilated bowel loops or free intraperitoneal air under diaphragm.</p><p><b>BONY SKELETON:</b> Visualized lumbar spine, sacroiliac joints, and pelvic girdle intact without lytic or sclerotic osseous lesion.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal plain X-Ray KUB study. No radiopaque urinary tract calculus identified.</p>"
    }
  },
  {
    template_name: "X-Ray PNS (Paranasal Sinuses - Water's View)",
    modality: "CR",
    body_part: "Head",
    template_type: "plain",
    content: {
      history: "Facial pain / Nasal congestion.",
      findings: "<p><b>TECHNIQUE:</b> Dedicated occipitomental (Water's) view radiograph of paranasal sinuses.</p><p><b>MAXILLARY SINUSES:</b> Both maxillary sinuses demonstrate normal pneumatization and translucent aeration. No mucosal thickening, air-fluid level, or sinus opacification.</p><p><b>FRONTAL & ETHMOID SINUSES:</b> Bilateral frontal sinuses and ethmoidal air cells are fully pneumatized and clear.</p><p><b>NASAL CAVITY & SEPTUM:</b> Nasal septum is central in midline. Nasal turbinates intact with normal airway alignment.</p><p><b>FACIAL SKELETON:</b> Orbital rims, zygomatic arches, maxilla, and mandibular borders intact without fracture.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal X-Ray Paranasal Sinuses (PNS Water's view). No radiographic evidence of acute sinusitis, mucosal thickening, or fluid level.</p>"
    }
  },
  {
    template_name: "X-Ray PNS (Maxillary Sinusitis / Mucosal Thickening)",
    modality: "CR",
    body_part: "Head",
    template_type: "plain",
    content: {
      history: "Sinus headache and rhinorrhea.",
      findings: "<p><b>TECHNIQUE:</b> Occipitomental (Water's) view radiograph of paranasal sinuses.</p><p><b>MAXILLARY SINUSES:</b> Mucosal thickening with partial opacification / air-fluid level observed in the maxillary sinus. Contralateral sinus demonstrates normal translucency.</p><p><b>FRONTAL & ETHMOID SINUSES:</b> Frontal and ethmoid sinuses are clear with preserved aeration.</p><p><b>NASAL SEPTUM:</b> Mild nasal septal deviation noted with compensatory turbinate hypertrophy.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Radiographic features consistent with acute/subacute maxillary sinusitis with mucosal thickening. Clinical correlation advised.</p>"
    }
  },

  // ECHOCARDIOGRAPHY TEMPLATES
  {
    template_name: "Adult 2D Echocardiography & Color Doppler",
    modality: "EC",
    body_part: "Heart",
    template_type: "normal",
    content: {
      history: "Pre-operative cardiac clearance / Dyspnea.",
      findings: "<p><b>LEFT VENTRICULAR FUNCTION:</b> LV internal dimensions normal (LVIDd = 4.6 cm, LVIDs = 2.9 cm). Preserved LV global systolic function with LVEF = 63%. No regional wall motion abnormality (RWMA).</p><p><b>VALVULAR SPECTRUM:</b></p><p>• <b>Mitral Valve:</b> Normal leaflet motion. No mitral stenosis (MS) or mitral regurgitation (MR).</p><p>• <b>Aortic Valve:</b> Tri-leaflet structure with normal opening. Peak velocity = 1.3 m/s. No aortic stenosis/regurgitation.</p><p>• <b>Tricuspid & Pulmonary Valves:</b> Normal leaflet motion. TR jet peak velocity = 2.1 m/s (Estimated PASP = 22 mmHg, Normal).</p><p><b>CHAMBER DIMENSIONS & PERICARDIUM:</b> LA, RA, and RV cavity dimensions within normal limits. Pericardial space clear.</p>",
      conclusion: "<p><b>IMPRESSION:</b> Normal 2D Echocardiography study with preserved LV systolic function (LVEF 63%). No RWMA or valvular abnormality. Normal pulmonary pressures.</p>"
    }
  }
];

async function seed() {
  await pool.query("DELETE FROM report_templates");
  for (const t of templates) {
    await pool.query(
      `INSERT INTO report_templates (template_name, modality, body_part, template_type, content, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, true, NOW(), NOW())`,
      [t.template_name, t.modality, t.body_part, t.template_type, JSON.stringify(t.content)]
    );
  }
  console.log(`✅ Successfully seeded ${templates.length} deep clinical high-end radiology templates into report_templates table!`);
  process.exit(0);
}

seed().catch(err => {
  console.error("Seed error:", err);
  process.exit(1);
});
