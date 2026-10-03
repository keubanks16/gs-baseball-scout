# GS Baseball Scout

Track each batter's swing from GameChanger clips, or let it scout a whole game, and build spray charts, defensive positioning and a call on where each hitter will hit it next. Everything runs in the browser: clips never leave your device and there is no server.

## Scout a full game

The **Scout a game** tab watches a whole game video by itself and builds spray charts for every hitter it sees.

1. **Get the game onto your phone.** GameChanger doesn't let other apps read its video, so record it yourself:
   - *Opponent games:* play the game in GameChanger, full screen in landscape, and record it with iPhone **Screen Recording**. Turn on Do Not Disturb first. Only the innings the opponent bats are needed; stop and start a new recording between them if you like, and pick all the parts together.
   - *Your own games:* the person streaming can use GameChanger's **Live Stream and Record to Device**, which saves the full game to their camera roll.
2. **Tap the four bases** on any frame where they are visible (home, first, second, third). White lines show the field it worked out; check they sit on the foul lines.
3. **Pick who to scout.** It reads the team names from the GameChanger scoreboard; choose the opponent, or every batter.
4. **Start scouting** and leave the app open (the screen stays on). It plays the video fast and watches the lane from home to first. A batter running it means the ball was put in play. It then checks each one: it finds the batter in the box, measures the swing, follows the ball and fits its flight to the field to place it on the spray chart.
5. **Check and save.** Each ball in play shows the batter's picture, the scoreboard line it read the name from, the batted-ball type and where it went. Use **Watch** to see the swing and the ball's path, **Adjust** to move a ball, then **Save to spray charts**.

Things to know:

- Direction comes from the ball's flight and is usually within a few degrees. Distance is an estimate, best for fly balls. Ground balls are placed at infield depth.
- Hits and outs aren't filled in. Edit an at-bat later on the Hitters tab to add the result.
- Expect roughly a third to a half of the video's length in processing time on a recent iPhone.
- Batter names are read from the scoreboard with Tesseract OCR, which downloads once (about 4 MB) and runs on the phone. If it can't load, type each name once. Other at-bats by the same batter fill in automatically.

## Scorebook

The `scorebook/` folder is a separate GameChanger-style scorebook for games you keep yourself: score pitch by pitch, keep box scores and season stats, and chart where every ball goes. Its Scout tab groups opponent hitters by jersey number across games and suggests where to play your defense.

- Address: `https://YOUR-USERNAME.github.io/gs-baseball-scout/scorebook/`
- Add it to your home screen the same way as the main app (see below). It gets its own GS icon.
- Data is saved in the browser on that device. Use **Team → Export backup** to save a copy and **Import backup** to load it on another device. Backups exported from the Claude version of the scorebook import here too.
- Opponent rosters live on the Team tab and fill the opponent's batting order when you set a lineup. To read rosters from photos and get scouting reports here, connect Claude (next section).

### Claude connection for the scorebook

Roster photo scanning and scouting reports use your own Claude API key. The key stays in a free Cloudflare Worker, never on this public site. A roster scan costs about a cent or two on your API account; a scouting report costs less. Setup takes about 15 minutes and is easiest on a computer.

1. **Get a Claude API key.** Sign in at [console.anthropic.com](https://console.anthropic.com). Under **Billing**, add a little credit and set a monthly spend limit. Then go to **API Keys → Create Key** and copy the key (it starts with `sk-ant-`). It's shown only once.
2. **Create the Worker.** Sign up free at [dash.cloudflare.com](https://dash.cloudflare.com). Go to **Workers & Pages → Create**, start from the "Hello World" Worker, name it `gs-scorebook-ai`, and deploy it.
3. **Paste the code.** Open the Worker and choose **Edit code**. Replace everything with the contents of [`scorebook/worker.js`](scorebook/worker.js) (open it, then **Raw** to copy it cleanly) and deploy again.
4. **Add two secrets.** In the Worker, go to **Settings → Variables and Secrets** and add, each as type **Secret**:
   - `ANTHROPIC_API_KEY`: the key from step 1
   - `ACCESS_CODE`: any passphrase you make up

   The Worker only answers requests from `https://keubanks16.github.io`. If the scorebook lives somewhere else, add a text variable `ALLOWED_ORIGIN` with that address.
5. **Connect the scorebook.** Copy the Worker's address (like `https://gs-scorebook-ai.YOUR-NAME.workers.dev`). In the scorebook, open **Team → Claude connection → Set up**, paste the address and your access code, tap **Test connection**, then **Save**.

The connection is saved on each device, so repeat step 5 on every phone you score from. Without the access code, nobody else can use your Worker.

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

- On the Analyze tab you type the batter's name, number and team from the scoreboard (the Claude version reads it for you). Names you've saved before autocomplete. On the Scout a game tab, names are read with on-device OCR.
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
| `field.js` | Field geometry from the four tapped bases, the camera, and the ball's flight |
| `scout.js` | Full-game scan: finds balls in play and checks each one |
| `overlay.js` | Reads the GameChanger scoreboard (rows, at-bat dot, batter line, OCR) |
| `model/` | The pose model (MoveNet Thunder, 16-bit weights) |
| `icons/`, `manifest.webmanifest` | Home-screen icon and app settings |
| `scorebook/` | The scorebook: live scoring, box scores, stats, spray charts and opponent scouting in one self-contained page, with its own icons and app settings |
| `scorebook/worker.js` | Cloudflare Worker that keeps your Claude API key off the site and reads roster photos and writes scouting reports for the scorebook |

## Credits

- Pose model: [MoveNet SinglePose Thunder](https://www.tensorflow.org/hub/tutorials/movenet) by Google, Apache License 2.0. Converted here to a compact op list with 16-bit per-channel weights.
- [TensorFlow.js](https://www.tensorflow.org/js) 4.22.0 (Apache License 2.0), loaded from cdnjs.
- [Tesseract.js](https://github.com/naptha/tesseract.js) 5.1.1 (Apache License 2.0), loaded from jsDelivr when scouting a game.
- Fonts: Big Shoulders Display and Public Sans (SIL Open Font License), from Google Fonts.
