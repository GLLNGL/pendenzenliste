// Diktierten Text an bestehenden Text anhaengen (mit Leerzeichen, erster Buchstabe gross).
function textAnhaengen(bisher, neu) {
  const satz = neu.charAt(0).toUpperCase() + neu.slice(1);
  if (!bisher || !bisher.trim()) return satz;
  return `${bisher.replace(/\s+$/, '')} ${satz}`;
}

export { textAnhaengen };
