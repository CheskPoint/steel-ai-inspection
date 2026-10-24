param(
    [ValidateSet('Deploy', 'Prepare', 'Activate', 'Rollback', 'Backup', 'Validate')]
    [string]$Mode = 'Deploy',
    [string]$StageParent = 'C:\steelvision-stage-ff855b2',
    [string]$OldRoot = 'C:\steel-scratch-web',
    [string]$DataDir = 'C:\steelvision-data',
    [string]$LogDir = 'C:\steel-scratch-web\logs',
    [string]$BackupRoot = 'C:\steelvision-backup',
    [string]$Domain = 'smartsteel.site'
)

$ErrorActionPreference = 'Stop'

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Open PowerShell as Administrator and run the deployment again.'
    }
}

if ($Mode -in @('Deploy', 'Activate', 'Rollback')) { Assert-Administrator }

function Get-ReleaseRoot {
    if (-not (Test-Path -LiteralPath $StageParent -PathType Container)) {
        throw "Staging directory is missing: $StageParent"
    }
    $matches = @(Get-ChildItem -LiteralPath $StageParent -Directory | Where-Object {
        (Test-Path -LiteralPath (Join-Path $_.FullName 'backend\models\best.pt')) -and
        (Test-Path -LiteralPath (Join-Path $_.FullName 'frontend\package.json'))
    })
    if ($matches.Count -ne 1) {
        throw "Expected one extracted release under $StageParent; found $($matches.Count)."
    }
    return $matches[0].FullName
}

$ReleaseRoot = Get-ReleaseRoot
$Backend = Join-Path $ReleaseRoot 'backend'
$Frontend = Join-Path $ReleaseRoot 'frontend'
$Python = Join-Path $Backend '.venv\Scripts\python.exe'
$BackendBatch = Join-Path $ReleaseRoot 'scripts\start-backend-cr7.bat'
$FrontendBatch = Join-Path $ReleaseRoot 'scripts\start-frontend-cr7.bat'
$ScriptCopy = Join-Path $ReleaseRoot 'scripts\deploy_windows.ps1'
$PreparedMarker = Join-Path $ReleaseRoot '.deploy-prepared'
$ActionsBackup = Join-Path $ReleaseRoot '.deploy-old-task-actions.json'

function Assert-Release {
    if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
        throw "Python virtual environment is missing: $Python"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Frontend 'package-lock.json') -PathType Leaf)) {
        throw 'Frontend package-lock.json is missing.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Backend 'models\evaluation.json') -PathType Leaf)) {
        throw 'Model evaluation evidence is missing.'
    }
}

function Invoke-Native {
    param([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory)
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $Executable @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Executable exited with code $LASTEXITCODE"
        }
    } finally {
        Pop-Location
    }
}

function Test-Torch {
    Push-Location -LiteralPath $Backend
    try {
        & $Python -c 'import fastapi, ultralytics, torch; print(torch.__version__)'
        return ($LASTEXITCODE -eq 0)
    } finally {
        Pop-Location
    }
}

function Ensure-VcRuntime {
    if (Test-Torch) { return }
    Assert-Administrator
    $runtime = Get-ItemProperty -Path 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64' -ErrorAction SilentlyContinue
    if ($runtime -and $runtime.Installed -eq 1) {
        throw 'Torch cannot load even though the x64 VC++ runtime is registered. No automatic repair was attempted.'
    }
    Write-Host 'Installing the Microsoft Visual C++ x64 runtime required by PyTorch...'
    $installer = Join-Path $env:TEMP 'vc_redist.x64.exe'
    Invoke-WebRequest -UseBasicParsing 'https://aka.ms/vc14/vc_redist.x64.exe' -OutFile $installer
    $signature = Get-AuthenticodeSignature -LiteralPath $installer
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft') {
        throw 'The VC++ installer does not have a valid Microsoft signature.'
    }
    $install = Start-Process -FilePath $installer -ArgumentList '/install /quiet /norestart' -WindowStyle Hidden -Wait -PassThru
    if ($install.ExitCode -notin @(0, 3010)) {
        throw "VC++ runtime installer exited with code $($install.ExitCode)."
    }
    if (-not (Test-Torch)) {
        if ($install.ExitCode -eq 3010) {
            throw 'VC++ runtime installation requires a reboot. The live site was not changed.'
        }
        throw 'Torch still cannot load after VC++ runtime installation. The live site was not changed.'
    }
}

