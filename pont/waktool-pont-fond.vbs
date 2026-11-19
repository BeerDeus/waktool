' Waktool - lance le pont du journal Wakfu en arrière-plan, sans fenêtre (PC perso).
' À placer dans le même dossier que waktool-pont.cmd (le pont lui-même, inchangé).
' Au premier lancement, propose de démarrer automatiquement à chaque ouverture de session
' (raccourci dans le dossier Démarrage de Windows, qui remplace l'ancien lancement avec fenêtre).
' Pour l'arrêter : double-clic sur waktool-pont-arreter.cmd (même dossier).
Option Explicit
Dim fso, sh, q, dir, pont, startup, lnkPath, flagDir, flag, auto, lnk, old
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
q = Chr(34)
dir = fso.GetParentFolderName(WScript.ScriptFullName)
pont = dir & "\waktool-pont.cmd"
startup = sh.SpecialFolders("Startup")
lnkPath = startup & "\Waktool pont (arriere-plan).lnk"
flagDir = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Waktool"
flag = flagDir & "\fond-demarrage.txt"
auto = (WScript.Arguments.Count > 0)   ' lancé par le raccourci de démarrage : aucun message

' le lanceur ne doit pas être dans le dossier Démarrage : il y retire waktool-pont.cmd (ancien lancement avec fenêtre)
If LCase(dir) = LCase(startup) Then
  MsgBox "Ne mets pas ce fichier dans le dossier Démarrage de Windows." & vbCrLf & vbCrLf & _
    "Mets waktool-pont-fond.vbs, waktool-pont-arreter.cmd et une copie de waktool-pont.cmd dans un dossier à toi " & _
    "(ex. Documents\Waktool), puis double-clique le .vbs : il s'ajoutera lui-même au démarrage.", vbExclamation, "Waktool"
  WScript.Quit 1
End If
If Not fso.FileExists(pont) Then
  MsgBox "waktool-pont.cmd est introuvable dans :" & vbCrLf & dir & vbCrLf & vbCrLf & _
    "Mets waktool-pont-fond.vbs et waktool-pont.cmd dans le même dossier.", vbExclamation, "Waktool"
  WScript.Quit 1
End If

' démarrage automatique : proposé une seule fois
If Not auto And Not fso.FileExists(lnkPath) And Not fso.FileExists(flag) Then
  If Not fso.FolderExists(flagDir) Then fso.CreateFolder flagDir
  If MsgBox("Lancer le pont Waktool automatiquement, sans fenêtre, à chaque démarrage de Windows ?", _
      vbYesNo + vbQuestion, "Waktool") = vbYes Then
    Set lnk = sh.CreateShortcut(lnkPath)
    lnk.TargetPath = sh.ExpandEnvironmentStrings("%WINDIR%") & "\System32\wscript.exe"
    lnk.Arguments = q & WScript.ScriptFullName & q & " /demarrage"
    lnk.WorkingDirectory = dir
    lnk.Description = "Waktool - pont du journal Wakfu, sans fenêtre"
    lnk.Save
    ' ancien lancement avec fenêtre : retiré (il prendrait la place du pont caché)
    old = startup & "\waktool-pont.cmd"
    If fso.FileExists(old) Then fso.DeleteFile old
    fso.CreateTextFile(flag, True).WriteLine "oui"
  Else
    fso.CreateTextFile(flag, True).WriteLine "non"
  End If
End If

' lancement caché (0 = aucune fenêtre) ; WAKTOOL_SILENT : le pont ne pose aucune question
sh.Environment("Process")("WAKTOOL_SILENT") = "1"
sh.Run "cmd /c " & q & q & pont & q & q, 0, False
If Not auto Then sh.Popup "Pont Waktool lancé en arrière-plan." & vbCrLf & "Pour l'arrêter : waktool-pont-arreter.cmd", 3, "Waktool", vbInformation
