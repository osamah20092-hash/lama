# Narrator voice packs

Each folder here is one narrator. Record the lines yourself (or use sounds you hold the rights to)
and save them as `<key>.mp3`. A line the pack is missing is read by the device's Arabic text-to-speech.

Lines (key → what to say):

| key | line | key | line |
|---|---|---|---|
| sun | صن | double | دبل |
| hokom | حكم | triple | ثري |
| hokom_spades | حكم بستوني | four | فور |
| hokom_hearts | حكم كبّة | gahwa | قهوة |
| hokom_diamonds | حكم ديناري | sira | سرا |
| hokom_clubs | حكم سباتي | p50 | خمسين |
| confirm | أثبت | p100 | مية |
| ashkal | أشكال | p400 | أربعمية |
| pass | بس | baloot | بلوت |
| qaid | قيد | kaboot | كبوت |
| redeal | توزيع جديد | | |

Then register the pack in `web/js/audio.js`:

```js
export const VOICE_PACKS = [{ id: "rashid", name: "راشد" }];   // files in assets/voices/rashid/
```

Keep clips short (under ~1s) and trimmed of silence so the narrator keeps pace with the table.