function Wait-HttpOk {
    param([string]$Url, [int]$Attempts = 90)
    for ($attempt = 0; $attempt -lt $Attempts; $attempt++) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 5
            if ($response.StatusCode -eq 200) { return $response }
        } catch { }
        Start-Sleep -Seconds 2
    }
    throw "HTTP 200 was not received from $Url"
}

function Wait-PortFree {
    param([int]$Port)
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
        if (-not $listener) { return }
        Start-Sleep -Seconds 1
    }
    throw "Port $Port is still occupied after stopping the old task."
}

function Write-StartupScripts {
    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $backendLines = @(
        '@echo off',
        "cd /d `"$Backend`"",
        "set STEELVISION_DATA_DIR=$DataDir",
        "set STEELVISION_ALLOWED_ORIGINS=https://$Domain",
        "`"$Python`" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers >> `"$(Join-Path $LogDir 'backend.log')`" 2>&1"
    )
    $frontendLines = @(
        '@echo off',
        "cd /d `"$Frontend`"",
        'set HOST=127.0.0.1',
        'set PORT=3000',
        "node `"$(Join-Path $Frontend 'dist\standalone\server.js')`" >> `"$(Join-Path $LogDir 'frontend.log')`" 2>&1"
    )
    Set-Content -LiteralPath $BackendBatch -Value $backendLines -Encoding ASCII
    Set-Content -LiteralPath $FrontendBatch -Value $frontendLines -Encoding ASCII
    if ([IO.Path]::GetFullPath($PSCommandPath) -ne [IO.Path]::GetFullPath($ScriptCopy)) {
        Copy-Item -LiteralPath $PSCommandPath -Destination $ScriptCopy -Force
    }
}

function Test-StagedServices {
    $oldData = $env:STEELVISION_DATA_DIR
    $oldOrigin = $env:STEELVISION_ALLOWED_ORIGINS
    $oldPassword = $env:STEELVISION_INITIAL_ADMIN_PASSWORD
    $oldHost = $env:HOST
    $oldPort = $env:PORT
    $backendProcess = $null
    $frontendProcess = $null
    try {
        $env:STEELVISION_DATA_DIR = Join-Path $ReleaseRoot 'smoke-data'
        $env:STEELVISION_ALLOWED_ORIGINS = 'http://localhost:3001'
        $env:STEELVISION_INITIAL_ADMIN_PASSWORD = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
        $backendProcess = Start-Process -FilePath $Python -ArgumentList '-m uvicorn app.main:app --host 127.0.0.1 --port 8001' -WorkingDirectory $Backend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir 'smoke-backend.out.log') -RedirectStandardError (Join-Path $LogDir 'smoke-backend.err.log') -PassThru
        $health = Wait-HttpOk -Url 'http://127.0.0.1:8001/health' -Attempts 90
        if ((ConvertFrom-Json $health.Content).service -ne 'steelvision-backend') {
            throw 'The staging backend returned an unexpected health response.'
        }
        $env:HOST = '127.0.0.1'
        $env:PORT = '3001'
        $frontendProcess = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'dist\standalone\server.js' -WorkingDirectory $Frontend -WindowStyle Hidden -RedirectStandardOutput (Join-Path $LogDir 'smoke-frontend.out.log') -RedirectStandardError (Join-Path $LogDir 'smoke-frontend.err.log') -PassThru
        $page = Wait-HttpOk -Url 'http://127.0.0.1:3001/' -Attempts 30
        if ($page.Content -notmatch 'CR7') {
            throw 'The staging frontend did not render the CR7 application.'
        }
        Write-Host 'Staging backend and frontend smoke checks passed.'
    } finally {
        if ($frontendProcess -and -not $frontendProcess.HasExited) { Stop-Process -Id $frontendProcess.Id -Force -ErrorAction SilentlyContinue }
        if ($backendProcess -and -not $backendProcess.HasExited) { Stop-Process -Id $backendProcess.Id -Force -ErrorAction SilentlyContinue }
        $env:STEELVISION_DATA_DIR = $oldData
        $env:STEELVISION_ALLOWED_ORIGINS = $oldOrigin
        $env:STEELVISION_INITIAL_ADMIN_PASSWORD = $oldPassword
        $env:HOST = $oldHost
        $env:PORT = $oldPort
    }
}

