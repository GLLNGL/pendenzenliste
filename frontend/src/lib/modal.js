// Klick auf den grauen Hintergrund schliesst ein Fenster -- aber nur, wenn der Klick auch dort
// begonnen hat. Wer im Fenster Text markiert oder es am Rand aufzieht und die Maus ausserhalb
// loslaesst, erzeugt sonst einen "Klick" auf den Hintergrund und das Fenster ginge zu.
function hintergrundSchliessen(onSchliessen) {
  return {
    onMouseDown: (e) => { e.currentTarget.dataset.klickStart = e.target === e.currentTarget ? '1' : ''; },
    onClick: (e) => {
      const begonnen = e.currentTarget.dataset.klickStart === '1';
      e.currentTarget.dataset.klickStart = '';
      if (e.target === e.currentTarget && begonnen) onSchliessen?.();
    },
  };
}

export { hintergrundSchliessen };
