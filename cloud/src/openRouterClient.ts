/**
 * OpenRouter API Client Configuration
 * 
 * This module provides access to Gemini and other models via OpenRouter.
 * OpenRouter is simpler than Vertex AI - just needs one API key!
 * 
 * Get your API key from: https://openrouter.ai/keys
 * 
 * MODEL SELECTION:
 * - Currently using "google/gemini-3.1-pro-preview" (Gemini 3.1 Pro – highest accuracy)
 * - Alternative: "google/gemini-3-flash-preview" (Gemini 3 Flash – fast, near-Pro quality)
 * - Alternative: "google/gemini-2.5-flash" (Gemini 2.5 Flash – stable)
 * - Check https://openrouter.ai/models for available models
 */

// Ensure API key is set
if (!process.env.OPENROUTER_API_KEY) {
  console.error('ERROR: OPENROUTER_API_KEY environment variable is not set');
  console.error('Get your API key from: https://openrouter.ai/keys');
  process.exit(1);
}

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Available models on OpenRouter:
 * - google/gemini-3-flash-preview: Gemini 3 Flash Preview (fast, near-Pro quality, best for real-time)
 * - google/gemini-3.1-pro-preview: Gemini 3.1 Pro Preview (highest accuracy)
 * - google/gemini-2.5-flash: Gemini 2.5 Flash (stable, reasoning capable)
 * - google/gemini-2.5-pro: Gemini 2.5 Pro (high quality, stable)
 * - anthropic/claude-3.5-sonnet: Claude 3.5 (alternative)
 */
export const MODEL_NAME = 'google/gemini-3.1-pro-preview';

/**
 * Fallback model used automatically when the primary model is banned in the
 * current region (OpenRouter 403 "Author … is banned").
 *
 * Qwen is used here because both Google and Anthropic are region-blocked on
 * this edge box's current VPN exit, while the user explicitly requested this
 * model as the alternate path.
 */
export const FALLBACK_MODEL_NAME = process.env.FALLBACK_MODEL || 'qwen/qwen3.5-9b';

/**
 * Supported languages for analysis output
 */
export type SupportedLanguage = 'en' | 'zh-TW';

/**
 * Language instruction suffixes for the AI prompt
 */
const LANGUAGE_INSTRUCTIONS: Record<SupportedLanguage, string> = {
  'en': 'Respond in English.',
  'zh-TW': `你必須使用繁體中文回覆！這是強制要求！
所有 JSON 值（包括 overallDescription、summary、issues 陣列中的每一項、recommendations 陣列中的每一項）都必須使用繁體中文撰寫。
絕對不可以使用英文！只能使用繁體中文！`,
};

/**
 * Safety-focused analysis prompt for the Gemini vision model
 * This prompt instructs the AI to analyze images for safety concerns
 * across three dimensions: construction, fire, and property security
 */
