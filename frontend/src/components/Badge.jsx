const KLASSE = { Hoch: 'badge-hoch', Mittel: 'badge-mittel', Tief: 'badge-tief' };

export default function Badge({ prioritaet }) {
  return <span className={`badge ${KLASSE[prioritaet] || 'badge-tief'}`}>{prioritaet}</span>;
}