function Prepare-Release {
    Assert-Release
    Ensure-VcRuntime
    Invoke-Native -Executable $Python -Arguments @('-c', "from app.services.inference import get_model_info; print(get_model_info()['model_sha256'])") -WorkingDirectory $Backend
    Write-Host 'Installing frontend dependencies...'
    Invoke-Native -Executable 'npm.cmd' -Arguments @('ci') -WorkingDirectory $Frontend
    $oldApiBase = $env:NEXT_PUBLIC_API_BASE_URL
    try {
        $env:NEXT_PUBLIC_API_BASE_URL = "https://$Domain"
        Invoke-Native -Executable 'npm.cmd' -Arguments @('run', 'build') -WorkingDirectory $Frontend
    } finally {
        $env:NEXT_PUBLIC_API_BASE_URL = $oldApiBase
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Frontend 'dist\standalone\server.js') -PathType Leaf)) {
        throw 'The standalone frontend server was not generated.'
    }
    Write-StartupScripts
    Test-StagedServices
    Set-Content -LiteralPath $PreparedMarker -Value (Get-Date -Format o) -Encoding ASCII
    Write-Host "PREPARED: $ReleaseRoot"
}

function Initialize-ProductionData {
    foreach ($candidate in @((Join-Path $OldRoot 'backend\data\steelvision.sqlite3'), (Join-Path $OldRoot 'data\steelvision.sqlite3'))) {
        if ((Test-Path -LiteralPath $candidate) -and -not (Test-Path -LiteralPath (Join-Path $DataDir 'steelvision.sqlite3'))) {
            throw "An existing database needs manual migration before deployment: $candidate"
        }
    }
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    if (Test-Path -LiteralPath (Join-Path $DataDir 'steelvision.sqlite3')) { return }
    Write-Host 'Choose a private initial admin password (at least 12 characters). Input is hidden.'
    $secure = Read-Host -AsSecureString
    if ($secure.Length -lt 12) { throw 'Initial admin password must contain at least 12 characters.' }
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $previousData = $env:STEELVISION_DATA_DIR
    $previousPassword = $env:STEELVISION_INITIAL_ADMIN_PASSWORD
    try {
        $env:STEELVISION_DATA_DIR = $DataDir
        $env:STEELVISION_INITIAL_ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
        Invoke-Native -Executable $Python -Arguments @('-c', 'from app.db import init_db; init_db()') -WorkingDirectory $Backend
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
        $env:STEELVISION_DATA_DIR = $previousData
        $env:STEELVISION_INITIAL_ADMIN_PASSWORD = $previousPassword
    }
}

