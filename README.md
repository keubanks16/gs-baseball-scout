# GS Baseball Scout

Track each batter's swing from GameChanger clips, tag where the ball went, and build spray charts, defensive positioning and a call on where each hitter will hit it next. Everything runs in the browser: clips never leave your device and there is no server.

## Put it on GitHub (no coding needed)

1. Sign in at [github.com](https://github.com) (create a free account if you don't have one).
2. Click **+** (top right) → **New repository**.
   - Name: `gs-baseball-scout`
   - Choose **Public** (free GitHub Pages sites need a public repository; only the app's code goes in it, never your players' data).
   - Leave "Add a README" unchecked, then click **Create repository**.
3. On the new repository page, click the link **uploading an existing file**.
4. Unzip the download on a computer. Open the `gs-baseball-scout` folder and drag **everything inside it** (the files *and* the `model` and `icons` folders) into the upload box. Wait until every file shows as uploaded (the model file is about 13 MB), then click **Commit changes**.
5. Go to **Settings → Pages**. Under *Build and deployment*, set **Source: Deploy from a branch**, **Branch: main**, folder **/ (root)**, and click **Save**.
6. After a minute or two the address appears at the top of that page:
   `https://YOUR-USERNAME.github.io/gs-baseball-scout/`

### Put it on your phone's home screen

- **iPhone:** open the address in Safari → **Share** → **Add to Home Screen**.
- **Android:** open it in Chrome → **⋮** → **Add to Home screen** (or **Install app**).

It then opens full screen from its own icon, like an app.

## Where your data lives

At-bats are saved in the browser on the device you use (the dot in the header says "Saved on this device").

- **Back up or move data:** gear button → **Export data** saves a backup file; **Import data** on another phone or computer loads it.
- Clearing Safari or Chrome website data, or using a private window, removes or skips saved at-bats, so export a backup now and then.
- Sharing one live database across several coaches needs a hosted database (for example Supabase or Firebase). That is a later upgrade.

## Differences from the Claude version

- You type the batter's name, number and team from the scoreboard (the Claude version reads it for you). Names you've saved before autocomplete.
- Data is kept per device instead of being shared with your team automatically.

## Updating the site

Upload the changed files to the repository again (same names replace the old ones) and commit. GitHub Pages republishes in a minute or two.

## What's inside

| File | What it does |
| --- | --- |
| `index.html` | The app: video, batter, swing report, the call, tagging, hitters |
| `swing.js` | Tracks the batter, finds the swing and its timing, follows the ball off the bat |
| `pose.js` | Runs the pose model on the graphics chip with TensorFlow.js |
| `model.js` | Spray zones, the prediction, the prediction record and defensive shading |
| `store-local.js` | Saves at-bats in this browser (IndexedDB) with export/import |
| `model/` | The pose model (MoveNet Thunder, 16-bit weights) |
| `icons/`, `manifest.webmanifest` | Home-screen icon and app settings |

## Credits

- Pose model: [MoveNet SinglePose Thunder](https://www.tensorflow.org/hub/tutorials/movenet) by Google, Apache License 2.0. Converted here to a compact op list with 16-bit per-channel weights.
- [TensorFlow.js](https://www.tensorflow.org/js) 4.22.0 (Apache License 2.0), loaded from cdnjs.
- Fonts: Big Shoulders Display and Public Sans (SIL Open Font License), from Google Fonts.
