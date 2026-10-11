# Exports every page of every .drawio file in this folder to png/.
#
# draw.io's -p page index is ONE-based. Passing 0 silently exports the first page, which is how a
# whole run can come out shifted by one with no error. Run from this folder:
#
#   powershell -ExecutionPolicy Bypass -File exportPng.ps1

$exe = "C:\Program Files\draw.io\draw.io.exe"
if (-not (Test-Path $exe)) { throw "draw.io desktop not found at $exe" }
New-Item -ItemType Directory -Force -Path "png" | Out-Null

$groups = @{
  "flowcharts.drawio"  = "flowchart"
  "usecases.drawio"    = "usecase"
  "dfd-level0.drawio"  = "dfd0"
  "dfd-level1.drawio"  = "dfd1"
  "erd.drawio"         = "erd"
}

foreach ($file in $groups.Keys) {
  if (-not (Test-Path $file)) { continue }
  $prefix = $groups[$file]
  $xml = [xml](Get-Content $file -Raw)
  $page = 0
  foreach ($diagram in $xml.mxfile.diagram) {
    $page += 1                                   # one-based on purpose
    $slug = $diagram.name.ToLower() -replace ' ', '-'
    $out = "png\$prefix-$slug.png"
    Start-Process -FilePath $exe -ArgumentList @('-x', '-f', 'png', '-s', '3', '-b', '10', '-p', $page, '-o', $out, $file) -Wait -NoNewWindow
    "{0,-44} page {1}" -f $out, $page
  }
}