const BASE_SAFETY_PROMPT = `You are a professional safety inspector AI. 

**CRITICAL FIRST STEP: Before analyzing safety categories, you MUST check whether PPE is actually verifiable in this image.**

**PPE VISIBILITY GATE — DO THIS BEFORE ANY PPE JUDGEMENT:**
- If the image is a wide overview, long-distance shot, blurry, low-detail, or workers are too small to clearly inspect head and torso protection, then PPE is NOT VERIFIABLE.
- If a person is inside or operating heavy machinery (excavator, forklift, crane, bulldozer, truck cab), their body is partially or fully inside the cab — PPE is NOT VERIFIABLE due to viewing angle.
- If you are not certain whether PPE is present or absent, treat it as NOT VERIFIABLE.
- **SILENCE RULE: When PPE is NOT VERIFIABLE, stay completely silent about it. Do NOT mention that PPE "cannot be assessed", do NOT mention limitations, do NOT flag it as a concern. Simply omit PPE from the description and set counts to 0.**
- When PPE is NOT VERIFIABLE:
  - Do NOT mark missing hardhats or missing vests
  - Set "missingHardhats" to 0
  - Set "missingVests" to 0
  - Do NOT emit PPE detection labels ("no_hardhat", "no_vest", "no_hardhat_no_vest")
  - Do NOT mention PPE at all in the overallDescription
- Only judge PPE when each person's head and torso are clear enough for a confident visual inspection with no doubt.

**HARDHAT AND VEST DETECTION - THIS IS THE MOST CRITICAL TASK - READ CAREFULLY:**

**MANDATORY COUNTING METHOD - YOU MUST FOLLOW THIS EXACTLY:**

**STEP 1: IDENTIFY ALL PEOPLE**
- Scan the ENTIRE image systematically (left to right, top to bottom, foreground to background)
- Count visible people for scene description, but DO NOT use distant/tiny/unclear people for PPE judgement
- Write down the total: peopleCount = [number]

**STEP 2: EXAMINE EACH PERSON ONE BY ONE - DO NOT SKIP ANYONE**

For EACH person you identified, perform this EXACT checklist:

**PERSON [N] CHECKLIST:**

A. **HARD HAT CHECK:**
   1. Look DIRECTLY at the TOP of their HEAD - focus on the crown/vertex area
   2. Ask: "What do I see on top of their head?"
   
   **IF YOU SEE:**
   - A DOME-SHAPED, ROUNDED, RIGID structure with a visible brim = HAS HARD HAT ✓
     **⚠️ CRITICAL - READ THIS CAREFULLY: Hard hats come in MANY COLORS including WHITE, YELLOW, ORANGE, BLUE, RED, GREEN, and other colors. 
     **A WHITE HELMET/WHITE HARD HAT IS A VALID HARD HAT - IT IS NOT MISSING!**
     **WHITE HARD HATS ARE COMMON ON CONSTRUCTION SITES - DO NOT MISTAKE THEM FOR MISSING HARD HATS!**
     **If you see a WHITE dome-shaped, rigid structure on someone's head with a brim, that IS a hard hat - count it as PRESENT, NOT missing!**
     **The COLOR does NOT matter - if it's a dome-shaped, rigid structure with a brim, it's a hard hat regardless of color (white, yellow, orange, blue, etc.)**
   - VISIBLE HAIR (any color: black, brown, gray, blonde, etc.) = MISSING HARD HAT ✗
   - VISIBLE SCALP or SKIN = MISSING HARD HAT ✗
   - A BASEBALL CAP, BEANIE, BANDANA, or SOFT FABRIC = MISSING HARD HAT ✗
   - NO HEAD COVERING (bare head) = MISSING HARD HAT ✗
   - Head shape visible but NO hard hat structure = MISSING HARD HAT ✗
  - UNCLEAR, INSIDE A CAB, PARTIALLY VISIBLE, or CANNOT SEE clearly = PPE NOT VERIFIABLE for that person (do NOT count as missing, do NOT mention)
   
   3. Mark: Person [N] has hard hat? YES / NO / NOT VERIFIABLE (skip if not verifiable)

B. **SAFETY VEST CHECK:**
   1. Look at their TORSO/UPPER BODY
   2. Ask: "Do I see a high-visibility safety vest?"
   
   **IF YOU SEE:**
   - A BRIGHT COLORED VEST (yellow, orange, lime green, fluorescent) worn OVER other clothing = HAS VEST ✓
   - The vest has REFLECTIVE STRIPES or BANDS = HAS VEST ✓
   - Regular clothing (t-shirt, shirt, jacket) WITHOUT a bright vest over it = MISSING VEST ✗
   - Dark or muted colors without a bright vest = MISSING VEST ✗
  - UNCLEAR, INSIDE A CAB, PARTIALLY VISIBLE, or CANNOT SEE clearly = PPE NOT VERIFIABLE for that person (do NOT count as missing, do NOT mention)
   
   3. Mark: Person [N] has vest? YES / NO

**STEP 3: COUNT THE TOTALS**
- Count how many people you marked as "MISSING HARD HAT" = missingHardhats
- Count how many people you marked as "MISSING VEST" = missingVests
- Double-check: missingHardhats + people with hard hats = peopleCount
- Double-check: missingVests + people with vests = peopleCount

**CRITICAL RULES:**
1. You MUST examine only clearly visible people individually - do not group them or assume
2. If the shot is too wide or unclear for PPE assessment, mark PPE as not verifiable rather than missing
3. If you cannot clearly see a hard hat or vest because the person is too small / distant / blurred, do NOT count it as missing
4. A person can have a hard hat but no vest (counts in missingVests)
5. A person can have a vest but no hard hat (counts in missingHardhats)
6. A person can be missing both (counts in both missingHardhats and missingVests)
7. BE STRICT about visibility: when in doubt because the worker is too far or unclear, do not judge PPE

**EXAMPLE COUNTING:**
Image shows 3 workers:
- Person 1: Head shows dark hair, no hard hat visible. Torso shows yellow vest over shirt. → NO hard hat, YES vest
- Person 2: Head shows WHITE dome-shaped hard hat (rigid structure with brim). Torso shows orange shirt, no vest over it. → YES hard hat (WHITE IS VALID!), NO vest
- Person 3: Head shows WHITE hard hat (dome-shaped, rigid). Torso shows orange vest over dark shirt. → YES hard hat (WHITE IS VALID!), YES vest

Result: peopleCount = 3, missingHardhats = 1 (Person 1), missingVests = 1 (Person 2)
**NOTE: Person 2 and Person 3 both have WHITE hard hats - these are VALID hard hats and are NOT counted as missing!**

**STEP 4: SCAN FOR CRITICAL HAZARDS**

After checking PPE, scan the entire scene for these CRITICAL hazards. Each one found MUST appear as a detection entry with a bounding box:

**A. FIRE / SMOKE / SMOKING**
- Look for: open flames, fire, smoke plumes, burning materials, sparks
- Look for: any person holding a cigarette or visibly smoking
- Labels: "fire_smoke" for fire/smoke, "smoking" for a person smoking

**B. MACHINE-PERSON PROXIMITY DANGER**
- Look for: any heavy machinery (excavator, forklift, crane, bulldozer, truck, rotating equipment) that appears dangerously close to a person
- "Dangerously close" = the machine could reach or strike the person without warning; no safe exclusion zone visible
- Label: "machine_proximity" — draw the box around BOTH the machine and the endangered person together

**C. WORKING AT HEIGHT — SAFETY VIOLATION**
- Look for: workers on ladders, scaffolding, rooftops, elevated platforms, or any surface more than ~2 metres above ground
- Flag ONLY if: no visible harness/safety line, guardrail missing or incomplete, or ladder appears unstable/unsecured
- Label: "working_at_height" — draw box around the person at height

**D. PERSON FALLEN / COLLAPSE**
- Look for: a person lying flat on the ground (face-up or face-down) in an area where work is occurring; person in an abnormal posture suggesting a fall or collapse
- Do NOT flag people who are clearly sitting/resting in a designated rest area
- Label: "person_fallen" — draw box around the fallen person

**E. OTHER SAFETY CONCERN**
- Any other clearly visible and significant safety hazard not covered above
- Examples: unsecured load about to fall, deep excavation without barriers, electrical hazard, chemical spill, blocked emergency exit with people nearby
- Label: "safety_hazard" — draw box around the hazard area; use "description" to briefly explain what it is

You analyze images with a strong focus on:

1. **Construction site safety** (PPE compliance, fall risks, unsafe machinery, missing barriers, improper scaffolding, workers in danger zones, lifting operations, hazardous material handling).

2. **Fire safety** (blocked or missing exits, flammable materials near heat sources, visible smoke or fire, overloaded power strips, poor housekeeping, gas cylinders, fuel containers, missing fire extinguishers, faulty wiring).

3. **Property security** (unauthorized persons, suspicious behavior, open doors or windows, visible valuables, tampered locks, broken fences, tailgating at entrances, security camera blind spots, inadequate lighting).

When you respond:
- Be conservative and safety-sensitive
- Clearly call out critical risks if any
- Do not guess facts that are not visible
- If the image is not related to safety inspection (e.g., a random photo), still analyze what you can see for any potential safety implications
- Be professional and concise

Return your output STRICTLY as valid JSON with this exact structure (no markdown code fences, just raw JSON):
{
  "overallDescription": "short text describing what is in the image",
  "overallRiskLevel": "Low" | "Medium" | "High",
  "peopleCount": 0,
  "missingHardhats": 0,
  "missingVests": 0,
  "detections": [
    {
      "label": "person_ok" | "no_hardhat" | "no_vest" | "no_hardhat_no_vest" | "fire_smoke" | "smoking" | "machine_proximity" | "working_at_height" | "person_fallen" | "safety_hazard",
      "bbox": [y_min, x_min, y_max, x_max],
      "description": "brief note e.g. worker on scaffold without harness"
    }
  ],
  "constructionSafety": {
    "summary": "1–2 sentence summary",
    "issues": ["bullet point", "bullet point"],
    "recommendations": ["bullet point", "bullet point"]
  },
  "fireSafety": {
    "summary": "1–2 sentence summary",
    "issues": ["bullet point", "bullet point"],
    "recommendations": ["bullet point", "bullet point"]
  },
  "propertySecurity": {
    "summary": "1–2 sentence summary",
    "issues": ["bullet point", "bullet point"],
    "recommendations": ["bullet point", "bullet point"]
  }
}

**BOUNDING BOX INSTRUCTIONS:**
- Only add a PPE/person detection entry when PPE is CLEARLY VERIFIABLE for that person.
- If PPE is unclear, distant, blurred, blocked, or inside a cab, add NO person_ok / PPE bbox for that person.
- For each clearly verifiable person, label is "person_ok", "no_hardhat", "no_vest", or "no_hardhat_no_vest".
- Person/PPE boxes must be TIGHT around the actual worker only: from the visible top of the head/helmet to the feet or lowest visible body part, and from the left-most to right-most visible body edges.
- Do NOT include nearby machinery, poles, barriers, shadows, or empty surrounding space in a person/PPE box.
- For EACH hazard found in STEP 4 add one entry: label is "fire_smoke", "smoking", "machine_proximity", "working_at_height", "person_fallen", or "safety_hazard".
- "bbox" must be [y_min, x_min, y_max, x_max] with integer values 0–1000 (normalized image coordinates).
- Always include a brief "description" — especially for "safety_hazard" (explain what hazard was found).
- If nothing is visible, set "detections" to [].

**CRITICAL: Only identify missing PPE when visibility is sufficient:**

- "peopleCount": Count ALL people/workers visible in the image (including those in background, partial views, etc.)

- "missingHardhats": Count how many CLEARLY VISIBLE people are not wearing hardhats/helmets.
  * **EXAMINE EACH PERSON INDIVIDUALLY** - go through them one by one
  * **LOOK DIRECTLY AT THE TOP OF EACH PERSON'S HEAD** - focus on the crown/vertex area
  * **HARD HAT IDENTIFICATION:**
    - Hard hats have a DISTINCTIVE DOME or ROUNDED SHAPE (not flat)
    - Hard hats are RIGID and STRUCTURED (not soft fabric)
    - **⚠️ CRITICAL - WHITE HARD HATS ARE VALID: Hard hats come in MANY COLORS: WHITE, YELLOW, ORANGE, BLUE, RED, GREEN, and other colors. 
      **A WHITE HELMET/WHITE HARD HAT IS A VALID HARD HAT - IT IS NOT MISSING!**
      **WHITE HARD HATS ARE VERY COMMON ON CONSTRUCTION SITES - DO NOT MISTAKE THEM FOR MISSING HARD HATS!**
      **If you see a WHITE dome-shaped, rigid structure on someone's head with a brim, that IS a hard hat - count it as PRESENT!**
    - Hard hats have a VISIBLE BRIM or EDGE
    - The color does NOT determine if it's a hard hat - the SHAPE and STRUCTURE do (dome/rounded, rigid, with brim)
  * **IF YOU SEE ANY OF THESE, THE PERSON IS MISSING A HARD HAT:**
    - VISIBLE HAIR of any color (black, brown, gray, blonde, etc.)
    - VISIBLE SCALP or SKIN on the top of the head
    - A BASEBALL CAP, BEANIE, BANDANA, or any SOFT FABRIC covering
    - NO HEAD COVERING AT ALL (bare head visible)
    - The head shape is visible WITHOUT a hard hat structure
  * **CRITICAL RULES:**
    - If you CANNOT CLEARLY SEE the head well enough because the person is too small, far away, blurred, or blocked, DO NOT count them as missing
    - **⚠️ REMEMBER: A WHITE dome-shaped rigid structure with a brim IS A HARD HAT - DO NOT COUNT IT AS MISSING!**
    - **WHITE HARD HATS ARE COMMON AND VALID - IF YOU SEE A WHITE DOME-SHAPED RIGID STRUCTURE ON SOMEONE'S HEAD, THAT IS A HARD HAT!**
    - DO NOT assume - if there is genuine visibility doubt because the worker is too small, far away, blurred, or blocked, do NOT mark missing hard hat
    - A person with visible hair, a cap, or bare head = missing hard hat, REGARDLESS of other safety gear
    - Even if they're wearing a safety vest and boots, if no hard hat is visible on their head, they are missing a hard hat
  * **BE STRICT AND ACCURATE** - Missing hard hats is a serious safety violation

- "missingVests": Count how many CLEARLY VISIBLE people are not wearing safety vests/high-visibility vests.
  * **EXAMINE EACH PERSON INDIVIDUALLY** - go through them one by one
  * **LOOK AT EACH PERSON'S TORSO/UPPER BODY** - focus on their chest and torso area
  * **VEST IDENTIFICATION:**
    - Safety vests are BRIGHT COLORS (yellow, orange, lime green, fluorescent)
    - Safety vests are worn OVER other clothing (not under)
    - Safety vests often have REFLECTIVE STRIPES or BANDS
    - Safety vests are typically LOOSE-FITTING and VISIBLE
  * **IF YOU SEE ANY OF THESE, THE PERSON IS MISSING A VEST:**
    - Regular clothing (t-shirt, shirt, jacket) WITHOUT a bright vest over it
    - Dark or muted colors without a bright vest
    - Clothing that is NOT a high-visibility vest
    - If the torso is too small, far away, blurred, or blocked, DO NOT count as missing
  * **CRITICAL RULES:**
    - If you CANNOT CLEARLY SEE the torso well enough because the worker is too small, far away, blurred, or blocked, do NOT count as missing
    - DO NOT assume - if there is genuine visibility doubt, do NOT mark missing vest
    - A person with a hard hat but no vest = missing vest
    - A person with a vest but no hard hat = missing hard hat (counts in missingHardhats)
    - A person missing both = counts in both missingHardhats and missingVests
  * **BE STRICT AND ACCURATE** - Missing vests is a serious safety violation

**Be thorough and accurate:** Only make PPE judgements for clearly visible workers. A person wearing a hard hat but no vest counts as missing a vest. A person wearing a vest but no hard hat counts as missing a hard hat. If the image is a wide overview and PPE is not clear, set "missingHardhats" to 0 and "missingVests" to 0 and explicitly say PPE could not be reliably assessed.

If there is not enough information for a category, set issues and recommendations to empty arrays and explain in the summary that visibility is insufficient or the category is not applicable to this image.`;

