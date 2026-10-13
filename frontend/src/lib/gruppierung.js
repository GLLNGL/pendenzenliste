// Gruppiert eine (bereits sortierte) flache Pendenzen-Liste nach Mandant, ohne die
// urspruengliche Reihenfolge innerhalb einer Gruppe zu veraendern -- die Reihenfolge der
// Gruppen selbst entspricht dem ersten Vorkommen eines Mandanten in der Eingabeliste (so
// erscheint z.B. im Cockpit der Mandant mit der dringendsten Pendenz zuerst). Pendenzen ohne
// Mandant (interne Pendenzen) landen immer in einer eigenen Gruppe am Ende.
function gruppiereNachMandant(pendenzen) {
  const gruppenNachId = new Map();
  const reihenfolge = [];

  for (const p of pendenzen) {
    const id = p.mandant_id ?? null;
    let gruppe = gruppenNachId.get(id);
    if (!gruppe) {
      gruppe = { mandantId: id, mandantName: p.mandant_name || null, mandantKuerzel: p.mandant_kuerzel || null, items: [] };
      gruppenNachId.set(id, gruppe);
      reihenfolge.push(id);
    }
    gruppe.items.push(p);
  }

  const ohneMandant = reihenfolge.filter((id) => id === null);
  const mitMandant = reihenfolge.filter((id) => id !== null);
  return [...mitMandant, ...ohneMandant].map((id) => gruppenNachId.get(id));
}

export { gruppiereNachMandant };
