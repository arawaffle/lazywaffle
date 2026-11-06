import { html, render } from './lib.js';
import { initStore } from './store.js';
import { App } from './components/App.js';
import './focus.js';

initStore().then(() => {
  render(html`<${App} />`, document.getElementById('root'));
});