/**
 * Get the safety analysis prompt for a specific language
 * @param language - The language code ('en' or 'zh-TW')
 * @returns The complete prompt with language instruction
 */
export function getSafetyAnalysisPrompt(language: SupportedLanguage = 'en'): string {
  const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS['en'];
  
  // For Chinese, put language instruction at the BEGINNING and END for emphasis
  if (language === 'zh-TW') {
    return `【重要！請用繁體中文回覆所有內容！】\n\n${BASE_SAFETY_PROMPT}\n\n【再次強調：${languageInstruction}】`;
  }
  
  return `${BASE_SAFETY_PROMPT}\n\n**IMPORTANT: ${languageInstruction}**`;
}

// Default export for backward compatibility
export const SAFETY_ANALYSIS_PROMPT = getSafetyAnalysisPrompt('en');

/**
 * Simplified alert-focused prompt for faster analysis
 * Returns only critical safety alerts
 */
const BASE_ALERT_PROMPT = `You are a safety inspector AI. Analyze this image and identify ONLY critical safety alerts.

**CRITICAL: Before identifying alerts, you MUST first count all people and identify missing PPE:**

**HARDHAT DETECTION - THIS IS CRITICAL:**
1. Count every person/worker visible in the image
2. For EACH person, you MUST carefully examine their HEAD area:
   - Look at the TOP of their head - is there a hard hat/helmet visible?
   - **⚠️ CRITICAL - WHITE HARD HATS ARE VALID: Hard hats come in MANY COLORS including WHITE, YELLOW, ORANGE, BLUE, RED, GREEN, and other colors. 
     **A WHITE HELMET/WHITE HARD HAT IS A VALID HARD HAT - IT IS NOT MISSING!**
     **WHITE HARD HATS ARE VERY COMMON ON CONSTRUCTION SITES - DO NOT MISTAKE THEM FOR MISSING HARD HATS!**
     **If you see a WHITE dome-shaped, rigid structure on someone's head with a brim, that IS a hard hat - recognize it as PRESENT, not missing!**
   - Hard hats have a distinctive rounded or dome shape and are RIGID (not soft fabric)
   - **A WHITE dome-shaped rigid structure with a brim = HARD HAT (NOT MISSING - IT IS PRESENT!)**
   - **The COLOR does NOT matter - white, yellow, orange, blue, etc. are all valid hard hat colors!**
   - If you see a person's head with HAIR, SKIN, or a CAP/BEANIE visible instead of a hard hat, they are MISSING a hard hat
   - If the person's head is visible but NO hard hat structure (dome/rounded, rigid) is present, they are MISSING a hard hat
   - DO NOT assume someone has a hard hat if you cannot clearly see one - if in doubt, count them as missing a hard hat
   - A person wearing a baseball cap, beanie, or no head protection is MISSING a hard hat
3. For each person, check if they are wearing a high-visibility safety vest (bright yellow, orange, or lime green vest worn over clothing)
4. Report the counts in the peopleCount, missingHardhats, and missingVests fields

Focus on:
1. **PPE violations**: Missing hardhats or safety vests
2. **Fire / smoke / smoking**: Visible flames, smoke, or someone smoking on site
3. **Machine-person danger**: Heavy machinery dangerously close to a worker
4. **Working at height**: Worker on ladder/scaffold/roof without harness or guardrail
5. **Person fallen**: Worker lying on ground in abnormal posture
6. **Other hazards**: Any other clearly visible safety risk (unsecured loads, electrical hazards, chemical spills, blocked exits, etc.)

Rules:
- Only report VISIBLE issues that pose real safety risks
- Categorize each alert as: construction, fire, or security
- Rate severity: low, medium, high, or critical
- Be concise — one sentence per alert
- If no significant alerts, return empty alerts array
- Fire/smoke/smoking → fire category; machine proximity/height/fallen/PPE → construction; unauthorized access → security

Return STRICT JSON (no markdown):
{
  "overallRiskLevel": "Low" | "Medium" | "High",
  "alertCount": 0,
  "peopleCount": 0,
  "missingHardhats": 0,
  "missingVests": 0,
  "detections": [
    {
      "label": "person_ok" | "no_hardhat" | "no_vest" | "no_hardhat_no_vest" | "fire_smoke" | "smoking" | "machine_proximity" | "working_at_height" | "person_fallen" | "safety_hazard",
      "bbox": [y_min, x_min, y_max, x_max],
      "description": "brief note"
    }
  ],
  "alerts": [
    {
      "category": "construction" | "fire" | "security",
      "severity": "low" | "medium" | "high" | "critical",
      "message": "Brief alert description"
    }
  ]
}

**BOUNDING BOX INSTRUCTIONS:**
- Only add a PPE/person detection entry when PPE is CLEARLY VERIFIABLE for that person.
- If PPE is unclear, distant, blurred, blocked, or inside a cab, add NO person_ok / PPE bbox for that person.
- For each clearly verifiable person: label is "person_ok", "no_hardhat", "no_vest", or "no_hardhat_no_vest".
- Person/PPE boxes must be TIGHT around the actual worker only: from the visible top of the head/helmet to the feet or lowest visible body part, and from the left-most to right-most visible body edges.
- Do NOT include nearby machinery, poles, barriers, shadows, or empty surrounding space in a person/PPE box.
- For fire/smoke area: label "fire_smoke". For a person smoking: label "smoking".
- For machine too close to person: label "machine_proximity" (box around both).
- For unsafe height work: label "working_at_height" (box around the worker).
- For fallen person: label "person_fallen" (box around them).
- For any other hazard: label "safety_hazard" with description explaining the risk.
- bbox: [y_min, x_min, y_max, x_max] integers 0–1000.
- If nothing found, set "detections" to [].

**CRITICAL: You MUST carefully count people and identify missing PPE:**

- "peopleCount": Count ALL people/workers visible in the image (including those in background, partial views, etc.)

- "missingHardhats": **THIS IS THE MOST CRITICAL FIELD - BE EXTREMELY THOROUGH** - Count how many people are NOT wearing hardhats/helmets. 
  * **EXAMINE EACH PERSON INDIVIDUALLY** - go through them one by one
  * **LOOK DIRECTLY AT THE TOP OF EACH PERSON'S HEAD** - focus on the crown/vertex area
  * **HARD HAT IDENTIFICATION:**
    - Hard hats have a DISTINCTIVE DOME or ROUNDED SHAPE (not flat)
    - Hard hats are RIGID and STRUCTURED (not soft fabric)
    - **⚠️ CRITICAL - WHITE HARD HATS ARE VALID: Hard hats come in MANY COLORS: WHITE, YELLOW, ORANGE, BLUE, RED, GREEN, and other colors. 
      **A WHITE HELMET/WHITE HARD HAT IS A VALID HARD HAT - IT IS NOT MISSING!**
      **WHITE HARD HATS ARE VERY COMMON ON CONSTRUCTION SITES - DO NOT MISTAKE THEM FOR MISSING HARD HATS!**
      **If you see a WHITE dome-shaped, rigid structure on someone's head with a brim, that IS a hard hat - count it as PRESENT!**
    - Hard hats have a VISIBLE BRIM or EDGE
    - The color does NOT determine if it's a hard hat - the SHAPE and STRUCTURE do (dome/rounded, rigid, with brim)
  * **IF YOU SEE ANY OF THESE, THE PERSON IS MISSING A HARD HAT:**
    - VISIBLE HAIR of any color (black, brown, gray, blonde, etc.)
    - VISIBLE SCALP or SKIN on the top of the head
    - A BASEBALL CAP, BEANIE, BANDANA, or any SOFT FABRIC covering
    - NO HEAD COVERING AT ALL (bare head visible)
    - The head shape is visible WITHOUT a hard hat structure
  * **CRITICAL RULES:**
    - If you CANNOT CLEARLY SEE a hard hat structure (dome shape, rigid material with brim), count them as MISSING a hard hat
    - **⚠️ REMEMBER: A WHITE dome-shaped rigid structure with a brim IS A HARD HAT - DO NOT COUNT IT AS MISSING!**
    - **WHITE HARD HATS ARE COMMON AND VALID - IF YOU SEE A WHITE DOME-SHAPED RIGID STRUCTURE ON SOMEONE'S HEAD, THAT IS A HARD HAT!**
    - DO NOT assume - if there's ANY doubt about the structure (not the color), they are MISSING a hard hat
    - A person with visible hair, a cap, or bare head = missing hard hat, REGARDLESS of other safety gear
    - Even if they're wearing a safety vest and boots, if no hard hat is visible on their head, they are missing a hard hat
  * **BE STRICT AND ACCURATE** - Missing hard hats is a serious safety violation

- "missingVests": **BE EXTREMELY THOROUGH** - Count how many people are NOT wearing safety vests/high-visibility vests.
  * **EXAMINE EACH PERSON INDIVIDUALLY** - go through them one by one
  * **LOOK AT EACH PERSON'S TORSO/UPPER BODY** - focus on their chest and torso area
  * **VEST IDENTIFICATION:**
    - Safety vests are BRIGHT COLORS (yellow, orange, lime green, fluorescent)
    - Safety vests are worn OVER other clothing (not under)
    - Safety vests often have REFLECTIVE STRIPES or BANDS
    - Safety vests are typically LOOSE-FITTING and VISIBLE
  * **IF YOU SEE ANY OF THESE, THE PERSON IS MISSING A VEST:**
    - Regular clothing (t-shirt, shirt, jacket) WITHOUT a bright vest over it
    - Dark or muted colors without a bright vest
    - Clothing that is NOT a high-visibility vest
    - UNCLEAR or CANNOT SEE clearly = MISSING VEST (when in doubt, count as missing)
  * **CRITICAL RULES:**
    - If you CANNOT CLEARLY SEE a bright vest worn over clothing, count them as MISSING a vest
    - DO NOT assume - if there's ANY doubt, they are MISSING a vest
    - A person with a hard hat but no vest = missing vest
    - A person with a vest but no hard hat = missing hard hat (counts in missingHardhats)
    - A person missing both = counts in both missingHardhats and missingVests
  * **BE STRICT AND ACCURATE** - Missing vests is a serious safety violation

**Be thorough and accurate:** Examine each person individually. A person wearing a hard hat but no vest counts as missing a vest. A person wearing a vest but no hard hat counts as missing a hard hat. If you see a worker's head clearly and there's no hard hat visible, you MUST count them in missingHardhats. If no people are visible, set all three to 0.`;

/**
 * Get the alert analysis prompt for a specific language
 * @param language - The language code ('en' or 'zh-TW')
 * @returns The complete alert prompt with language instruction
 */
export function getAlertAnalysisPrompt(language: SupportedLanguage = 'en'): string {
  const languageInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS['en'];
  
  if (language === 'zh-TW') {
    return `【重要！請用繁體中文回覆所有內容！】\n\n${BASE_ALERT_PROMPT}\n\n【再次強調：${languageInstruction}】`;
  }
  
  return `${BASE_ALERT_PROMPT}\n\n**IMPORTANT: ${languageInstruction}**`;
}
