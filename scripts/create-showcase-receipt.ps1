Add-Type -AssemblyName System.Drawing

$outputDirectory = Join-Path $PSScriptRoot '..\uploads\receipts'
$outputPath = Join-Path $outputDirectory 'coopmart-20260902.png'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$bitmap = New-Object System.Drawing.Bitmap 900, 1500
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$graphics.Clear([System.Drawing.Color]::FromArgb(250, 247, 240))

$dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(45, 45, 45))
$muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(105, 105, 105))
$accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(20, 130, 76))
$linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(205, 205, 195)), 2
$borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(155, 155, 145)), 3
$fontTitle = New-Object System.Drawing.Font 'Segoe UI', 31, ([System.Drawing.FontStyle]::Bold)
$fontStore = New-Object System.Drawing.Font 'Segoe UI', 22, ([System.Drawing.FontStyle]::Bold)
$fontBody = New-Object System.Drawing.Font 'Segoe UI', 18
$fontBodyBold = New-Object System.Drawing.Font 'Segoe UI', 18, ([System.Drawing.FontStyle]::Bold)
$fontSmall = New-Object System.Drawing.Font 'Segoe UI', 14

$graphics.DrawRectangle($borderPen, 24, 24, 852, 1452)
$center = New-Object System.Drawing.StringFormat
$center.Alignment = [System.Drawing.StringAlignment]::Center
$right = New-Object System.Drawing.StringFormat
$right.Alignment = [System.Drawing.StringAlignment]::Far

$graphics.DrawString('CO.OPMART', $fontTitle, $accent, (New-Object System.Drawing.RectangleF 40, 60, 820, 60), $center)
$graphics.DrawString('SIÊU THỊ CO.OPMART THỦ ĐỨC', $fontStore, $dark, (New-Object System.Drawing.RectangleF 40, 125, 820, 50), $center)
$graphics.DrawString('141 Quốc lộ 1A, TP. Thủ Đức, TP. Hồ Chí Minh', $fontSmall, $muted, (New-Object System.Drawing.RectangleF 40, 180, 820, 35), $center)
$graphics.DrawString('HÓA ĐƠN BÁN LẺ', $fontStore, $dark, (New-Object System.Drawing.RectangleF 40, 245, 820, 50), $center)
$graphics.DrawString('Số: 020926-1830', $fontSmall, $muted, 50, 310)
$graphics.DrawString('Ngày 02/09/2026  18:30', $fontSmall, $muted, 565, 310)
$graphics.DrawLine($linePen, 50, 365, 850, 365)
$graphics.DrawString('SẢN PHẨM', $fontBodyBold, $dark, 55, 385)
$graphics.DrawString('THÀNH TIỀN', $fontBodyBold, $dark, (New-Object System.Drawing.RectangleF 560, 385, 285, 40), $right)
$graphics.DrawLine($linePen, 50, 435, 850, 435)

$items = @(
  @('Gạo ST25 5 kg', '145.000'),
  @('Ức gà 1,2 kg', '114.000'),
  @('Rau củ các loại', '68.000'),
  @('Sữa tươi 2 hộp', '72.000'),
  @('Nước giặt 1 túi', '75.000'),
  @('Giảm giá thành viên', '-18.500'),
  @('Phí giao hàng', '12.000'),
  @('Thuế VAT', '20.000')
)
$y = 465
foreach ($item in $items) {
  $graphics.DrawString($item[0], $fontBody, $dark, 55, $y)
  $graphics.DrawString($item[1], $fontBody, $dark, (New-Object System.Drawing.RectangleF 560, $y, 285, 42), $right)
  $y += 72
}

$graphics.DrawLine($linePen, 50, 1055, 850, 1055)
$graphics.DrawString('TỔNG THANH TOÁN', $fontStore, $dark, 55, 1080)
$graphics.DrawString('487.500 ₫', $fontTitle, $accent, (New-Object System.Drawing.RectangleF 480, 1065, 365, 65), $right)
$graphics.DrawString('Thanh toán: Ví điện tử', $fontBody, $muted, 55, 1165)
$graphics.DrawString('Thu ngân: Lan Anh', $fontBody, $muted, 55, 1210)
$graphics.DrawLine($linePen, 50, 1280, 850, 1280)
$graphics.DrawString('Cảm ơn quý khách và hẹn gặp lại!', $fontBodyBold, $dark, (New-Object System.Drawing.RectangleF 40, 1310, 820, 50), $center)

for ($x = 180; $x -lt 720; $x += 10) {
  $width = if ((($x / 10) % 3) -eq 0) { 5 } else { 2 }
  $graphics.FillRectangle($dark, $x, 1380, $width, 58)
}
$graphics.DrawString('0209261830487500', $fontSmall, $muted, (New-Object System.Drawing.RectangleF 40, 1440, 820, 30), $center)

$bitmap.Save($outputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
$dark.Dispose()
$muted.Dispose()
$accent.Dispose()
$linePen.Dispose()
$borderPen.Dispose()
$fontTitle.Dispose()
$fontStore.Dispose()
$fontBody.Dispose()
$fontBodyBold.Dispose()
$fontSmall.Dispose()
$center.Dispose()
$right.Dispose()

Write-Output $outputPath
