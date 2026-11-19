# The Hercules DJ Console also presents its joystick to Windows as a HID MOUSE (interface MI_02), so moving the joystick moves the mouse cursor.
# The app reads the joystick through its own interface (MI_01), so the mouse interface can be switched off.
# Usage:  pwsh scripts\console-mouse.ps1            switch the console's mouse interface OFF  (asks for administrator rights)
#         pwsh scripts\console-mouse.ps1 -Enable    switch it back ON
# Only the device with VID_06F8 / PID_B000 / MI_02 is touched; your own mouse is never affected.
param([switch]$Enable, [string]$Log = '')
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) {
  $args2 = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"", '-Log', "`"$Log`"")
  if ($Enable) { $args2 += '-Enable' }
  Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $args2 -Verb RunAs -Wait
  exit
}
$out = @()
try {
  $devs = @(Get-PnpDevice -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'HID\VID_06F8&PID_B000&MI_02*' })
  if (-not $devs.Count) { $out += 'The console mouse interface was not found (is the console plugged in?)' }
  foreach ($d in $devs) {
    if ($Enable) { Enable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false } else { Disable-PnpDevice -InstanceId $d.InstanceId -Confirm:$false }
    $out += ('{0}: {1} -> {2}' -f $d.InstanceId, $d.Status, (Get-PnpDevice -InstanceId $d.InstanceId).Status)
  }
} catch { $out += 'ERROR: ' + $_.Exception.Message }
$out | ForEach-Object { Write-Host $_ }
if ($Log) { $out | Set-Content -Path $Log -Encoding UTF8 }
