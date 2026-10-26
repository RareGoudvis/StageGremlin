# Builds StageGremlin on this laptop and publishes it as a GitHub Release.
# Same result as the old GitHub Actions build (.github/workflows/build-windows.yml), but local:
#   - StageGremlin-portable.zip : StageGremlin.exe + portable.txt + data/bin (yt-dlp, ffmpeg)
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

# 3. Build: UI + Rust + installer. tauri.release.conf.json adds tools/bin as installer resources.
npm install
if ($LASTEXITCODE) { throw "npm install failed" }
npm run tauri build -- --config src-tauri/tauri.release.conf.json
if ($LASTEXITCODE) { throw "The build failed (see above)." }

# 4. Portable zip + installer into release-out/.
$out = "release-out"
Remove-Item -Recurse -Force $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force "$out/portable/data/bin" | Out-Null
Copy-Item target/release/stagegremlin.exe "$out/portable/StageGremlin.exe"
New-Item -ItemType File -Force "$out/portable/portable.txt" | Out-Null
Copy-Item tools/bin/* "$out/portable/data/bin/"
Compress-Archive -Path "$out/portable/*" -DestinationPath "$out/StageGremlin-portable.zip" -Force
$setup = Get-ChildItem target/release/bundle/nsis/*.exe | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Copy-Item $setup.FullName "$out/StageGremlin-setup.exe"
Write-Host "Built: $out/StageGremlin-portable.zip and $out/StageGremlin-setup.exe"
if ($NoPublish) { exit 0 }

# 5. Tag v<version>-build.<N>, continuing the numbers the GitHub builds used (build.7 was the last one there).
$version = (Get-Content src-tauri/tauri.conf.json | ConvertFrom-Json).version
$prefix = "v$version-build."
$numbers = gh release list --limit 200 --json tagName --jq ".[].tagName" | Where-Object { $_.StartsWith($prefix) } | ForEach-Object { [int]$_.Substring($prefix.Length) }
$next = 1 + (($numbers | Measure-Object -Maximum).Maximum)
$tag = "$prefix$next"

$notes = @"
Build from ``$sha`` (built locally). Not tested on a real show yet — see docs/TESTING.md.

**Portable (recommended):** download StageGremlin-portable.zip → right-click → Properties → Unblock → unzip → run StageGremlin.exe.
**Installer:** StageGremlin-setup.exe (no admin rights needed).
"@
gh release create $tag "$out/StageGremlin-portable.zip" "$out/StageGremlin-setup.exe" --target $sha --title "StageGremlin $tag" --notes $notes --prerelease
if ($LASTEXITCODE) { throw "Uploading the release failed." }
Write-Host "Published $tag"
