# Walkthrough video

An 84-second, 1920x1080, captioned walkthrough of the tracker, built from
captures of the live site. No voiceover or music: the captions carry it,
so it plays muted in an email or on a phone.

## Re-render after the tracker's content changes

From the repository root (needs Node 22+, ffmpeg on PATH, Edge or Chrome,
and the widget's `npm install` for Playwright):

```
node video/capture.mjs
node video/build.mjs
node %USERPROFILE%\.claude\skills\html-video\scripts\render.mjs video\walkthrough.html --stills 0,8.5,17.5,23,33,44,55,60,66,72,80
node %USERPROFILE%\.claude\skills\html-video\scripts\render.mjs video\walkthrough.html --out video\court-tracker-walkthrough.mp4 --small
```

1. `capture.mjs` screenshots the live tracker, an open case file, the
   methodology page, the Case Entry Desk and the grant preview at 2x, and
   writes `shots/meta.json` with where the parts the camera and rings
   point at sit.
2. `build.mjs` inlines those measurements into `walkthrough.src.html`
   and writes `walkthrough.html`. Camera moves and rings are computed
   from the measurements, so they follow the layout when content changes.
3. Look at the stills' contact sheet (`_stills/sheet.png`) before the full
   render. Check that every caption fits and every ring sits on its target.
4. The full render takes several minutes and also writes a small copy for
   texting.

Captures, the built page and the MP4s are not committed.

## Editing

`walkthrough.src.html` holds everything: scenes, the caption list
(`CAPS`, with start and end seconds), page-turn times (`PAGES`) and each
scene's camera keys. Read the captions top to bottom; they should tell the
story without the pictures. Motion follows the html-video contract: every
frame is a pure function of time through `seek(t)`, with no timers or CSS
animation.

The header on each scene shows the capture date, because the screens are
a snapshot of live data. The preview scene is labelled as a sample case.
