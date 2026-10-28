// A Web Worker around the JSON contract (new Worker(new URL('./worker.js', import.meta.url), {type: 'module'})), so the slower
// calls (conquest.prep, the in-game modes) never block the page.
//   postMessage({id, init: {weights, field}})   -> {id, ok: true, cards}
//   postMessage({id, request})                  -> {id, response}   (the response of api.handle)
import { loadModel } from './matchup.js?v=aa3c01bc6a';
import { handle } from './api.js?v=aa3c01bc6a';

let model = null;
let field = null;

self.onmessage = (event) => {
  const { id, init, request } = event.data || {};
  if (init) {
    model = loadModel(init.weights);
    field = init.field && init.field.decks ? init.field.decks : init.field || [];
    self.postMessage({ id, ok: true, cards: model.cards.length });
    return;
  }
  if (!model) {
    self.postMessage({ id, response: { ok: false, kind: request && request.kind, error: 'the worker has no model yet (send init first)' } });
    return;
  }
  self.postMessage({ id, response: handle(model, field, request) });
};
