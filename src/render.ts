import { sessionValid, state } from './state.js';
import { setBackAction } from './nav.js';
import { showLogin } from './screens/login.js';
import { renderForm, formBack } from './screens/form.js';
import { renderPanel, panelBack } from './screens/panel.js';
import { renderMsg, msgBack } from './screens/messages.js';
import { renderImport, importBack } from './screens/import.js';
import { renderList } from './screens/list.js';
import { renderCustomers, customersBack } from './screens/customers.js';

export const app = document.getElementById('app') as HTMLElement;

export function render() {
  if (!sessionValid()) { setBackAction(null); return showLogin(); }
  if (state.view === 'form')      { setBackAction(formBack);      return renderForm(); }
  if (state.view === 'panel')     { setBackAction(panelBack);     return renderPanel(); }
  if (state.view === 'msg')       { setBackAction(msgBack);       return renderMsg(); }
  if (state.view === 'import')    { setBackAction(importBack);    return renderImport(); }
  if (state.view === 'customers') { setBackAction(customersBack); return renderCustomers(); }
  setBackAction(null);   // home screen: nothing to go back to inside the app
  return renderList();
}
