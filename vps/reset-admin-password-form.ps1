Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

[System.Windows.Forms.Application]::EnableVisualStyles()

$form = New-Object System.Windows.Forms.Form
$form.Text = "Αλλαγή κωδικού διαχείρισης"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(470, 330)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(24, 26, 24)
$form.ForeColor = [System.Drawing.Color]::WhiteSmoke
$form.Font = New-Object System.Drawing.Font("Segoe UI", 10)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Νέος κωδικός διαχείρισης"
$title.Font = New-Object System.Drawing.Font("Segoe UI Semibold", 16)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(28, 22)
$form.Controls.Add($title)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = "Τουλάχιστον 11 χαρακτήρες. Επιτρέπονται λατινικά γράμματα, αριθμοί και ! @ # `$ % + = . _ -"
$hint.ForeColor = [System.Drawing.Color]::FromArgb(185, 190, 185)
$hint.Size = New-Object System.Drawing.Size(410, 42)
$hint.Location = New-Object System.Drawing.Point(30, 62)
$form.Controls.Add($hint)

$passwordLabel = New-Object System.Windows.Forms.Label
$passwordLabel.Text = "Νέος κωδικός"
$passwordLabel.AutoSize = $true
$passwordLabel.Location = New-Object System.Drawing.Point(30, 112)
$form.Controls.Add($passwordLabel)

$passwordBox = New-Object System.Windows.Forms.TextBox
$passwordBox.Location = New-Object System.Drawing.Point(30, 136)
$passwordBox.Size = New-Object System.Drawing.Size(410, 27)
$passwordBox.UseSystemPasswordChar = $true
$passwordBox.MaxLength = 128
$form.Controls.Add($passwordBox)

$confirmLabel = New-Object System.Windows.Forms.Label
$confirmLabel.Text = "Επιβεβαίωση κωδικού"
$confirmLabel.AutoSize = $true
$confirmLabel.Location = New-Object System.Drawing.Point(30, 174)
$form.Controls.Add($confirmLabel)

$confirmBox = New-Object System.Windows.Forms.TextBox
$confirmBox.Location = New-Object System.Drawing.Point(30, 198)
$confirmBox.Size = New-Object System.Drawing.Size(410, 27)
$confirmBox.UseSystemPasswordChar = $true
$confirmBox.MaxLength = 128
$form.Controls.Add($confirmBox)

$showPassword = New-Object System.Windows.Forms.CheckBox
$showPassword.Text = "Εμφάνιση κωδικού"
$showPassword.AutoSize = $true
$showPassword.Location = New-Object System.Drawing.Point(30, 236)
$showPassword.Add_CheckedChanged({
    $passwordBox.UseSystemPasswordChar = -not $showPassword.Checked
    $confirmBox.UseSystemPasswordChar = -not $showPassword.Checked
})
$form.Controls.Add($showPassword)

$characterCount = New-Object System.Windows.Forms.Label
$characterCount.Text = "Χαρακτήρες: 0"
$characterCount.ForeColor = [System.Drawing.Color]::FromArgb(185, 190, 185)
$characterCount.AutoSize = $true
$characterCount.Location = New-Object System.Drawing.Point(330, 238)
$form.Controls.Add($characterCount)

$passwordBox.Add_TextChanged({
    $characterCount.Text = "Χαρακτήρες: $($passwordBox.TextLength)"
})

$statusLabel = New-Object System.Windows.Forms.Label
$statusLabel.Text = ""
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(255, 160, 150)
$statusLabel.Size = New-Object System.Drawing.Size(270, 42)
$statusLabel.Location = New-Object System.Drawing.Point(30, 274)
$form.Controls.Add($statusLabel)

$submitButton = New-Object System.Windows.Forms.Button
$submitButton.Text = "Αλλαγή κωδικού"
$submitButton.Size = New-Object System.Drawing.Size(150, 40)
$submitButton.Location = New-Object System.Drawing.Point(290, 270)
$submitButton.BackColor = [System.Drawing.Color]::FromArgb(183, 255, 115)
$submitButton.ForeColor = [System.Drawing.Color]::FromArgb(16, 19, 16)
$submitButton.FlatStyle = "Flat"
$submitButton.FlatAppearance.BorderSize = 0
$form.Controls.Add($submitButton)
$form.AcceptButton = $submitButton