function Backup-Data {
    if (-not (Test-Path -LiteralPath (Join-Path $DataDir 'steelvision.sqlite3'))) {
        throw 'The production database does not exist; backup was not created.'
    }
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $snapshot = Join-Path $BackupRoot "CR7-data-$stamp"
    $archive = "$snapshot.zip"
    New-Item -ItemType Directory -Path $snapshot | Out-Null
    try {
        $code = 'import sqlite3,sys; source=sqlite3.connect(sys.argv[1]); target=sqlite3.connect(sys.argv[2]); source.backup(target); target.close(); source.close()'
        foreach ($database in @(Get-ChildItem -LiteralPath $DataDir -Filter '*.sqlite3' -File)) {
            Invoke-Native -Executable $Python -Arguments @('-c', $code, $database.FullName, (Join-Path $snapshot $database.Name)) -WorkingDirectory $Backend
        }
        foreach ($item in @(Get-ChildItem -LiteralPath $DataDir -Force | Where-Object { $_.Name -notmatch '\.sqlite3(?:-wal|-shm)?$' })) {
            Copy-Item -LiteralPath $item.FullName -Destination (Join-Path $snapshot $item.Name) -Recurse -Force
        }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        [IO.Compression.ZipFile]::CreateFromDirectory($snapshot, $archive, [IO.Compression.CompressionLevel]::Optimal, $false)
        if (-not (Test-Path -LiteralPath $archive) -or (Get-Item -LiteralPath $archive).Length -eq 0) {
            throw 'The backup archive is missing or empty.'
        }
        Write-Host "BACKUP: $archive"
    } finally {
        $root = [IO.Path]::GetFullPath($BackupRoot).TrimEnd('\') + '\'
        $target = [IO.Path]::GetFullPath($snapshot)
        if (-not $target.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Backup cleanup path is outside the backup root.'
        }
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target -Recurse -Force }
    }
}

function New-BatchAction {
    param([string]$BatchPath, [string]$WorkingDirectory)
    return New-ScheduledTaskAction -Execute (Join-Path $env:SystemRoot 'System32\cmd.exe') -Argument ('/c "' + $BatchPath + '"') -WorkingDirectory $WorkingDirectory
}

function New-SavedTaskAction {
    param($SavedAction)
    $options = @{ Execute = [string]$SavedAction.Execute }
    if ($SavedAction.Argument) { $options.Argument = [string]$SavedAction.Argument }
    if ($SavedAction.WorkingDirectory) { $options.WorkingDirectory = [string]$SavedAction.WorkingDirectory }
    return New-ScheduledTaskAction @options
}

function Restore-OldTasks {
    if (-not (Test-Path -LiteralPath $ActionsBackup -PathType Leaf)) {
        throw "The saved task actions are missing: $ActionsBackup"
    }
    $saved = Get-Content -LiteralPath $ActionsBackup -Raw | ConvertFrom-Json
    Write-Host 'Restoring the old frontend, backend, and backup task actions...'
    Stop-ScheduledTask -TaskName 'SteelVision Frontend' -ErrorAction SilentlyContinue
    Stop-ScheduledTask -TaskName 'SteelVision Backend' -ErrorAction SilentlyContinue
    foreach ($taskName in @('SteelVision Backend', 'SteelVision Frontend', 'SteelVision Weekly Backup')) {
        Set-ScheduledTask -TaskName $taskName -Action (New-SavedTaskAction -SavedAction $saved.$taskName) | Out-Null
    }
    Start-ScheduledTask -TaskName 'SteelVision Backend'
    Start-ScheduledTask -TaskName 'SteelVision Frontend'
    Write-Host 'Old task actions restored. Check the public site before closing this window.'
}

function Assert-PublicSite {
    $page = Wait-HttpOk -Url "https://$Domain/" -Attempts 10
    if ($page.Content -notmatch 'CR7') { throw 'The public site did not render the CR7 application.' }
    try {
        Invoke-WebRequest -UseBasicParsing -Uri "https://$Domain/api/v1/auth/me" -TimeoutSec 10 | Out-Null
        throw 'The public authentication endpoint unexpectedly allowed an anonymous request.'
    } catch {
        $response = $_.Exception.Response
        if (-not $response -or [int]$response.StatusCode -ne 401) { throw }
    }
}

