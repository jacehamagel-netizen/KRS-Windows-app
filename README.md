# KRS Portal – Windows app
Self-contained desktop app (bundles its own engine; needs no browser).

## Build the .exe without installing anything
1. Create a free GitHub account and a new repository.
2. Upload everything in this folder (keep the `.github` folder).
3. Open the repo's **Actions** tab -> **Build Windows app** -> **Run workflow**.
4. After ~3 minutes open the finished run and download **KRS-Portal-Windows**.
   It contains the installer (`...-nsis.exe`) and a no-install single file (`...-portable.exe`).

## Or build on a Windows PC
Install Node.js, then in this folder run: `npm install` then `npm run build`. Files appear in `dist/`.

## Code signing (removes the "Unknown publisher" warning)
You must buy a Windows code-signing certificate (.pfx) from a certificate authority; it can't be generated for free.
1. Convert it to text: in PowerShell run `[Convert]::ToBase64String([IO.File]::ReadAllBytes("cert.pfx")) | Set-Clipboard`
2. In the GitHub repo: Settings -> Secrets and variables -> Actions -> New repository secret:
   - `WIN_CERT_PFX_BASE64` = the copied text
   - `WIN_CERT_PASSWORD` = the certificate password
3. Re-run the **Build Windows app** workflow. The `.exe` files come out signed.
Note: SmartScreen may still warn for a few weeks until the app builds reputation (an EV certificate avoids this).

## Features
- Splash screen with the school logo while the portal loads
- Offline screen that reconnects automatically (checks every 5 seconds) + "Try again now"
- File > Print (Ctrl+P) and Save as PDF (Ctrl+Shift+P) for report cards
- Remembers window size, position and maximised state
- Automatic updates (installed version): the app checks on start-up, downloads a new version and offers "Restart now"

- Start with Windows (optional): Settings > Start with Windows. Opens quietly in the tray at login.
- Auto-lock: signs out after inactivity (Settings > Auto-lock; default 15 minutes, can be Off/5/15/30/60). It uses
  Windows' idle timer and also clears the portal's saved sign-in and cached data from the computer.
- System tray icon: closing the window keeps the app running; right-click the tray icon for Open / About / Quit.
  Turn off under Settings > Keep running in the tray when closed.
- Download folder: Settings > Choose download folder. Exports save there and a "Saved" message offers "Show in folder".
- Help > About shows the version and school contact. **Edit the `SUPPORT` block at the top of main.js** (email, phone).
- Press **Alt** to show the menu bar (File / View / Settings / Help).

## Releasing an update (for automatic updates)
1. Change `"version"` in package.json (e.g. 1.2.0) and commit.
2. Create a tag: `git tag v1.2.0 && git push origin v1.2.0`
3. The workflow builds and publishes a GitHub Release. Installed apps pick it up on next start.
The repository must be **public** (or you must add a read token) for installed apps to download updates.
The portable file does not auto-update.