$remoteCommand = @'
set -u
if pgrep -af '[y]t-dlp' >/dev/null; then
  echo 'ERROR=ACTIVE_DOWNLOAD'
  exit 42
fi
IFS= read -r reset_password
if [ "${#reset_password}" -lt 11 ]; then
  echo 'ERROR=PASSWORD_TOO_SHORT'
  exit 43
fi
backup_dir="/opt/myhiphopblog/backups/$(date -u +%Y%m%dT%H%M%SZ)-admin-password-reset"
install -d -m 700 "$backup_dir"
cp -a /opt/myhiphopblog/.env "$backup_dir/app.env"
chmod 600 "$backup_dir/app.env"
if ! printf '%s' "$reset_password" | node -e 'const fs=require("fs");let p="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>p+=d);process.stdin.on("end",()=>{if(!/^[A-Za-z0-9!@#$%+=._-]{11,128}$/.test(p))process.exit(2);const f="/opt/myhiphopblog/.env";const src=fs.readFileSync(f,"utf8");const line="ADMIN_PASSWORD="+p;const next=/^ADMIN_PASSWORD=.*$/m.test(src)?src.replace(/^ADMIN_PASSWORD=.*$/m,()=>line):src.replace(/\s*$/, "\n")+line+"\n";fs.writeFileSync(f,next,{encoding:"utf8",mode:0o600});});'; then
  echo 'ERROR=PASSWORD_WRITE_REJECTED'
  exit 44
fi

if ! printf '%s' "$reset_password" | node --env-file=/opt/myhiphopblog/.env -e 'let p="";process.stdin.setEncoding("utf8");process.stdin.on("data",d=>p+=d);process.stdin.on("end",()=>process.exit(p===process.env.ADMIN_PASSWORD?0:1));'; then
  cp -a "$backup_dir/app.env" /opt/myhiphopblog/.env
  chmod 600 /opt/myhiphopblog/.env
  echo 'ERROR=ENV_ROUNDTRIP_FAILED_ROLLED_BACK'
  exit 45
fi

cd /opt/myhiphopblog
restore_previous() {
  cp -a "$backup_dir/app.env" /opt/myhiphopblog/.env
  chmod 600 /opt/myhiphopblog/.env
  pm2 delete myhiphopblog >/dev/null 2>&1 || true
  pm2 start ecosystem.config.cjs --only myhiphopblog >/dev/null
  pm2 save >/dev/null
}

pm2 delete myhiphopblog >/dev/null 2>&1 || true
if ! pm2 start ecosystem.config.cjs --only myhiphopblog >/dev/null; then
  restore_previous
  echo 'ERROR=START_FAILED_ROLLED_BACK'
  exit 46
fi
pm2 save >/dev/null
health_code=000
attempt=0
while [ "$attempt" -lt 20 ]; do
  health_code=$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:3020/health || true)
  [ "$health_code" = 200 ] && break
  attempt=$((attempt + 1))
  sleep 0.5
