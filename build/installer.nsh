; Доработка установщика Plus Launcher:
;  1) перед установкой начисто сносим предыдущую версию, чтобы файлы не смешивались;
;  2) при удалении спрашиваем галочкой, убирать ли скачанные версии, моды и миры.
;
; Наш файл подключается раньше библиотек NSIS, поэтому берём их явно
; (внутри они защищены от повторного подключения).

!include LogicLib.nsh
!include nsDialogs.nsh

; Удалением предыдущей версии занимается сам electron-builder: перед распаковкой он
; запускает старый деинсталлятор молча и с сохранением файлов игры. Своя реализация тут
; только мешала бы — UninstallString в реестре хранится вместе с аргументами.

; ---------- удаление: страница с галочкой ----------
; Весь код деинсталлятора собирается отдельным проходом: переменные и функции
; должны существовать только в нём, иначе makensis ругается на неиспользуемые.
!ifdef BUILD_UNINSTALLER

Var UnDataDir
Var UnCheckbox
Var UnDeleteData

Function un.plusDataPageCreate
  ; при обновлении деинсталлятор запускается молча (/S) — NSIS сам пропускает страницы,
  ; поэтому вопрос задаётся только при обычном удалении через «Программы и компоненты»

  ; где лежат файлы игры — лаунчер записывает путь в реестр при каждом запуске
  ReadRegStr $UnDataDir HKCU "Software\Plus Launcher" "DataDir"
  ${If} $UnDataDir == ""
    StrCpy $UnDataDir "$APPDATA\.plslauncher"
  ${EndIf}
  ${IfNot} ${FileExists} "$UnDataDir\*.*"
    StrCpy $UnDeleteData "0"
    Abort
  ${EndIf}

  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 34u "Версии Minecraft, моды, миры и настройки хранятся отдельно от программы:$\r$\n$UnDataDir"
  Pop $1

  ${NSD_CreateCheckbox} 0 44u 100% 12u "Удалить также версии, моды и миры"
  Pop $UnCheckbox

  ${NSD_CreateLabel} 0 62u 100% 26u "Без галочки файлы останутся на диске и подхватятся при следующей установке лаунчера."
  Pop $1

  nsDialogs::Show
FunctionEnd

Function un.plusDataPageLeave
  ${NSD_GetState} $UnCheckbox $0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $UnDeleteData "1"
  ${Else}
    StrCpy $UnDeleteData "0"
  ${EndIf}
FunctionEnd

!endif

!macro customUnWelcomePage
  UninstPage custom un.plusDataPageCreate un.plusDataPageLeave
!macroend

!macro customUnInstall
  ${If} $UnDeleteData == "1"
    ${If} $UnDataDir != ""
      DetailPrint "Удаляю файлы игры: $UnDataDir"
      RMDir /r "$UnDataDir"
    ${EndIf}
    RMDir /r "$APPDATA\PlusLauncher"
    DeleteRegKey HKCU "Software\Plus Launcher"
  ${EndIf}
!macroend
