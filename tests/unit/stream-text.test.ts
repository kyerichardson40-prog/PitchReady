import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextSpeakableEnd, speakableChunks, utteranceSoFar } from '../../lib/ai/stream-text.ts';

test('utterance is read out of partial JSON, including escapes split across pieces', () => {
  assert.equal(utteranceSoFar(''), '');
  assert.equal(utteranceSoFar('{"utter'), '');
  assert.equal(utteranceSoFar('{"utterance": "Hello the'), 'Hello the');
  assert.equal(utteranceSoFar('{"utterance":"Say \\"hi\\" and'), 'Say "hi" and');
  assert.equal(utteranceSoFar('{"utterance":"I\\'), 'I', 'escape not finished yet');
  assert.equal(utteranceSoFar('{"utterance":"It\\u2019s'), 'It’s');
  assert.equal(utteranceSoFar('{"utterance":"It\\u20'), 'It', 'unicode escape not finished yet');
  assert.equal(utteranceSoFar('{"utterance":"Done.","endConversation":false'), 'Done.');
});

test('sentences are sent for speech as soon as they finish; later ones in bigger pieces', () => {
  const t = 'Hmm. Go on then, what is it? I have got about two minutes before I need to leave. ';
  const first = nextSpeakableEnd(t, 0, true)!;
  assert.equal(t.slice(0, first), 'Hmm. ');
  const second = nextSpeakableEnd(t, first, false)!;
  assert.equal(t.slice(first, second).trim(), 'Go on then, what is it? I have got about two minutes before I need to leave.');
  assert.equal(nextSpeakableEnd('No full stop yet', 0, true), null);
  assert.equal(nextSpeakableEnd('Ends with a stop.', 0, true), null, 'the last sentence waits for the end of the reply');
  assert.deepEqual(speakableChunks('Right. I see what you mean, but I’m still not sure. Can you tell me more?'), ['Right.', 'I see what you mean, but I’m still not sure.', 'Can you tell me more?']);
  assert.deepEqual(speakableChunks('Just one line'), ['Just one line']);
});
