# Builds StageGremlin on this laptop and publishes it as a GitHub Release.
# Same result as the old GitHub Actions build (.github/workflows/build-windows.yml), but local:
#   - StageGremlin-portable.zip : StageGremlin.exe + portable.txt + data/bin (yt-dlp, ffmpeg) + data/extensions (uBlock Origin Lite)
#   - StageGremlin-setup.exe    : the installer (per user, no admin rights)
#
# Run from the repo root:   powershell -ExecutionPolicy Bypass -File scripts/release.ps1
# Options:
#   -NoPublish    build the two files in release-out/ but don't upload anything
#   -FreshTools   download yt-dlp and ffmpeg again even if tools/bin already has them
#
# Needs: Node, Rust, and the GitHub CLI logged in (gh auth status). Tauri fetches NSIS by itself.

param([switch]$NoPublish, [switch]$FreshTools)
$ErrorActionPreference = "Stop"
Set-Location (Split-Path $PSScriptRoot -Parent)

# 1. Only release committed, pushed code: the Release points at a commit on GitHub.
if (git status --porcelain) { throw "There are uncommitted changes. Commit them first." }
$sha = (git rev-parse HEAD).Trim()
if (-not $NoPublish) {
  git fetch origin --quiet
  if (-not (git branch -r --contains $sha)) { throw "Commit $sha is not on GitHub yet. Push main first (git push origin main)." }
}

# The one admin password for every install (scripts/make-admin-hash.mjs writes it; never committed).
if (-not (Test-Path .env.local) -or -not (Select-String -Path .env.local -Pattern '^VITE_ADMIN_HASH=pbkdf2:' -Quiet)) {
  throw "No admin password hash in .env.local. Run: node scripts/make-admin-hash.mjs"
}

# 2. yt-dlp and ffmpeg go into the zip and the installer. Downloaded once, reused after that.
New-Item -ItemType Directory -Force tools/bin | Out-Null
if ($FreshTools -or -not (Test-Path tools/bin/yt-dlp.exe)) {
  Write-Host "Downloading yt-dlp..."
  Invoke-WebRequest https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe -OutFile tools/bin/yt-dlp.exe
}
if ($FreshTools -or -not (Test-Path tools/bin/ffmpeg.exe)) {
  Write-Host "Downloading ffmpeg..."
  $tmp = Join-Path $env:TEMP "sg-ffmpeg"
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $tmp | Out-Null
  Invoke-WebRequest https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip -OutFile "$tmp/ffmpeg.zip"
  Expand-Archive "$tmp/ffmpeg.zip" -DestinationPath "$tmp/x"
  Get-ChildItem "$tmp/x" -Recurse -Include ffmpeg.exe | Copy-Item -Destination tools/bin/
  Remove-Item -Recurse -Force $tmp
}

# Tag v<version>-build.<N>, continuing the numbers the GitHub builds used (build.7 was the last one there).
# Decided BEFORE building: the app carries its own tag (SG_BUILD_TAG) to compare with newer releases.
$version = (Get-Content src-tauri/tauri.conf.json | ConvertFrom-Json).version
$prefix = "v$version-build."
$numbers = gh release list --limit 200 --json tagName --jq ".[].tagName" | Where-Object { $_.StartsWith($prefix) } | ForEach-Object { [int]$_.Substring($prefix.Length) }
$next = 1 + (($numbers | Measure-Object -Maximum).Maximum)
$tag = "$prefix$next"

$env:SG_BUILD_TAG = $tag
Write-Host "Building $tag"

# uBlock Origin Lite (Edge build) for the background player window: cleans up the players' pages.
# GPL-3.0, from github.com/uBlockOrigin/uBOL-home. Fetched once like the tools; -FreshTools gets the newest.
$ubol = "tools/extensions/ubol-lite"
if ($FreshTools -or -not (Test-Path "$ubol/manifest.json")) {
  Write-Host "Downloading uBlock Origin Lite..."
  $tmp = Join-Path $env:TEMP "sg-ubol"
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force $tmp | Out-Null
  gh release download -R uBlockOrigin/uBOL-home --pattern "*.edge.zip" -D $tmp
  if ($LASTEXITCODE) { throw "Couldn't download uBlock Origin Lite." }
  Remove-Item -Recurse -Force $ubol -ErrorAction SilentlyContinue
  Expand-Archive (Get-ChildItem "$tmp/*.edge.zip" | Select-Object -First 1).FullName -DestinationPath $ubol
  Remove-Item -Recurse -Force $tmp
}

# 3. Build: UI + Rust + installer. tauri.release.conf.json adds tools/bin as installer resources.
npm install
if ($LASTEXITCODE) { throw "npm install failed" }

# Mandatory checks: a release is only made when ALL of them pass. There is no switch to skip them.
function Assert-Step([string]$what, [scriptblock]$cmd) {
  Write-Host "== $what" -ForegroundColor Cyan
  & $cmd
  if ($LASTEXITCODE) { throw "$what failed - no release made. Fix it, commit, and run this again." }
}
Assert-Step "UI type-check and build" { npm run build }
if ((Get-Content package.json -Raw | ConvertFrom-Json).scripts.test) { Assert-Step "UI tests" { npm test } }
Assert-Step "Engine tests" { cargo test -p cueplay-engine }
Assert-Step "App tests" { cargo test -p stagegremlin }
Assert-Step "Clippy" { cargo clippy -p stagegremlin }

npm run tauri build -- --config src-tauri/tauri.release.conf.json
if ($LASTEXITCODE) { throw "The build failed (see above)." }

# 4. Portable zip + installer into release-out/.
$out = "release-out"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$out/portable/data/bin" | Out-Null
Copy-Item target/release/stagegremlin.exe "$out/portable/StageGremlin.exe"
New-Item -ItemType File -Force "$out/portable/portable.txt" | Out-Null
Copy-Item tools/bin/* "$out/portable/data/bin/"
Copy-Item -Recurse tools/extensions "$out/portable/data/extensions"
Compress-Archive -Path "$out/portable/*" -DestinationPath "$out/StageGremlin-portable.zip" -Force
$setup = Get-ChildItem target/release/bundle/nsis/*.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item $setup.FullName "$out/StageGremlin-setup.exe"
Write-Host "Built: $out/StageGremlin-portable.zip and $out/StageGremlin-setup.exe"
if ($NoPublish) { exit 0 }

# 5. Publish.

$notes = @"
Build from ``$sha`` (built locally). Not tested on a real show yet — see docs/TESTING.md.

**Portable (recommended):** download StageGremlin-portable.zip → right-click → Properties → Unblock → unzip → run StageGremlin.exe.
**Installer:** StageGremlin-setup.exe (no admin rights needed).
"@
# 0.x builds were test builds (pre-release); from 1.0 on every build is a full release.
# One plain text flag. (Was "@pre" with an array: PowerShell 5.1 turns the if-result into a single string,
# and splatting a string hands gh one character per argument: "no matches found for `-`".)
$releaseFlag = if ($version.StartsWith("0.")) { "--prerelease" } else { "--latest" }
# The notes go through a file (safer than a long multi-line argument on Windows PowerShell 5.1).
$notesFile = Join-Path $env:TEMP "sg-release-notes.md"
[IO.File]::WriteAllText($notesFile, $notes, (New-Object Text.UTF8Encoding $false))
gh release create $tag "$out/StageGremlin-portable.zip" "$out/StageGremlin-setup.exe" --target $sha --title "StageGremlin $tag" --notes-file $notesFile $releaseFlag
if ($LASTEXITCODE) { throw "Uploading the release failed." }
Write-Host "Published $tag"
