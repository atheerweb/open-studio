param([Parameter(Mandatory=$true)][string]$EventsDirectory)

$global:OpenStudioGitEvents = $EventsDirectory

function global:git {
    $gitCommand = Get-Command git -CommandType Application -ErrorAction Stop | Select-Object -First 1
    $gitContext = @()
    $operationIndex = 0
    while ($operationIndex -lt $args.Count) {
        $option = $args[$operationIndex]
        if ($option -in @('-C', '-c') -and $operationIndex + 1 -lt $args.Count) {
            $gitContext += $option, $args[$operationIndex + 1]
            $operationIndex += 2
        } elseif ($option -match '^--(?:git-dir|work-tree|namespace)=' -or $option -eq '--no-pager') {
            $gitContext += $option
            $operationIndex++
        } else {
            break
        }
    }
    $operation = if ($operationIndex -lt $args.Count) { $args[$operationIndex] }
    if ($MyInvocation.ExpectingInput) {
        $input | & $gitCommand.Source @args
    } else {
        & $gitCommand.Source @args
    }
    $gitExitCode = $LASTEXITCODE
    if ($gitExitCode -ne 0 -or $operation -notin @('pull', 'push') -or $args -contains '--dry-run' -or
        $args -contains '--help' -or $args -contains '-h' -or ($operation -eq 'push' -and $args -contains '-n')) {
        return
    }
    try {
        $root = & $gitCommand.Source @gitContext rev-parse --show-toplevel 2>$null
        if ($LASTEXITCODE -eq 0 -and $root) {
            $identity = $root.Trim()
            if ([System.IO.Path]::DirectorySeparatorChar -eq '\') {
                $identity = $identity.Replace('\', '/').ToLowerInvariant()
            }
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try {
                $hash = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity))).Replace('-', '').ToLowerInvariant()
            } finally {
                $sha.Dispose()
            }
            $marker = Join-Path $global:OpenStudioGitEvents ($hash + '.json')
            [IO.File]::WriteAllText($marker, [Guid]::NewGuid().ToString('N'))
        }
    } catch {
        Write-Warning 'Open Studio could not record the completed Git operation.'
    } finally {
        $global:LASTEXITCODE = $gitExitCode
    }
}
