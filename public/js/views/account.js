import { api } from '../api.js';
import { h, pageHeader } from '../ui.js';
import { statement, defaultPeriod } from './customers.js';

export async function renderAccount(page) {
  const period = defaultPeriod();
  const load = async () => {
    const acc = await api.get(`/me/account?from=${period.from}&to=${period.to}`);
    page.replaceChildren(
      pageHeader(acc.customer.name, 'Votre espace client'),
      statement(acc, period, (p) => {
        Object.assign(period, p);
        load();
      }),
      h('p', { class: 'muted small section' }, 'Une question sur votre compte ? Adressez-vous au gérant de la station.'),
    );
  };
  await load();
}
