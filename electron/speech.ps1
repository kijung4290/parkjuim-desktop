param([ValidateSet('listen', 'speak', 'dictate', 'probe')][string]$Mode)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
function Send-VoiceEvent($Value) { [Console]::WriteLine(($Value | ConvertTo-Json -Compress)); [Console]::Out.Flush() }
try {
  if ($Mode -eq 'dictate') {
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class ParkVoiceKeys { [DllImport("user32.dll")] public static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra); }'
    Start-Sleep -Milliseconds 150
    try {
      [ParkVoiceKeys]::keybd_event(0x5B,0,0,[UIntPtr]::Zero)
      [ParkVoiceKeys]::keybd_event(0x48,0,0,[UIntPtr]::Zero)
    } finally {
      [ParkVoiceKeys]::keybd_event(0x48,0,2,[UIntPtr]::Zero)
      [ParkVoiceKeys]::keybd_event(0x5B,0,2,[UIntPtr]::Zero)
    }
    exit 0
  }
  Add-Type -AssemblyName System.Speech
  if ($Mode -eq 'probe') {
    $probeSpeaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $koreanVoice = @($probeSpeaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ko-KR' }).Count -gt 0
    $koreanRecognition = @([System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'ko-KR' }).Count -gt 0
    Send-VoiceEvent @{type='capabilities';koreanVoice=$koreanVoice;koreanRecognition=$koreanRecognition}
    $probeSpeaker.Dispose()
    exit 0
  }
  if ($Mode -eq 'speak') {
    $text = [Console]::In.ReadToEnd()
    $speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $voice = $speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -eq 'ko-KR' } | Select-Object -First 1
    if (-not $voice) { throw 'KOREAN_VOICE_MISSING' }
    $speaker.SelectVoice($voice.VoiceInfo.Name)
    $speaker.Rate = 0
    $speaker.Speak($text)
    $speaker.Dispose()
  } else {
    $info = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name -eq 'ko-KR' } | Select-Object -First 1
    if (-not $info) { throw 'KOREAN_RECOGNIZER_MISSING' }
    $recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine($info)
    $recognizer.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
    $recognizer.SetInputToDefaultAudioDevice()
    $recognizer.InitialSilenceTimeout = [TimeSpan]::FromSeconds(12)
    $recognizer.BabbleTimeout = [TimeSpan]::FromSeconds(10)
    Send-VoiceEvent @{ type = 'listening' }
    $result = $recognizer.Recognize([TimeSpan]::FromSeconds(25))
    if ($result -and $result.Text) { Send-VoiceEvent @{ type = 'transcript'; text = $result.Text } }
    else { Send-VoiceEvent @{ type = 'error'; message = 'NO_SPEECH' } }
    $recognizer.Dispose()
  }
} catch {
  $message = 'MICROPHONE_ERROR'
  if ($_.Exception.Message -match 'KOREAN_RECOGNIZER_MISSING') { $message = 'KOREAN_RECOGNIZER_MISSING' }
  if ($_.Exception.Message -match 'KOREAN_VOICE_MISSING') { $message = 'KOREAN_VOICE_MISSING' }
  Send-VoiceEvent @{ type = 'error'; message = $message }
  exit 1
}
