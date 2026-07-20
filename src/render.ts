import { sessionValid, state } from './state.js';
import { showLogin } from './screens/login.js';
import { renderForm } from './screens/form.js';
import { renderPanel } from './screens/panel.js';
import { renderMsg } from './screens/messages.js';
import { renderImport } from './screens/import.js';
import { renderList } from './screens/list.js';

export const app = document.getElementById('app') as HTMLElement;

export function render() {
  if (!sessionValid()) return showLogin();
  if (state.view === 'form') return renderForm();
  if (state.view === 'panel') return renderPanel();
  if (state.view === 'msg') return renderMsg();
  if (state.view === 'import') return renderImport();
  return renderList();
}
