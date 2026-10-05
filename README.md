# AquaVerse

**See your stream. Stress it. Understand why its health is your health.**

![AquaVerse demo: a sewage leak hits a healthy stream, the health risk gauge climbs and the narrator explains why](docs/screenshots/demo.gif)

A living pixel-art urban stream. Describe a real stream in five questions, then hit it with a heatwave, drought, storm runoff or sewage leak, and watch the water, the wildlife and the health risk for people nearby change together.

Built for the **OneAquaHealth IEEE Global Hackathon, Track 4: Awareness & Storytelling.**

## How it works

1. **Describe** your stream with five picture questions, or in your own words (AI fills in the answers).
2. **Watch** mayflies, midges, mosquito larvae and fish live in it. Click any creature to see what it says about the water.
3. **Stress** it: heatwave, drought, storm runoff, sewage leak, clear or plant bank trees.
4. **Understand**: three gauges move (ecosystem health, biodiversity, human health risk) and the narrator explains the cause in one sentence.

Rewind the timeline to compare before and after, check the trends, or redraw the stream in the map editor.

| | |
| --- | --- |
| ![Stream check](docs/screenshots/stream-check.png) | ![After a sewage leak](docs/screenshots/sewage-leak.png) |
| ![Trends](docs/screenshots/trends.png) | ![On a phone](docs/screenshots/phone.png) |

## AI

Powered by [AI/ML API](https://aimlapi.com):

- **TypeSafe Jev** turns your description into the five answers, and scores your "check your understanding" answer.
- **Amazon Nova Micro** rewords the narrator's explanation in friendlier language.

Set `AIMLAPI_KEY` on the server to turn it on. The footer of every page shows whether AI is working, and why not if it isn't.

## Run it

```bash
npm ci
npm run dev
```

## Deploy

On Render: **New → Blueprint**, pick this repo, and paste your `AIMLAPI_KEY` when asked.

---

All values are illustrative teaching assumptions, not measurements of a real stream. Credits: [OneAquaHealth](https://www.oneaquahealth.eu/), [AI/ML API](https://aimlapi.com), [Pixelify Sans](https://fontsource.org/fonts/pixelify-sans) (SIL OFL).
