import { PRIORITAET_BESCHREIBUNG } from '../constants.js';

const KLASSE = { A: 'badge-a', B: 'badge-b', C: 'badge-c' };

export default function Badge({ prioritaet }) {
  return (
    <span className={`badge ${KLASSE[prioritaet] || 'badge-c'}`} title={PRIORITAET_BESCHREIBUNG[prioritaet]}>
      {prioritaet}
    </span>
  );
}
