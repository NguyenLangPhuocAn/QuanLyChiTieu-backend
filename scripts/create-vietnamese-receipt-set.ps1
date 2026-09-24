param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\..\mobile\demo-receipts')
)

Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$receipts = @(
  [pscustomobject]@{
    File = '01-coopmart-thuc-pham.png'; Merchant = 'CO.OPMART THỦ ĐỨC'; Address = '141 Quốc lộ 1A, TP. Thủ Đức, TP. Hồ Chí Minh'; Date = '02/09/2026 18:30'; Number = '020926-1830'; Payment = 'Ví điện tử'; Total = 487500
    Items = @(@('Gạo ST25 5 kg',145000),@('Ức gà 1,2 kg',114000),@('Rau củ các loại',68000),@('Sữa tươi 2 hộp',72000),@('Nước giặt 1 túi',75000),@('Giảm giá thành viên',-18500),@('Phí giao hàng',12000),@('Thuế VAT',20000))
  },
  [pscustomobject]@{
    File = '02-highlands-ca-phe.png'; Merchant = 'HIGHLANDS COFFEE'; Address = 'Vincom Plaza, 216 Võ Văn Ngân, TP. Thủ Đức'; Date = '01/09/2026 09:12'; Number = 'HC-010926-0912'; Payment = 'Thẻ ngân hàng'; Total = 142000
    Items = @(@('Phin sữa đá 2 ly',78000),@('Bánh mì que 2 cái',50000),@('Topping thạch 2 phần',20000),@('Giảm giá thành viên',-6000))
  },
  [pscustomobject]@{
    File = '03-circle-k-bua-sang.png'; Merchant = 'CIRCLE K'; Address = '12 Lê Văn Việt, TP. Thủ Đức, TP. Hồ Chí Minh'; Date = '31/08/2026 07:24'; Number = 'CK-310826-0724'; Payment = 'Tiền mặt'; Total = 96000
    Items = @(@('Sandwich trứng 1 phần',32000),@('Sữa đậu nành 1 chai',18000),@('Sữa chua 2 hộp',30000),@('Chuối 0,4 kg',16000))
  },
  [pscustomobject]@{
    File = '04-pharmacity-duoc-pham.png'; Merchant = 'NHÀ THUỐC PHARMACITY'; Address = '85 Đặng Văn Bi, TP. Thủ Đức, TP. Hồ Chí Minh'; Date = '29/08/2026 20:05'; Number = 'PMC-290826-2005'; Payment = 'Thẻ ngân hàng'; Total = 368000
    Items = @(@('Vitamin C 1 hộp',120000),@('Khẩu trang 10 cái',80000),@('Nước xịt mũi 1 chai',98000),@('Xà phòng 1 chai',55000),@('Giảm giá',-20000),@('Thuế VAT',35000))
  },
  [pscustomobject]@{
    File = '05-grab-di-chuyen.png'; Merchant = 'GRAB VIỆT NAM'; Address = 'Chuyến đi: Thủ Đức - Quận 1, TP. Hồ Chí Minh'; Date = '27/08/2026 08:10'; Number = 'GR-270826-0810'; Payment = 'Ví điện tử'; Total = 86000
    Items = @(@('Cước chuyến đi 12,4 km',72000),@('Phụ phí giờ cao điểm',8000),@('Phí nền tảng',6000))
  },
  [pscustomobject]@{
    File = '06-fahasa-sach.png'; Merchant = 'NHÀ SÁCH FAHASA'; Address = 'TTTM Gigamall, Phạm Văn Đồng, TP. Thủ Đức'; Date = '25/08/2026 15:45'; Number = 'FHS-250826-1545'; Payment = 'Thẻ ngân hàng'; Total = 425000
    Items = @(@('Sách Kỹ năng tài chính',185000),@('Sách Lập trình di động',149000),@('Sổ tay A5 1 cuốn',65000),@('Bút gel 2 cây',38000),@('Giảm giá thành viên',-12000))
  },
  [pscustomobject]@{
    File = '07-phu-kien-dien-tu.png'; Merchant = 'PHONG VŨ'; Address = '1A Nguyễn Thị Minh Khai, Quận 1, TP. Hồ Chí Minh'; Date = '22/08/2026 14:36'; Number = 'PV-220826-1436'; Payment = 'Chuyển khoản'; Total = 789000
    Items = @(@('Tai nghe Bluetooth 1 cái',599000),@('Chuột không dây 1 cái',159000),@('Phí giao hàng',20000),@('Thuế VAT',31000),@('Mã giảm giá',-20000))
  },
  [pscustomobject]@{
    File = '08-pet-shop-meo.png'; Merchant = 'PET MART'; Address = '244 Khánh Hội, Quận 4, TP. Hồ Chí Minh'; Date = '20/08/2026 17:18'; Number = 'PET-200826-1718'; Payment = 'Ví điện tử'; Total = 315000
    Items = @(@('Thức ăn mèo 1,5 kg',189000),@('Cát vệ sinh 8 kg',109000),@('Pate mèo 2 hộp',44000),@('Giảm giá khách hàng',-27000))
  },
  [pscustomobject]@{
    File = '09-nha-hang-com-viet.png'; Merchant = 'CƠM NIÊU SÀI GÒN'; Address = '27 Tú Xương, Quận 3, TP. Hồ Chí Minh'; Date = '18/08/2026 12:22'; Number = 'CNSG-180826-1222'; Payment = 'Tiền mặt'; Total = 326000
    Items = @(@('Cơm gà nướng 2 phần',130000),@('Canh chua cá 1 tô',65000),@('Rau muống xào 1 phần',55000),@('Trà đá 4 ly',24000),@('Phí phục vụ',26000),@('Thuế VAT',26000))
  },
  [pscustomobject]@{
    File = '10-cua-hang-tien-loi.png'; Merchant = 'WINMART+'; Address = '36 Hoàng Diệu 2, TP. Thủ Đức, TP. Hồ Chí Minh'; Date = '15/08/2026 19:08'; Number = 'WM-150826-1908'; Payment = 'Ví điện tử'; Total = 178500
    Items = @(@('Nước suối 1 lốc',48000),@('Trứng gà 10 quả',42000),@('Bánh mì 2 ổ',28000),@('Táo đỏ 0,7 kg',52500),@('Sữa chua 1 hộp',10000),@('Túi đựng hàng',2000),@('Giảm giá',-4000))
  }
)

