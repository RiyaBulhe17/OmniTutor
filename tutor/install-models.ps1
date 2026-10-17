[CmdletBinding()]
param(
    [switch]$InstallOllamaIfMissing
)

$ErrorActionPreference = "Stop"
$models = @("qwen2.5:7b", "llama3.2:3b")
$apiBase = "http://127.0.0.1:11434"

function Get-OllamaCommand {
    $command = Get-Command ollama -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) {
        return $command.Source
    }

    $defaultPath = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"
    if (Test-Path -LiteralPath $defaultPath -PathType Leaf) {
        return $defaultPath
    }
    return $null
}

function Get-OllamaTags {
    try {
        $result = Invoke-RestMethod -Uri "$apiBase/api/tags" -TimeoutSec 4
        return @($result.models | ForEach-Object { $_.name } | Where-Object { $_ })
    }
    catch {
        return @()
    }
}

function Find-OllamaExe {
    $path = Get-OllamaCommand
    if ($path) {
        return $path
    }

    if (-not $InstallOllamaIfMissing) {
        throw "Ollama is not installed. Install it from https://ollama.com/download/windows and rerun this script. To install using winget, run .\install-models.ps1 -InstallOllamaIfMissing."
    }

    $winget = Get-Command winget -CommandType Application -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "Ollama is not installed and winget is unavailable. Install Ollama from https://ollama.com/download/windows and rerun this script."
    }

    Write-Host "Installing Ollama for your Windows account using winget..."
    & $winget.Source install --id Ollama.Ollama --exact --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) {
        throw "The Ollama installation did not succeed (winget exit code $LASTEXITCODE). Install Ollama from https://ollama.com/download/windows and rerun this script."
    }

    $installed = Get-OllamaCommand
    if (-not $installed) {
        throw "Ollama installation finished but ollama.exe is not on PATH. Restart PowerShell and rerun .\install-models.ps1."
    }
    return $installed
}

$ollamaExe = Find-OllamaExe
$installedTags = Get-OllamaTags
$serverProcess = $null

if (-not $installedTags.Count) {
    Write-Host "Starting the Ollama API on http://127.0.0.1:11434..."
    $processOptions = @{
        FilePath    = $ollamaExe
        ArgumentList = "serve"
        PassThru    = $true
    }
    if ($PSVersionTable.PSVersion.Major -ge 6) {
        $processOptions.WindowStyle = "Hidden"
    }
    $serverProcess = Start-Process @processOptions

    $deadline = (Get-Date).AddSeconds(60)
    do {
        Start-Sleep -Seconds 2
        $installedTags = Get-OllamaTags
        if ($serverProcess.HasExited -and -not $installedTags.Count) {
            throw "The Ollama API stopped before becoming ready (exit code $($serverProcess.ExitCode)). Check your Ollama installation and local port 11434."
        }
    } while (-not $installedTags.Count -and (Get-Date) -lt $deadline)

    if (-not $installedTags.Count) {
        throw "Ollama did not respond on $apiBase within 60 seconds. Start Ollama and rerun .\install-models.ps1."
    }
}

$missingModels = @($models | Where-Object { $installedTags -notcontains $_ })
if ($missingModels.Count) {
    $modelRoot = if ($env:OLLAMA_MODELS) {
        [IO.Path]::GetFullPath($env:OLLAMA_MODELS)
    }
    else {
        Join-Path $env:USERPROFILE ".ollama\models"
    }
    $driveRoot = [IO.Path]::GetPathRoot($modelRoot)
    $driveLetter = $driveRoot.Substring(0, 1)
    $drive = Get-PSDrive -Name $driveLetter -ErrorAction Stop
    $requiredBytes = 3GB * $missingModels.Count

    if ($drive.Free -lt $requiredBytes) {
        throw "There is not enough free space on ${driveLetter}:. Need about $([math]::Ceiling($requiredBytes / 1GB)) GB to download $($missingModels -join ', '), but only $([math]::Round($drive.Free / 1GB, 1)) GB is available."
    }

    Write-Host "The project uses qwen2.5:7b for study materials and llama3.2:3b for the tutor."
    Write-Host "Ollama stores downloads in $modelRoot."

    foreach ($model in $missingModels) {
        Write-Host ""
        Write-Host "Downloading $model. Ollama displays the download and any errors below."
        & $ollamaExe pull $model
        if ($LASTEXITCODE -ne 0) {
            throw "Downloading $model failed (ollama exit code $LASTEXITCODE). Check your internet connection and available disk space, then rerun .\install-models.ps1."
        }
    }
}
else {
    Write-Host "Both recommended models are already installed."
}

$finalTags = Get-OllamaTags
$missingAfterInstall = @($models | Where-Object { $finalTags -notcontains $_ })
if ($missingAfterInstall.Count) {
    throw "The download finished but Ollama did not report these installed models: $($missingAfterInstall -join ', '). Run ollama list and rerun .\install-models.ps1."
}

Write-Host ""
Write-Host "Your two local models are installed and ready:"
Write-Host "  Study guides, quizzes, and plans: qwen2.5:7b"
Write-Host "  Study buddy:                      llama3.2:3b"
Write-Host "In Folio's Local AI settings, click 'Find models on this device' and save these two models."
Write-Host "Ollama is local. AI generation can still be slow on machines without a supported GPU."
