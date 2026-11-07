# Contributing

**English** · [Español](CONTRIBUTING.es.md)

Thanks for wanting to help! Bug reports, ideas, documentation fixes and code are all welcome.

## Before you start

- **Bugs and ideas:** open an [issue](https://github.com/dimacavidv-lgtm/Suunto-App/issues). For bigger changes, open one first to talk it over, so no work is wasted.
- **Security problems:** do not post the details in a public issue. Open an issue saying only that you found a security problem, and we will agree on a private way to share it.

## Never share personal data

The app handles personal data: workouts, heart rate, GPS routes and account keys. In issues, pull requests, screenshots and logs:

- Never include `.env`, `public/data/`, `fetch/fit/` or `fetch/debug/`, nor any key, cookie or session.
- For a problem with Suunto data, `python3 fetch/sync.py --dump latest` saves a redacted copy of one workout, without coordinates or user (`fetch/debug/<id>.redacted.json`). That file is the only one you can share; the others in that folder contain your route.
- For screenshots, use the demo (`npm run demo`), which only has made-up data.

## Set up the project

```bash
git clone https://github.com/<your-user>/Suunto-App.git   # your fork
cd Suunto-App
npm install
python3 -m pip install -r fetch/requirements.txt
npm run demo
```

`npm run demo` opens the app with the made-up data in `demo/data/`, so you need no Suunto account or keys. To bring its dates up to today: `python3 fetch/make_demo.py`. On Windows, use `py` wherever it says `python3`.

## Checks before a pull request

```bash
npx tsc -b
npx oxlint
npm test
python3 -m unittest discover -s fetch -p "test_*.py"
python3 fetch/validate_output.py --data demo/data
```

The continuous integration runs most of them on every pull request. Add tests for new logic: `src/utils/*.test.ts`, `server/*.test.ts` or `fetch/test_*.py`.

## Project conventions

- **Language:** the app's interface and the code comments are in Spanish; commit messages are in English. Issues and pull requests can be in English or Spanish.
- **Dates in local time:** `startTime` is a local ISO date without a time zone. Never use `toISOString()` to get a day: use the helpers in `src/utils/date.ts`.
- **One data shape, three places:** if you change the data format, update `fetch/normalizer.py` (`make_summary()`), `src/types/suunto.ts` and `fetch/validate_output.py` together.
- **Keys stay on the server:** the routes in `server/` read them from `.env` and they never reach the browser. Every request goes through `server/auth.ts` first: do not add routes that skip it. `.env.example` only holds example values.
- **Read-only with other services:** the app never writes to the Suunto or TrainingPeaks account, and never sends GPS routes to the AI.
- **«Grafito» design:** dark and flat, neutral greys and a single lime accent (`#c5f23c`). No gradients, glows or emojis.

## Pull requests

1. Fork the repository and create a branch from `main`: `fix/…` for fixes, `feature/…` for new features.
2. Keep each pull request to one change. Explain what it changes and how you tested it; screenshots from the demo help.
3. Make sure the checks above pass.

By contributing, you agree that your contributions are published under the [MIT license](LICENSE).