done
login_new=$(printf '%s' "$reset_password" | curl -sS -o /dev/null -w '%{http_code}' -X POST --data-urlencode 'password@-' http://127.0.0.1:3020/admin/login 2>/dev/null || true)
login_wrong=$(curl -sS -o /dev/null -w '%{http_code}' -X POST --data-urlencode 'password=definitely-wrong-admin-password' http://127.0.0.1:3020/admin/login 2>/dev/null || true)
if pm2 describe myhiphopblog | grep -q 'online'; then pm2_status=online; else pm2_status=failed; fi
printf 'BACKUP=%s\nLOGIN_NEW=%s\nLOGIN_WRONG=%s\nHEALTH=%s\nPM2=%s\n' "$backup_dir" "$login_new" "$login_wrong" "$health_code" "$pm2_status"
if [ "$login_new" = 302 ] && [ "$login_wrong" = 401 ] && [ "$health_code" = 200 ] && [ "$pm2_status" = online ]; then
  exit 0
fi

restore_previous
echo 'ERROR=VERIFICATION_FAILED_ROLLED_BACK'
exit 47
'@

$script:SafeResult = "FORM_CANCELLED"

$submitButton.Add_Click({
    $newPassword = $passwordBox.Text
    $confirmation = $confirmBox.Text

    if ($newPassword -notmatch '^[A-Za-z0-9!@#$%+=._-]{11,128}$') {
        $statusLabel.Text = "Ο κωδικός δεν πληροί τους κανόνες."
        return
    }

    if ($newPassword -cne $confirmation) {
        $statusLabel.Text = "Οι δύο κωδικοί δεν είναι ίδιοι."
        return
    }

    $submitButton.Enabled = $false
    $passwordBox.Enabled = $false
    $confirmBox.Enabled = $false
    $statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(183, 255, 115)
    $statusLabel.Text = "Γίνεται ασφαλής ενημέρωση..."
    $form.Refresh()

    try {
        $startInfo = New-Object System.Diagnostics.ProcessStartInfo
        $startInfo.FileName = "C:\Windows\System32\OpenSSH\ssh.exe"
        [void]$startInfo.ArgumentList.Add("root@89.167.23.230")
        [void]$startInfo.ArgumentList.Add($remoteCommand)
        $startInfo.UseShellExecute = $false
        $startInfo.CreateNoWindow = $true
        $startInfo.RedirectStandardInput = $true
        $startInfo.RedirectStandardOutput = $true
        $startInfo.RedirectStandardError = $true

        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $startInfo
        [void]$process.Start()
        $process.StandardInput.Write($newPassword + "`n")
        $process.StandardInput.Close()
        $standardOutput = $process.StandardOutput.ReadToEnd()
        $standardError = $process.StandardError.ReadToEnd()
        $process.WaitForExit()

        $passwordBox.Clear()
        $confirmBox.Clear()
        $newPassword = $null
        $confirmation = $null

        if ($process.ExitCode -eq 0 -and $standardOutput -match 'LOGIN_NEW=302' -and $standardOutput -match 'LOGIN_WRONG=401' -and $standardOutput -match 'HEALTH=200' -and $standardOutput -match 'PM2=online') {
            $script:SafeResult = $standardOutput.Trim()
            [System.Windows.Forms.MessageBox]::Show(
                "Ο κωδικός άλλαξε επιτυχώς και η σύνδεση ελέγχθηκε.",
                "Ολοκληρώθηκε",
                [System.Windows.Forms.MessageBoxButtons]::OK,
                [System.Windows.Forms.MessageBoxIcon]::Information
            ) | Out-Null
            $form.DialogResult = [System.Windows.Forms.DialogResult]::OK
            $form.Close()
            return
        }

        $script:SafeResult = "RESET_FAILED_EXIT_$($process.ExitCode)"
        if ($standardOutput -match 'ERROR=ACTIVE_DOWNLOAD') {
            $statusLabel.Text = "Υπάρχει ενεργό download. Δοκίμασε ξανά όταν ολοκληρωθεί."
        } elseif ($standardOutput -match 'ROLLED_BACK') {
            $statusLabel.Text = "Η αλλαγή απέτυχε και επανήλθε αυτόματα ο παλιός κωδικός."
        } else {
            $statusLabel.Text = "Η αλλαγή απέτυχε. Δεν εφαρμόστηκε νέος κωδικός."
        }
    } catch {
        $script:SafeResult = "RESET_FAILED_LOCAL"
        $statusLabel.Text = "Δεν ήταν δυνατή η σύνδεση με τον διακομιστή."
    } finally {
        $submitButton.Enabled = $true
        $passwordBox.Enabled = $true
        $confirmBox.Enabled = $true
    }
})

$form.Add_Shown({ $passwordBox.Focus() })
[void]$form.ShowDialog()
Write-Output $script:SafeResult
