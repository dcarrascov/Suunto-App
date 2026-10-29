# TrainingPeaks: see your coach's plan

**English** · [Español](GUIA_TRAININGPEAKS.md)

The app's **Plan** page shows the workouts your coach sends you in TrainingPeaks: what is due this week,
the history of previous weeks and how much of each session you completed (matched with your Suunto activity
of the same day). The Dashboard also shows **Hoy toca** (today's session), and the races in your TrainingPeaks
calendar appear in **Calendario** (Calendar), **Competiciones** (Races) and the AI Coach.

> **Warning.** TrainingPeaks does not offer its official API for personal use, so this uses the same internal
> API its website uses, with your session. Data is only **read** (nothing is ever changed), but it may stop
> working if TrainingPeaks changes something, and using it may go against their terms.
> Use it only with your own account. It works with a basic (free) account.

## 1. Copy the session cookie (the first time and whenever it expires)

The `Production_tpAuth` cookie **is equivalent to your password**: do not share it or paste it anywhere other
than your `.env` file (which is not uploaded to git).

1. Open **https://app.trainingpeaks.com** in Chrome or Edge and log in.
2. Press **F12** to open the developer tools.
3. Go to the **Application** tab. If you do not see it, look for it under `»`.
4. In the left-hand menu: **Storage → Cookies → https://app.trainingpeaks.com**.
5. Find the **`Production_tpAuth`** row and copy the contents of the **Value** column (double click → `Ctrl + C`).
6. Open the `.env` file in the project folder (if it does not exist, copy `.env.example` as `.env`)
   and add a line:

   ```
   TP_AUTH_COOKIE=paste_the_value_here
   ```

## 2. Download the workouts

The first time, the whole history (since your first Suunto activity):

```bash
python3 fetch/tp_sync.py --full       # Windows: py fetch\tp_sync.py --full
```

After that, every time you want to update (it requests again from 3 weeks back to 6 ahead, which is what your
coach may have changed, plus the races of the next 12 months):

```bash
python3 fetch/tp_sync.py              # Windows: py fetch\tp_sync.py
```

`.\actualizar.ps1` (Windows), `./actualizar.sh` (Mac/Linux) and the app's refresh button also do it on their own
when `TP_AUTH_COOKIE` is in `.env`.

The data is saved in `public/data/plan.json` (it is in `.gitignore`). Reload the app and open **Plan**.

## If something fails

| Message | What to do |
| --- | --- |
| `Falta TP_AUTH_COOKIE` (cookie missing) | Follow step 1. |
| `La cookie ... ha caducado` (the cookie has expired) | The session lasts a few weeks: repeat step 1 with a new cookie. |
| `No encuentro tu id de atleta` (athlete id not found) | Add `TP_ATHLETE_ID=your_number` to `.env`. To find it: on app.trainingpeaks.com open the Calendar, press F12 → **Network** tab, reload (F5) and filter by `athletes`; the number after `/athletes/` in `tpapi.trainingpeaks.com/fitness/v6/athletes/1234567/...` is your id. |
| Durations or distances look wrong | Run `python3 fetch/tp_sync.py --dump` and check `fetch/debug/tp_workouts.json` (it contains your data: do not share it). |

## What you see in the app

- **This week:** each day with its workout: title, planned duration, distance, pace and TSS,
  the coach's description and comments, and whether you already did it (with a link to the activity).
- **States:** ✓ Hecho (done, with % of what was planned), ✗ No hecho (past day without an activity), Hoy (today),
  Próximo (upcoming), Descanso (rest).
- **Races:** the events in your TrainingPeaks calendar, with their name, priority (A/B/C) and distance, on the day
  of the race.
- **History:** previous weeks with sessions done, % completion, time and distance against what was planned.
  Click a week to see its workouts.
