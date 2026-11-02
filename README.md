# Bottom Half Blocker (X1 Fold 16 tablet/laptop toggle)

A GNOME Shell extension for the ThinkPad X1 Fold 16 Gen 1. With the keyboard
on the screen only the top half of the display is usable, so the extension

- covers the bottom half of the built-in screen with a black overlay,
- keeps windows, the overview, the lock screen and the shell's own dialogs
  (shutdown/restart, password prompts) in the visible half, and
- tells the tablet-mode daemon about the mode so GNOME's own tablet mode
  (auto-rotation, on-screen keyboard) follows it.

You switch modes by clicking the panel icon or with <kbd>Super</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>.

It is a modified version of
[ThinkPad-X1-Fold-16-Gen1-Gnome-Extension](https://github.com/somefoo/ThinkPad-X1-Fold-16-Gen1-Gnome-Extension)
by somefoo (GPL-3.0). See [License and credits](#license-and-credits).

## Status

Written on and tested by hand only on **Fedora 44, GNOME Shell 50.5 (Wayland)**
on an X1 Fold 16. `metadata.json` declares Shell 45–50, but the other versions
are untested. The extension uses some private shell internals (see
[Limitations](#limitations)), so a shell upgrade may need small fixes.

## Requirements

- ThinkPad X1 Fold 16 Gen 1 (the code looks for the built-in screen as
  `eDP-1`, `eDP-2`, `eDP-3`, `LVDS-1` or `DSI-1`)
- GNOME Shell 45 or newer, tested on 50.5
- The tablet-mode daemon from
  [jeblair/x1fold](https://github.com/jeblair/x1fold), running as a system
  service. It owns the virtual `SW_TABLET_MODE` switch and provides the
  D-Bus method `org.probos.TabletMode.SetTabletMode(b)` that this extension
  calls. Without it the overlay still works, but GNOME's tablet mode does not
  follow, and the journal shows one warning (see [Troubleshooting](#troubleshooting)).

## Install

Copy `extension.js`, `metadata.json`, `icons/` and `schemas/` into
`~/.local/share/gnome-shell/extensions/bottom-half-blocker@local/`, then:

```sh
cd ~/.local/share/gnome-shell/extensions/bottom-half-blocker@local
glib-compile-schemas schemas/
gnome-extensions enable bottom-half-blocker@local
```

On Wayland, log out and back in so the shell loads the new files. The schema
must be compiled, otherwise the keyboard shortcut is unavailable (the panel
icon still works).

## Use

- **Click or tap the panel icon** to switch between tablet and laptop mode.
  The icon shows the current mode.
- **<kbd>Super</kbd>+<kbd>Shift</kbd>+<kbd>T</kbd>** does the same and shows a
  short "Tablet mode" / "Laptop mode" popup, the same one the shell uses for volume
  and brightness, in the visible half of the screen.
  The shortcut is also enabled in the overview and on the lock screen. To change it:
  ```sh
  gsettings --schemadir ~/.local/share/gnome-shell/extensions/bottom-half-blocker@local/schemas \
      set org.gnome.shell.extensions.bottom-half-blocker toggle-mode "['<Super><Alt>t']"
  ```
- The extension starts in tablet mode after every login or shell restart. The
  choice is kept across screen lock and unlock.
- Laptop mode also turns the built-in screen to normal landscape, because the
  keyboard allows only that orientation. The auto-rotate setting is never touched:
  with GNOME's tablet mode off, auto-rotation stops on its own. Tablet mode leaves
  the rotation alone.
- Disabling the extension switches GNOME back to tablet mode.

If the kernel ever provides
`/sys/devices/platform/thinkpad_acpi/keyboard_attached_on_screen`, the
extension uses it automatically: laptop mode then follows the keyboard, and
clicking the icon only forces tablet mode while the keyboard is attached. The
stock Fedora kernel does not provide this file.

## How it works

| Part | What it does |
| --- | --- |
| Overlay | A black actor over the bottom half of the built-in monitor, registered as shell chrome with a strut, so maximized windows stay in the top half and the covered area does not receive input. |
| Daemon | Calls `SetTabletMode` on the system bus whenever the mode changes and at startup. Failed calls are retried every 2 seconds. |
| Overview | Adds a bottom margin to the overview controls so the dash, workspaces and app grid stay in the visible half. It is re-applied on session changes and before the overview opens. |
| Lock screen, dialogs, popups | Adds a constraint that shrinks the unlock dialog, each modal shell dialog and the volume/brightness popups (OSD) to the visible half, only on the built-in monitor. |
| Rotation | In laptop mode, applies a normal-landscape transform to the built-in monitor through Mutter's `DisplayConfig` D-Bus API (not persistent). |
| Shortcut | A GSettings keybinding (`toggle-mode`). |

The extension runs in the `user` and `unlock-dialog` session modes, so it stays
active while the screen is locked.

## Limitations

- It relies on private shell internals: `Main.overview._overview.controls`,
  `Main.screenShield._lockDialogGroup`, `_backgroundBin` /
  `_monitorConstraint` of modal dialogs, and `Main.osdWindowManager._osdWindows`. Each use is guarded and degrades to
  doing nothing, but a shell update can still change the behavior.
- An app's own dialogs keep their normal position.
- **Fullscreen apps ignore the overlay.** Any app that goes fullscreen on the
  built-in monitor gets the whole screen: the shell hides the overlay and the
  window is drawn across both halves, including the part the keyboard covers.
  This applies to every fullscreen app (video players, games, browsers,
  presentations) and the extension cannot fix it, because the window manager
  sizes fullscreen windows to the whole monitor. Leave fullscreen again to get
  the visible half back. The only workaround is per app. In Firefox, setting
  `full-screen-api.ignore-widgets` to `true` in `about:config` makes web
  fullscreen (videos) fill only the browser window, which stays in the visible
  half.
- The covered area is exactly half of the built-in monitor
  (`COVERED_FRACTION` in `extension.js`).
- The mode is switched by hand because no signal for the keyboard is available
  on the stock kernel.

## Troubleshooting

```sh
journalctl --user -b | grep -i bottom-half-blocker
```

- `keyboard shortcut unavailable`: the schema is missing or not compiled; run
  `glib-compile-schemas schemas/` and log out and in.
- `did not register`: the shell refused the shortcut; choose another one.
- `SetTabletMode failed`: the tablet-mode service is not running
  (`systemctl status tablet-mode`, or whatever the unit is called on your system).
- `could not adjust the overview`: the overview internals changed; please report
  your shell version.

## Development

```sh
npm install      # dev dependencies (ESLint) only
npm test         # runs tests/test.mjs against stubs of the shell APIs
npm run lint
```

The tests run against hand-written stubs of GNOME Shell, not a real shell, so
they check the extension's own logic but not how it looks in the shell. The lint
configuration approximates the style rules of GNOME Shell itself; the shell's
own config is not published on npm.

Only `extension.js`, `metadata.json`, `icons/` and `schemas/` are needed in the
extension folder.

## License and credits

GPL-3.0, see [LICENSE](LICENSE). This is a modified version of the extension by
**somefoo**,
[ThinkPad-X1-Fold-16-Gen1-Gnome-Extension](https://github.com/somefoo/ThinkPad-X1-Fold-16-Gen1-Gnome-Extension),
which is also GPL-3.0. The tablet-mode daemon is
[jeblair/x1fold](https://github.com/jeblair/x1fold).

Changes from the original include: the daemon call, the click-to-toggle panel
icon, the shortcut and its popup, the built-in-monitor selection, and the
overview, lock-screen and dialog handling.
