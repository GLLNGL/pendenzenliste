// Ablage pro Mandant (v7): Grundordner einmal in den Einstellungen (Windows-Pfad und
// SharePoint-Adresse), pro Mandant nur der Ordnername. Ein beim Mandanten eingetragener voller
// Pfad/Link (ablage_pfad/ablage_link) geht als Abweichung vor.

function segmente(ordner) {
  return String(ordner ?? '').split(/[\\/]+/).map((s) => s.trim()).filter(Boolean);
}

// Ordner des Mandanten relativ zum Grundordner (als Liste von Unterordnern) -- fuer das direkte
// Ablegen in den lokal synchronisierten OneDrive-Ordner. null = nicht bestimmbar.
function relativerOrdner(mandant, grund = {}) {
  if (!mandant) return null;
  if (mandant.ablage_ordner?.trim()) return segmente(mandant.ablage_ordner);
  const basis = String(grund.grundPfad ?? '').replace(/[\\/]+$/, '').toLowerCase();
  const voll = String(mandant.ablage_pfad ?? '');
  if (basis && voll.toLowerCase().startsWith(`${basis}\\`)) return segmente(voll.slice(basis.length + 1));
  return null;
}

// SharePoint-Adresse des Unterordners: bei Ansichts-Links (…/AllItems.aspx?id=/sites/…) wird der
// Ordner an den Parameter "id" gehaengt, sonst an den Pfad.
function linkMitOrdner(grundLink, teile) {
  if (!grundLink || !teile.length) return null;
  try {
    const url = new URL(grundLink);
    const id = url.searchParams.get('id');
    if (id) {
      url.searchParams.set('id', `${id.replace(/\/+$/, '')}/${teile.join('/')}`);
      return url.toString();
    }
    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${teile.map(encodeURIComponent).join('/')}`;
    return url.toString();
  } catch {
    return null;
  }
}

// Wirksame Ablage eines Mandanten: { pfad, link, ordner } (Teile fehlen = null).
function ablageVon(mandant, grund = {}) {
  if (!mandant) return { pfad: null, link: null, ordner: null };
  const teile = mandant.ablage_ordner?.trim() ? segmente(mandant.ablage_ordner) : [];
  const basisPfad = String(grund.grundPfad ?? '').trim().replace(/[\\/]+$/, '');
  const pfad = mandant.ablage_pfad || (basisPfad && teile.length ? `${basisPfad}\\${teile.join('\\')}` : null);
  const link = mandant.ablage_link || linkMitOrdner(String(grund.grundLink ?? '').trim(), teile);
  return { pfad, link, ordner: relativerOrdner(mandant, grund) };
}

// Vorschlag fuer den Ordnernamen eines neuen Mandanten.
function ordnerVorschlag(name) {
  return String(name ?? '').replace(/[<>:"/\\|?*]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export { ablageVon, relativerOrdner, linkMitOrdner, ordnerVorschlag, segmente };
