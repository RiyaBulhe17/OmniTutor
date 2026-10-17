[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$requiredModels = @("qwen2.5:7b", "llama3.2:3b")
$apiUrl = "http://127.0.0.1:11434/api/tags"

$ollama = Get-Command ollama -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $ollama) {
    $defaultPath = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path -LiteralPath $defaultPath -PathType Leaf) {
        $ollamaPath = $defaultPath
    }
    else {
        throw "Ollama is not installed. Run .\install-models.ps1 -InstallOllamaIfMissing first."
    }
}
else {
    $ollamaPath = $ollama.Source
}

try {
    $result = Invoke-RestMethod -Uri $apiUrl -TimeoutSec 5
}
catch {
    throw "Ollama is not responding at http://127.0.0.1:11434. Start Ollama or run .\install-models.ps1. Details: $($_.Exception.Message)"
}

$installed = @($result.models | ForEach-Object { $_.name } | Where-Object { $_ })
$missing = @($requiredModels | Where-Object { $installed -notcontains $_ })

Write-Host "Ollama executable: $ollamaPath"
Write-Host "Local Ollama API:  http://127.0.0.1:11434"
Write-Host ""
Write-Host "Installed Folio models:"
foreach ($model in $requiredModels) {
    if ($installed -contains $model) {
        Write-Host "  READY     $model"
    }
    else {
        Write-Host "  MISSING   $model"
    }
}

if ($missing.Count) {
    throw "Missing model(s): $($missing -join ', '). Run .\install-models.ps1 to download them."
}

Write-Host ""
Write-Host "Both models are available. No external AI service is used."
