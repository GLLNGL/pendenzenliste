' Startet die Pendenzenliste im Hintergrund und oeffnet sie als eigenstaendiges Fenster.
' Dieses Skript bleibt an seinem Ort liegen -- fuer den Desktop erstellst du eine
' VERKNUEPFUNG (Rechtsklick -> Senden an -> Desktop), nicht eine Kopie der Datei.

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

skriptOrdner = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.CurrentDirectory = skriptOrdner & "\backend"

' Server im Hintergrund starten (kein sichtbares Konsolenfenster)
WshShell.Run "cmd /c npm start", 0, False

' Kurz warten, bis der Server bereit ist
WScript.Sleep 5000

' Edge im App-Modus oeffnen: eigenes Fenster ohne Tabs/Adressleiste, mit dem
' Pendenzen-Icon in der Taskleiste. Faellt auf den Standardbrowser zurueck,
' falls Edge nicht gefunden wird.
edge1 = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
edge2 = "C:\Program Files\Microsoft\Edge\Application\msedge.exe"

If fso.FileExists(edge1) Then
  WshShell.Run """" & edge1 & """ --app=http://localhost:3001 --window-size=1280,900", 1, False
ElseIf fso.FileExists(edge2) Then
  WshShell.Run """" & edge2 & """ --app=http://localhost:3001 --window-size=1280,900", 1, False
Else
  WshShell.Run "http://localhost:3001"
End If