function Format-Money([double]$Amount) {
  $absolute = [math]::Abs($Amount).ToString('N0', [Globalization.CultureInfo]::GetCultureInfo('vi-VN'))
  if ($Amount -lt 0) { return "-$absolute" }
  return $absolute
}

function New-ReceiptImage($Receipt, [string]$Path) {
  $width = 1000
  $height = 1540
  $bitmap = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::FromArgb(252, 250, 244))

  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(35, 35, 35))
  $muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(90, 90, 90))
  $accent = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(208, 91, 35))
  $linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(185, 185, 175)), 2
  $borderPen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(120, 120, 115)), 3
  $fontTitle = New-Object System.Drawing.Font 'Segoe UI', 31, ([System.Drawing.FontStyle]::Bold)
  $fontHeading = New-Object System.Drawing.Font 'Segoe UI', 23, ([System.Drawing.FontStyle]::Bold)
  $fontBody = New-Object System.Drawing.Font 'Segoe UI', 19
  $fontBodyBold = New-Object System.Drawing.Font 'Segoe UI', 19, ([System.Drawing.FontStyle]::Bold)
  $fontSmall = New-Object System.Drawing.Font 'Segoe UI', 15
  $center = New-Object System.Drawing.StringFormat
  $center.Alignment = [System.Drawing.StringAlignment]::Center
  $right = New-Object System.Drawing.StringFormat
  $right.Alignment = [System.Drawing.StringAlignment]::Far

  try {
    $graphics.DrawRectangle($borderPen, 24, 24, 952, 1492)
    $graphics.DrawString($Receipt.Merchant, $fontTitle, $accent, (New-Object System.Drawing.RectangleF 45, 62, 910, 58), $center)
    $graphics.DrawString($Receipt.Address, $fontSmall, $muted, (New-Object System.Drawing.RectangleF 55, 135, 890, 40), $center)
    $graphics.DrawString('HÓA ĐƠN BÁN HÀNG', $fontHeading, $dark, (New-Object System.Drawing.RectangleF 45, 215, 910, 50), $center)
    $graphics.DrawString("Số: $($Receipt.Number)", $fontSmall, $muted, 55, 285)
    $graphics.DrawString("Ngày: $($Receipt.Date)", $fontSmall, $muted, 610, 285)
    $graphics.DrawLine($linePen, 55, 345, 945, 345)
    $graphics.DrawString('NỘI DUNG', $fontBodyBold, $dark, 60, 368)
    $graphics.DrawString('THÀNH TIỀN (VND)', $fontBodyBold, $dark, (New-Object System.Drawing.RectangleF 610, 368, 325, 42), $right)
    $graphics.DrawLine($linePen, 55, 425, 945, 425)

    $y = 452
    foreach ($item in $Receipt.Items) {
      $graphics.DrawString([string]$item[0], $fontBody, $dark, (New-Object System.Drawing.RectangleF 60, $y, 590, 45))
      $graphics.DrawString((Format-Money ([double]$item[1])), $fontBody, $dark, (New-Object System.Drawing.RectangleF 650, $y, 285, 45), $right)
      $y += 72
    }

    $summaryY = [math]::Max($y + 18, 1030)
    $graphics.DrawLine($linePen, 55, $summaryY, 945, $summaryY)
    $graphics.DrawString('TỔNG THANH TOÁN', $fontHeading, $dark, 60, ($summaryY + 28))
    $graphics.DrawString("$(Format-Money ([double]$Receipt.Total)) VND", $fontTitle, $accent, (New-Object System.Drawing.RectangleF 520, ($summaryY + 15), 415, 64), $right)
    $graphics.DrawString("Thanh toán: $($Receipt.Payment)", $fontBody, $muted, 60, ($summaryY + 115))
    $graphics.DrawString('Thu ngân: Nguyễn An', $fontBody, $muted, 60, ($summaryY + 165))
    $graphics.DrawLine($linePen, 55, ($summaryY + 230), 945, ($summaryY + 230))
    $graphics.DrawString('Cảm ơn quý khách và hẹn gặp lại!', $fontBodyBold, $dark, (New-Object System.Drawing.RectangleF 45, ($summaryY + 255), 910, 48), $center)

    $barcodeY = [math]::Min($summaryY + 340, 1430)
    for ($x = 225; $x -lt 775; $x += 11) {
      $barWidth = if ((($x / 11) % 3) -eq 0) { 5 } else { 2 }
      $graphics.FillRectangle($dark, $x, $barcodeY, $barWidth, 55)
    }
    $graphics.DrawString(($Receipt.Number -replace '[^0-9]', ''), $fontSmall, $muted, (New-Object System.Drawing.RectangleF 45, ($barcodeY + 62), 910, 30), $center)
    $bitmap.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  } finally {
    $graphics.Dispose(); $bitmap.Dispose(); $dark.Dispose(); $muted.Dispose(); $accent.Dispose()
    $linePen.Dispose(); $borderPen.Dispose(); $fontTitle.Dispose(); $fontHeading.Dispose()
    $fontBody.Dispose(); $fontBodyBold.Dispose(); $fontSmall.Dispose(); $center.Dispose(); $right.Dispose()
  }
}

$manifest = foreach ($receipt in $receipts) {
  $itemSum = ($receipt.Items | ForEach-Object { [double]$_[1] } | Measure-Object -Sum).Sum
  if ($itemSum -ne [double]$receipt.Total) {
    throw "Tổng chi tiết không khớp ở $($receipt.File): $itemSum != $($receipt.Total)"
  }
  $path = Join-Path $OutputDirectory $receipt.File
  New-ReceiptImage $receipt $path
  [pscustomobject]@{
    file = $receipt.File
    merchant = $receipt.Merchant
    transaction_date = ([datetime]::ParseExact($receipt.Date, 'dd/MM/yyyy HH:mm', [Globalization.CultureInfo]::InvariantCulture)).ToString('yyyy-MM-dd')
    amount = $receipt.Total
    currency = 'VND'
    receipt_items = @($receipt.Items | ForEach-Object { [pscustomobject]@{ name = $_[0]; amount = $_[1] } })
  }
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $OutputDirectory 'manifest.json') -Encoding utf8
Write-Output "Đã tạo $($manifest.Count) hóa đơn tại $OutputDirectory"
