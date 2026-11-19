import assert from 'node:assert/strict';
import { chemistryCatalog, simulateReaction } from '../src/chemistry-engine.js';

const catalog = chemistryCatalog();
assert.equal(catalog.supportedReactionCount, 5);
assert.equal(catalog.missions.length, 4);
assert.ok(catalog.productOptions.length >= 5);

const markovnikov = simulateReaction({ substrateId: 'propene', reagentId: 'hbr', conditionId: 'standard' });
assert.equal(markovnikov.verified, true);
assert.equal(markovnikov.product.name, '2-Bromopropane');

const correctPrediction = simulateReaction({ substrateId: 'propene', reagentId: 'hbr', conditionId: 'standard', predictedProductId: '2-bromopropane', confidence: 85 });
assert.equal(correctPrediction.prediction.correct, true);
assert.equal(correctPrediction.prediction.confidence, 85);

const correctedPrediction = simulateReaction({ substrateId: 'propene', reagentId: 'hbr', conditionId: 'standard', predictedProductId: '1-bromopropane', confidence: 120, hintUsed: true });
assert.equal(correctedPrediction.prediction.correct, false);
assert.equal(correctedPrediction.prediction.confidence, 100);
assert.equal(correctedPrediction.prediction.hintUsed, true);

const radical = simulateReaction({ substrateId: 'propene', reagentId: 'hbr', conditionId: 'peroxide' });
assert.equal(radical.product.name, '1-Bromopropane');

const sn2 = simulateReaction({ substrateId: '1-bromopropane', reagentId: 'hydroxide', conditionId: 'standard' });
assert.match(sn2.reactionClass, /SN2/);
assert.equal(sn2.product.name, 'Propan-1-ol');

const sn1 = simulateReaction({ substrateId: 'tert-butyl-bromide', reagentId: 'water', conditionId: 'standard' });
assert.match(sn1.reactionClass, /SN1/);
assert.equal(sn1.product.name, 'tert-Butanol');

const unsupported = simulateReaction({ substrateId: 'ethene', reagentId: 'water', conditionId: 'standard' });
assert.equal(unsupported.verified, false);
assert.match(unsupported.error, /will not guess/i);

console.log(JSON.stringify({ ok: true, supportedReactionCount: catalog.supportedReactionCount }));
