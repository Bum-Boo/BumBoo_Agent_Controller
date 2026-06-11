# Elevated helper for powercfg operations that require admin (e.g. /requests).
# Launched by the controller via Start-Process -Verb RunAs only when needed.
# Writes its output to -OutFile so the non-elevated parent can read it back.
param(
    [Parameter(Mandatory = $true)][ValidateSet('requests', 'energy')][string]$Action,
    [Parameter(Mandatory = $true)][string]$OutFile
)

$ErrorActionPreference = 'Stop'

try {
    switch ($Action) {
        'requests' {
            $output = (& powercfg.exe /requests | Out-String)
        }
        'energy' {
            $report = Join-Path ([System.IO.Path]::GetDirectoryName($OutFile)) 'hermes-energy.html'
            & powercfg.exe /energy /output "$report" /duration 60 | Out-Null
            $output = "Energy report written to: $report"
        }
    }
}
catch {
    $output = "ERROR: $($_.Exception.Message)"
}

Set-Content -LiteralPath $OutFile -Value $output -Encoding UTF8
