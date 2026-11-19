const substrates = [
  { id: 'propene', name: 'Propene', formula: 'CH₃–CH=CH₂', family: 'Alkene' },
  { id: 'ethene', name: 'Ethene', formula: 'CH₂=CH₂', family: 'Alkene' },
  { id: '1-bromopropane', name: '1-Bromopropane', formula: 'CH₃–CH₂–CH₂Br', family: 'Primary haloalkane' },
  { id: 'tert-butyl-bromide', name: 'tert-Butyl bromide', formula: '(CH₃)₃C–Br', family: 'Tertiary haloalkane' },
];

const productOptions = [
  { id: '2-bromopropane', name: '2-Bromopropane', formula: 'CH₃–CH(Br)–CH₃' },
  { id: '1-bromopropane', name: '1-Bromopropane', formula: 'CH₃–CH₂–CH₂Br' },
  { id: '1-2-dibromoethane', name: '1,2-Dibromoethane', formula: 'BrCH₂–CH₂Br' },
  { id: 'propan-1-ol', name: 'Propan-1-ol', formula: 'CH₃–CH₂–CH₂OH' },
  { id: 'tert-butanol', name: 'tert-Butanol', formula: '(CH₃)₃C–OH' },
  { id: 'propane', name: 'Propane', formula: 'CH₃–CH₂–CH₃' },
];

const reagents = [
  { id: 'hbr', name: 'Hydrogen bromide', formula: 'HBr' },
  { id: 'br2', name: 'Bromine', formula: 'Br₂' },
  { id: 'hydroxide', name: 'Aqueous hydroxide', formula: 'OH⁻ (aq)' },
  { id: 'water', name: 'Water', formula: 'H₂O' },
];

const conditions = [
  { id: 'standard', name: 'Standard conditions', note: 'No radical initiator' },
  { id: 'peroxide', name: 'Peroxide present', note: 'Radical conditions; supported here only for HBr addition' },
];

const rules = {
  'propene|hbr|standard': {
    product: productOptions[0],
    reactionClass: 'Electrophilic addition · Markovnikov',
    concept: 'Markovnikov electrophilic addition',
    clue: 'Compare the stability of the two carbocations that protonation could create.',
    mechanism: ['The π bond is protonated.', 'The more stable secondary carbocation forms.', 'Bromide attacks the planar carbocation.'],
    explanation: 'Bromine ends up on carbon 2 because that pathway passes through the more stable secondary carbocation.',
  },
  'propene|hbr|peroxide': {
    product: productOptions[1],
    reactionClass: 'Radical addition · anti-Markovnikov',
    concept: 'Radical anti-Markovnikov addition',
    clue: 'Peroxide changes the pathway from an ionic mechanism to a radical chain.',
    mechanism: ['Peroxide initiates a radical chain.', 'A bromine radical adds to give the more stable secondary carbon radical.', 'The carbon radical abstracts hydrogen from HBr.'],
    explanation: 'Under peroxide conditions, HBr follows a radical chain and bromine attaches to the terminal carbon. This peroxide effect is characteristic of HBr, not a general rule for all hydrogen halides.',
  },
  'ethene|br2|standard': {
    product: productOptions[2],
    reactionClass: 'Halogenation · electrophilic addition',
    concept: 'Alkene halogenation',
    clue: 'The alkene consumes the Br–Br bond and each alkene carbon gains bromine.',
    mechanism: ['The alkene polarizes Br₂.', 'A three-membered bromonium ion forms.', 'Bromide opens the bromonium ion from the opposite side.'],
    explanation: 'Each alkene carbon gains one bromine. Ethene is symmetric, so only one constitutional product is formed.',
  },
  '1-bromopropane|hydroxide|standard': {
    product: productOptions[3],
    reactionClass: 'SN2 nucleophilic substitution',
    concept: 'SN2 nucleophilic substitution',
    clue: 'A primary carbon is accessible to a single backside displacement.',
    mechanism: ['Hydroxide approaches the carbon bearing bromine from the back.', 'C–O bond formation and C–Br bond breaking occur together.', 'Bromide leaves in the same concerted step.'],
    explanation: 'The primary carbon is accessible to backside attack, so aqueous hydroxide substitutes bromide by an SN2 pathway.',
  },
  'tert-butyl-bromide|water|standard': {
    product: productOptions[4],
    reactionClass: 'SN1 solvolysis',
    concept: 'SN1 solvolysis',
    clue: 'Ask whether the substrate can form a stable carbocation before water attacks.',
    mechanism: ['The C–Br bond ionizes to a tertiary carbocation.', 'Water attacks the planar carbocation.', 'Deprotonation gives the neutral alcohol.'],
    explanation: 'The tertiary carbocation is sufficiently stabilized for the stepwise SN1 pathway; steric crowding also disfavors SN2 attack.',
  },
};

const missions = [
  { id: 'markovnikov', title: 'Regiochemistry challenge', objective: 'Predict where bromine attaches during ionic HBr addition.', hint: 'Compare the stability of the two possible carbocation intermediates.', substrateId: 'propene', reagentId: 'hbr', conditionId: 'standard', difficulty: 2 },
  { id: 'radical-switch', title: 'Condition switch', objective: 'See how peroxide changes the product and mechanism.', hint: 'Peroxide signals a radical chain rather than the ordinary ionic pathway.', substrateId: 'propene', reagentId: 'hbr', conditionId: 'peroxide', difficulty: 3 },
  { id: 'sn2', title: 'Backside attack', objective: 'Predict the product of a primary haloalkane with hydroxide.', hint: 'A primary carbon leaves room for a concerted backside displacement.', substrateId: '1-bromopropane', reagentId: 'hydroxide', conditionId: 'standard', difficulty: 2 },
  { id: 'sn1', title: 'Carbocation pathway', objective: 'Predict the solvolysis product of a tertiary haloalkane.', hint: 'A tertiary substrate can ionize into a comparatively stable carbocation.', substrateId: 'tert-butyl-bromide', reagentId: 'water', conditionId: 'standard', difficulty: 3 },
];

export function chemistryCatalog() {
  return { substrates, reagents, conditions, productOptions, missions, supportedReactionCount: Object.keys(rules).length };
}

export function simulateReaction({ substrateId, reagentId, conditionId = 'standard', predictedProductId = null, confidence = null, hintUsed = false } = {}) {
  const substrate = substrates.find(item => item.id === substrateId);
  const reagent = reagents.find(item => item.id === reagentId);
  const condition = conditions.find(item => item.id === conditionId);
  if (!substrate || !reagent || !condition) return { verified: false, error: 'Choose a valid substrate, reagent, and condition.' };
  const rule = rules[[substrateId, reagentId, conditionId].join('|')];
  if (!rule) return {
    verified: false,
    substrate, reagent, condition,
    error: 'This combination is outside the verified teaching library. QuizKatalyst will not guess a product.',
  };
  const submittedProduct = predictedProductId ? productOptions.find(item => item.id === predictedProductId) || null : null;
  const numericConfidence = Number.isFinite(Number(confidence)) ? Math.max(0, Math.min(100, Number(confidence))) : null;
  const prediction = submittedProduct ? {
    submittedProduct,
    correct: submittedProduct.id === rule.product.id,
    confidence: numericConfidence,
    hintUsed: Boolean(hintUsed),
  } : null;
  return { verified: true, substrate, reagent, condition, ...rule, prediction, engine: 'QuizKatalyst curated reaction rules v2' };
}

