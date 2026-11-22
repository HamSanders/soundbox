# Support

Mirli is free and open source, and help comes from the people who use and
build it. There is no paid support and no guaranteed response time.

## Where to ask

| You have | Go to |
|---|---|
| A question, an idea, or something to show | [Discussions](https://github.com/HamSanders/soundbox/discussions) |
| Mirli won't install, start or update | [New issue → Install problem](https://github.com/HamSanders/soundbox/issues/new/choose) |
| Something is broken once it runs | [New issue → Bug report](https://github.com/HamSanders/soundbox/issues/new/choose) |
| A model to propose, or one that misbehaves | [New issue → Model report](https://github.com/HamSanders/soundbox/issues/new/choose) |
| A security problem | Privately, as [SECURITY.md](SECURITY.md) describes. Not a public issue. |

Before you ask, these answer most questions: the [README](README.md),
[docs/INSTALL.md](docs/INSTALL.md) (with a troubleshooting section),
[docs/DESKTOP.md](docs/DESKTOP.md) for the desktop app and its first-launch
warnings, and the same pages at <https://mirli.app/docs/>.

A report is quickest to act on with the output of
`http://127.0.0.1:17494/api/health` and the server log (below). The issue
forms ask for both.

### Stay safe in the tracker

Mirli's installers come from two places only: <https://mirli.app/download/>
and this repository's
[Releases](https://github.com/HamSanders/soundbox/releases). If a reply to
your issue tells you to paste a command that downloads something, or to
install a "fixed" build from a link, don't run it, whoever seems to have
posted it. An automatic check hides the obvious ones and labels the rest
`possible-scam`, but it can't catch everything.
[docs/DESKTOP.md](docs/DESKTOP.md#checking-a-download) shows how to check an
installer against the release's `SHA256SUMS.txt`.

## Where your data lives

Everything Mirli keeps is in one folder, the data directory:

- `~/.mirli` by default. On Windows that is `%USERPROFILE%\.mirli`.
- `~/.soundbox` if you installed before the rename to Mirli and have no
  `~/.mirli`. Nothing is moved for you.
- Wherever `MIRLI_DATA_DIR` or `--data-dir` points, if you set one. In Docker
  it is the container's `/data` volume.

Inside it: the library index (`soundbox.db`), your generated sounds
(`sounds/`, which Settings can move elsewhere on its own), model weights
(`models/`), the downloaded runtimes (`bin/`), `settings.json` (which holds
your Hugging Face token if you saved one) and the server log,
`soundbox-<port>.log`. [docs/INSTALL.md](docs/INSTALL.md#where-things-go) has
the full layout. To back up your work, copy the folder.

The desktop app also writes a few start-up lines to `soundbox-desktop.log`
in the system temp directory.

Nothing in the data directory is uploaded. [docs/PRIVACY.md](docs/PRIVACY.md)
lists every request the app makes on its own.

## Uninstalling

Removing the app and removing your data are separate steps, so an update or
a reinstall never loses your library.

1. **Remove the app.**
   - **Windows:** Settings → Apps → Installed apps, find `Soundbox` (the
     installed app keeps that name for now) and choose Uninstall.
   - **macOS:** drag `Soundbox` from Applications to the Trash.
   - **Linux:** delete the AppImage. For the `.deb`, find the package with
     `dpkg -l | grep -i soundbox` and remove it with `sudo apt remove <name>`.
   - **A clone:** delete the folder you cloned.
   - **Docker:** remove the container and its `/data` volume.
2. **Remove your data**, if you want it gone: delete the data directory
   above. That removes your sounds, voices, projects, settings and every
   downloaded model and runtime.

There is no account to close.
