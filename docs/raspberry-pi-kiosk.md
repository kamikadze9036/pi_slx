# Raspberry Pi kiosk example

Use Raspberry Pi OS with a dedicated unprivileged kiosk user and Chromium. Set a unique display URL per terminal; the line mapping remains on the server. On a Pi Zero 2 W, use the light desktop image and disable unnecessary services.

Example user systemd service at `~/.config/systemd/user/production-display.service`:

```ini
[Unit]
Description=Production display Chromium kiosk
After=graphical-session.target network-online.target
Wants=network-online.target

[Service]
Environment=DISPLAY=:0
ExecStart=/usr/bin/chromium --kiosk --no-first-run --disable-session-crashed-bubble --disable-infobars --disable-features=Translate --password-store=basic http://dashboard.factory.local/display/07
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Adjust the Chromium binary and display URL for the OS image. Enable graphical auto-login for the kiosk account, then run `systemctl --user enable --now production-display.service`. Test boot, network outage, browser crash recovery, and the resolution/scaling of the attached monitor. The kiosk is a client and does not run the backend Docker stack.