function Activate-Release {
    if (-not (Test-Path -LiteralPath $PreparedMarker -PathType Leaf)) {
        throw 'Run Prepare successfully before Activate.'
    }
    $taskNames = @('SteelVision Backend', 'SteelVision Frontend', 'SteelVision Weekly Backup')
    $originalActions = @{}
    foreach ($taskName in $taskNames) {
        $actions = @((Get-ScheduledTask -TaskName $taskName -ErrorAction Stop).Actions)
        if ($actions.Count -ne 1) { throw "Expected one action for task $taskName; found $($actions.Count)." }
        $originalActions[$taskName] = @{
            Execute = $actions[0].Execute
            Argument = $actions[0].Arguments
            WorkingDirectory = $actions[0].WorkingDirectory
        }
    }
    if ($originalActions['SteelVision Backend'].Argument -like "*$BackendBatch*") {
        Assert-PublicSite
        Write-Host "ALREADY DEPLOYED: https://$Domain/"
        return
    }
    foreach ($taskName in @('SteelVision Backend', 'SteelVision Frontend')) {
        if ($originalActions[$taskName].Argument -notlike "*$OldRoot*") {
            throw "Task $taskName does not point to the expected old application; deployment was not started."
        }
    }
    Initialize-ProductionData
    Backup-Data
    New-Item -ItemType Directory -Force -Path $BackupRoot | Out-Null
    $taskBackup = Join-Path $BackupRoot ("pre-CR7-tasks-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
    New-Item -ItemType Directory -Path $taskBackup | Out-Null
    foreach ($taskName in $taskNames) {
        Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath (Join-Path $taskBackup ($taskName.Replace(' ', '-') + '.xml')) -Encoding UTF8
    }
    $originalActions | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $ActionsBackup -Encoding UTF8
    Write-Host "TASK BACKUP: $taskBackup"
    $backendChanged = $false
    $frontendChanged = $false
    try {
        Stop-ScheduledTask -TaskName 'SteelVision Frontend'
        Stop-ScheduledTask -TaskName 'SteelVision Backend'
        Wait-PortFree -Port 3000
        Wait-PortFree -Port 8000
        Set-ScheduledTask -TaskName 'SteelVision Backend' -Action (New-BatchAction -BatchPath $BackendBatch -WorkingDirectory $Backend) | Out-Null
        $backendChanged = $true
        Set-ScheduledTask -TaskName 'SteelVision Frontend' -Action (New-BatchAction -BatchPath $FrontendBatch -WorkingDirectory $Frontend) | Out-Null
        $frontendChanged = $true
        Start-ScheduledTask -TaskName 'SteelVision Backend'
        Start-ScheduledTask -TaskName 'SteelVision Frontend'
        Wait-HttpOk -Url 'http://127.0.0.1:8000/health' -Attempts 90 | Out-Null
        $localPage = Wait-HttpOk -Url 'http://127.0.0.1:3000/' -Attempts 45
        if ($localPage.Content -notmatch 'CR7') { throw 'The new local frontend did not render CR7.' }
        Assert-PublicSite
        $backupAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -ExecutionPolicy Bypass -File "' + $ScriptCopy + '" -Mode Backup') -WorkingDirectory (Join-Path $ReleaseRoot 'scripts')
        Set-ScheduledTask -TaskName 'SteelVision Weekly Backup' -Action $backupAction | Out-Null
        Write-Host "DEPLOYED: https://$Domain/"
        Write-Host "ROLLBACK: powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$ScriptCopy`" -Mode Rollback"
    } catch {
        $failure = $_
        try {
            if ($backendChanged -or $frontendChanged) { Restore-OldTasks }
            else {
                Start-ScheduledTask -TaskName 'SteelVision Backend' -ErrorAction SilentlyContinue
                Start-ScheduledTask -TaskName 'SteelVision Frontend' -ErrorAction SilentlyContinue
            }
        } catch { Write-Warning "Automatic rollback also failed: $_" }
        throw $failure
    }
}

switch ($Mode) {
    'Validate' { Assert-Release; Write-Host "VALID RELEASE: $ReleaseRoot" }
    'Prepare' { Prepare-Release }
    'Activate' { Activate-Release }
    'Rollback' { Restore-OldTasks }
    'Backup' { Backup-Data }
    'Deploy' { Prepare-Release; Activate-Release }
}
